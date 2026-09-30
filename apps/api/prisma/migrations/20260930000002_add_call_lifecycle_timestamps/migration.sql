ALTER TABLE "calls" ADD COLUMN "started_at" TIMESTAMP(3); ALTER TABLE "calls" ADD COLUMN "answered_at" TIMESTAMP(3); ALTER TABLE "calls" ADD COLUMN "ended_at" TIMESTAMP(3);
ALTER TABLE "call_attempts" ADD COLUMN "started_at" TIMESTAMP(3); ALTER TABLE "call_attempts" ADD COLUMN "answered_at" TIMESTAMP(3); ALTER TABLE "call_attempts" ADD COLUMN "ended_at" TIMESTAMP(3);
