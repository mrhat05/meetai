import { unlink } from 'node:fs/promises';
import db from '../../db.js';
import transcriptionService from './transcriptionService.js';
import summarizationService from './summarizationService.js';
import minutesService from './minutesService.ts';
import { mergeSpeakerSegments } from './transcriptMerge.ts';
import actionItemsService from './actionItemsService.ts';
import { emitToUser } from '../socket/presence.ts';
import { sendMinutesReadyEmail } from '../../lib/mailer.js';

export type UploadedTrack = {
  filePath: string;
  speaker: string;
  offsetMs: number;
};

/**
 * Everything the minutes pipeline needs, and nothing it can't get back after
 * a crash: this object is serialized into Redis as the BullMQ job payload,
 * so it must stay plain JSON (no Dates, no class instances, no streams).
 */
export type MinutesJobPayload = {
  roomId: string;
  roomCode: string;
  groupId: string;
  groupName: string;
  hostUserId: string;
  durationSeconds: number;
  tracks: UploadedTrack[];
};

/** Best-effort removal of the uploaded .webm tracks once they can't be needed again. */
async function cleanupTrackFiles(tracks: UploadedTrack[]): Promise<void> {
  for (const track of tracks) {
    try {
      await unlink(track.filePath);
    } catch {
      // ignore — the file may already be gone
    }
  }
}

/**
 * The AI minutes pipeline, executed by the BullMQ worker (at-least-once
 * delivery). Designed to be safe to re-run for the same room:
 *
 * 1. Existence pre-check — a duplicate/retried job exits before spending
 *    30-60s of Groq calls on work that's already done.
 * 2. saveMinutes inserts with ON CONFLICT (room_id) DO NOTHING — even two
 *    racing runs can't create two rows; the loser sees created=false.
 * 3. Notifications (socket + email) are sent only when created=true, so
 *    members are never emailed twice for one meeting.
 *
 * File lifetime: the uploaded .webm tracks are the job's only non-Redis
 * input and must survive a failed attempt so the retry can re-read them.
 * They are deleted ONLY on success (or when the work proves redundant);
 * files orphaned by terminal failures are reaped by the boot-time sweeper.
 *
 * Errors from transcription/summarization THROW past this function on
 * purpose — that is what marks the job failed and triggers the backoff
 * retry. Title and action items degrade gracefully instead (a default
 * title beats re-running the whole pipeline for a nicety).
 */
export async function processMeetingMinutes(payload: MinutesJobPayload): Promise<void> {
  const { roomId, groupId, groupName, hostUserId, durationSeconds, tracks } = payload;

  const existingMinutes = await db.$queryRaw<Array<{ id: string }>>`
    SELECT mm."id" FROM "meeting_minutes" mm WHERE mm."room_id" = ${roomId}::uuid LIMIT 1
  `;
  if (existingMinutes[0]) {
    console.log(`Minutes already exist for room ${roomId}; skipping duplicate job run.`);
    await cleanupTrackFiles(tracks);
    return;
  }

  const speakerTracks = [] as Array<{ speaker: string; offsetMs: number; segments: Awaited<ReturnType<typeof transcriptionService.transcribeAudioSegments>> }>;
  for (const track of tracks) {
    const segments = await transcriptionService.transcribeAudioSegments(track.filePath);
    if (segments.length > 0) {
      speakerTracks.push({ speaker: track.speaker, offsetMs: track.offsetMs, segments });
    }
  }

  const transcript = mergeSpeakerSegments(speakerTracks);
  const hasSpeech = transcript.trim().length > 0;

  const dbParticipantCount = await (db as any).participant.count({ where: { roomId } });
  const manifestSpeakerCount = new Set(tracks.map((track) => track.speaker)).size;
  const participantCount = Math.max(dbParticipantCount, manifestSpeakerCount);

  const aiTitle = hasSpeech ? await summarizationService.generateMinutesTitle({ transcript, groupName }) : null;
  const summaryMarkdown = hasSpeech
    ? await summarizationService.summarizeMeeting({
        transcript,
        groupName,
        durationSeconds,
        participantCount,
      })
    : '## Summary\nNo speech was detected in this meeting, so no summary could be generated.';

  const actionItems = hasSpeech
    ? await actionItemsService.extractActionItems({ transcript, summaryMarkdown })
    : [];

  const { minutesId, created } = await minutesService.saveMinutes({
    roomId,
    groupId,
    createdBy: hostUserId,
    groupName,
    transcript: hasSpeech ? transcript : 'No speech detected.',
    summaryMarkdown,
    durationSeconds,
    participantCount,
    aiTitle,
    actionItems,
  });

  if (created) {
    const groupMemberRows = await db.$queryRaw<Array<{ user_id: string; email: string; display_name: string }>>`
      SELECT gm."user_id", u."email", u."display_name"
      FROM "group_members" gm
      INNER JOIN "users" u ON u."id" = gm."user_id"
      WHERE gm."group_id" = ${groupId}::uuid
    `;

    const minutesTitleRows = await db.$queryRaw<Array<{ title: string }>>`
      SELECT mm."title" FROM "meeting_minutes" mm WHERE mm."id" = ${minutesId}::uuid LIMIT 1
    `;
    const minutesTitle = minutesTitleRows[0]?.title ?? groupName;

    for (const member of groupMemberRows) {
      emitToUser(member.user_id, 'minutes-ready', {
        groupId,
        minutesId,
      });

      sendMinutesReadyEmail({
        toEmail: member.email,
        toName: member.display_name,
        groupName,
        title: minutesTitle,
        summaryMarkdown,
        groupId,
        minutesId,
      }).catch((emailError) => {
        console.error('Failed to send minutes-ready email:', emailError);
      });
    }
  }

  await cleanupTrackFiles(tracks);
}
