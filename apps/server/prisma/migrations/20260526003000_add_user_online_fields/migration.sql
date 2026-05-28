-- AlterTable
ALTER TABLE "users" ADD COLUMN "is_online" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "users" ADD COLUMN "last_seen_at" TIMESTAMPTZ NOT NULL DEFAULT now();
