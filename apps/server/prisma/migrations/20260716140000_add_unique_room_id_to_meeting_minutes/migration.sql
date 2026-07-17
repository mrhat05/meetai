-- A room produces at most one minutes row. This unique index is the DB-level
-- idempotency guard for the BullMQ minutes worker: a retried or duplicated
-- job physically cannot insert a second row for the same meeting
-- (saveMinutes inserts with ON CONFLICT ("room_id") DO NOTHING).
CREATE UNIQUE INDEX "meeting_minutes_room_id_key" ON "meeting_minutes"("room_id");
