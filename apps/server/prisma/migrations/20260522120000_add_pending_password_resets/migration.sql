CREATE TABLE "pending_password_resets" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "email" TEXT NOT NULL,
  "otp_hash" TEXT NOT NULL,
  "otp_expires_at" TIMESTAMP(3) NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "pending_password_resets_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "pending_password_resets_email_key" ON "pending_password_resets"("email");
