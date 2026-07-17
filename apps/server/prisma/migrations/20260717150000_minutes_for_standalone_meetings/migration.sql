-- Minutes for non-group ("normal") meetings. A standalone room has no group,
-- so a meeting's minutes may now have a NULL group_id (the row is owned by its
-- host via created_by instead). Existing group minutes keep their group_id.
-- AlterTable
ALTER TABLE "meeting_minutes" ALTER COLUMN "group_id" DROP NOT NULL;

-- Per-room opt-in for AI minutes on a normal meeting (groups use their own
-- summarizer_enabled flag; this covers group-less rooms).
-- AlterTable
ALTER TABLE "rooms" ADD COLUMN "summarizer_enabled" BOOLEAN NOT NULL DEFAULT false;
