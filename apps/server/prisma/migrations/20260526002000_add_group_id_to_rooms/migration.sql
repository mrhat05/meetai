-- AlterTable
ALTER TABLE "rooms" ADD COLUMN "group_id" UUID;

-- AddForeignKey
ALTER TABLE "rooms" ADD CONSTRAINT "rooms_group_id_fkey" FOREIGN KEY ("group_id") REFERENCES "groups"("id") ON DELETE SET NULL ON UPDATE CASCADE;
