import db from '../../db.js';
import type { ActionItem } from './actionItemsService.js';

type SaveMinutesInput = {
  roomId: string;
  groupId: string;
  createdBy: string;
  groupName: string;
  transcript: string;
  summaryMarkdown: string;
  durationSeconds: number;
  participantCount: number;
  aiTitle?: string | null;
  actionItems?: ActionItem[];
};

function buildMinutesTitle(groupName: string, aiTitle?: string | null): string {
  if (aiTitle && aiTitle.trim()) {
    const shortDate = new Date().toLocaleDateString('en-IN', {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
    });

    return `${aiTitle.trim()} · ${shortDate}`.slice(0, 200);
  }

  const formattedDate = new Date().toLocaleDateString('en-IN', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });

  return `${groupName} · ${formattedDate}`;
}

export type SaveMinutesResult = {
  minutesId: string;
  /** false when a row for this room already existed (idempotent re-run). */
  created: boolean;
};

export async function saveMinutes({
  roomId,
  groupId,
  createdBy,
  groupName,
  transcript,
  summaryMarkdown,
  durationSeconds,
  participantCount,
  aiTitle,
  actionItems,
}: SaveMinutesInput): Promise<SaveMinutesResult> {
  const title = buildMinutesTitle(groupName, aiTitle);
  const actionItemsJson = JSON.stringify(actionItems ?? []);

  // ON CONFLICT on the unique room_id index makes this insert idempotent:
  // a retried/duplicated queue job can never create a second minutes row for
  // the same meeting. DO NOTHING returns zero rows on conflict, so a missing
  // id tells the caller "someone else already saved this" — the caller then
  // skips notifications (created: false).
  const insertedMinutes = await db.$queryRaw<Array<{ id: string }>>`
    INSERT INTO "meeting_minutes" (
      "room_id",
      "group_id",
      "created_by",
      "title",
      "raw_transcript",
      "summary_markdown",
      "duration_seconds",
      "participant_count",
      "action_items"
    )
    VALUES (
      ${roomId}::uuid,
      ${groupId}::uuid,
      ${createdBy}::uuid,
      ${title},
      ${transcript},
      ${summaryMarkdown},
      ${durationSeconds},
      ${participantCount},
      ${actionItemsJson}::jsonb
    )
    ON CONFLICT ("room_id") DO NOTHING
    RETURNING "id"
  `;

  const insertedId = insertedMinutes[0]?.id;
  if (insertedId) {
    return { minutesId: insertedId, created: true };
  }

  const existingMinutes = await db.$queryRaw<Array<{ id: string }>>`
    SELECT mm."id" FROM "meeting_minutes" mm WHERE mm."room_id" = ${roomId}::uuid LIMIT 1
  `;

  const existingId = existingMinutes[0]?.id;
  if (!existingId) {
    throw new Error('Failed to insert meeting minutes');
  }

  return { minutesId: existingId, created: false };
}

const minutesService = {
  saveMinutes,
};

export default minutesService;