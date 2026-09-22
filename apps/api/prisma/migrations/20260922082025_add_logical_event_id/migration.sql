ALTER TABLE "webhook_deliveries" ADD COLUMN "event_id" TEXT NOT NULL DEFAULT gen_random_uuid();
CREATE UNIQUE INDEX "webhook_deliveries_outbound_webhook_id_event_id_key" ON "webhook_deliveries"("outbound_webhook_id", "event_id");
