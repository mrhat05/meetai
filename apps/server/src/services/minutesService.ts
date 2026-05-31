import db from '../../db.js';

type SaveMinutesInput = {
  roomId: string;
  groupId: string;
  createdBy: string;
  groupName: string;
  transcript: string;
  summaryMarkdown: string;
  durationSeconds: number;
  participantCount: number;
};

function buildMinutesTitle(groupName: string): string {
  const formattedDate = new Date().toLocaleDateString('en-IN', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });

  return `${groupName} · ${formattedDate}`;
}

export async function saveMinutes({
  roomId,
  groupId,
  createdBy,
  groupName,
  transcript,
  summaryMarkdown,
  durationSeconds,
  participantCount,
}: SaveMinutesInput): Promise<string> {
  const title = buildMinutesTitle(groupName);

  const insertedMinutes = await db.$queryRaw<Array<{ id: string }>>`
    INSERT INTO "meeting_minutes" (
      "room_id",
      "group_id",
      "created_by",
      "title",
      "raw_transcript",
      "summary_markdown",
      "duration_seconds",
      "participant_count"
    )
    VALUES (
      ${roomId}::uuid,
      ${groupId}::uuid,
      ${createdBy}::uuid,
      ${title},
      ${transcript},
      ${summaryMarkdown},
      ${durationSeconds},
      ${participantCount}
    )
    RETURNING "id"
  `;

  const minutesId = insertedMinutes[0]?.id;
  if (!minutesId) {
    throw new Error('Failed to insert meeting minutes');
  }

  return minutesId;
}

const minutesService = {
  saveMinutes,
};

export default minutesService;