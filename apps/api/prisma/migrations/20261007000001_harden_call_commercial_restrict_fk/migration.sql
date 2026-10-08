-- DropForeignKey
ALTER TABLE "call_commercials" DROP CONSTRAINT "call_commercials_call_id_fkey";

-- AddForeignKey
ALTER TABLE "call_commercials" ADD CONSTRAINT "call_commercials_call_id_fkey" FOREIGN KEY ("call_id") REFERENCES "calls"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
