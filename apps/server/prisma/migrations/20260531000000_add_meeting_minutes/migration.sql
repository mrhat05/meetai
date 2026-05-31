-- CreateTable
CREATE TABLE "meeting_minutes" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "room_id" UUID NOT NULL,
    "group_id" UUID NOT NULL,
    "created_by" UUID,
    "title" VARCHAR(200) NOT NULL,
    "raw_transcript" TEXT NOT NULL,
    "summary_markdown" TEXT NOT NULL,
    "duration_seconds" INTEGER NOT NULL,
    "participant_count" INTEGER NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT "meeting_minutes_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "meeting_minutes" ADD CONSTRAINT "meeting_minutes_room_id_fkey" FOREIGN KEY ("room_id") REFERENCES "rooms"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "meeting_minutes" ADD CONSTRAINT "meeting_minutes_group_id_fkey" FOREIGN KEY ("group_id") REFERENCES "groups"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "meeting_minutes" ADD CONSTRAINT "meeting_minutes_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;