-- Google Sign-In: users may authenticate via Google instead of a password.
-- password_hash becomes nullable (Google-only accounts have no password) and
-- google_id stores the Google account subject ("sub"), unique per account.

-- AlterTable
ALTER TABLE "users" ALTER COLUMN "password_hash" DROP NOT NULL;

-- AlterTable
ALTER TABLE "users" ADD COLUMN "google_id" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "users_google_id_key" ON "users"("google_id");
