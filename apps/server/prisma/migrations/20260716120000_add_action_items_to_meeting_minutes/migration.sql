-- AlterTable
ALTER TABLE "meeting_minutes" ADD COLUMN "action_items" JSONB NOT NULL DEFAULT '[]';
