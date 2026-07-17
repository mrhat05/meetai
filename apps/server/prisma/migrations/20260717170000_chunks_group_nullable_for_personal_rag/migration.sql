-- Personal AI assistant: RAG now spans a user's PERSONAL (non-group) meetings
-- too, so chunks can belong to a meeting with no group. Group meetings keep
-- their group_id; personal-meeting chunks store NULL and are authorized by the
-- meeting's created_by owner at retrieval time.
-- AlterTable
ALTER TABLE "meeting_minute_chunks" ALTER COLUMN "group_id" DROP NOT NULL;
