-- Persistent chat threads for the personal AI assistant (ChatGPT-style history).
-- CreateTable
CREATE TABLE "assistant_threads" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "user_id" UUID NOT NULL,
    "title" VARCHAR(200) NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT now(),

    CONSTRAINT "assistant_threads_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "assistant_messages" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "thread_id" UUID NOT NULL,
    "role" VARCHAR(12) NOT NULL,
    "content" TEXT NOT NULL,
    "sources" JSONB NOT NULL DEFAULT '[]',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT now(),

    CONSTRAINT "assistant_messages_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "assistant_threads_user_id_updated_at_idx" ON "assistant_threads"("user_id", "updated_at" DESC);

-- CreateIndex
CREATE INDEX "assistant_messages_thread_id_created_at_idx" ON "assistant_messages"("thread_id", "created_at");

-- AddForeignKey
ALTER TABLE "assistant_threads" ADD CONSTRAINT "assistant_threads_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assistant_messages" ADD CONSTRAINT "assistant_messages_thread_id_fkey" FOREIGN KEY ("thread_id") REFERENCES "assistant_threads"("id") ON DELETE CASCADE ON UPDATE CASCADE;
