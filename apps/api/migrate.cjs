const { Client } = require('pg');
require('dotenv').config();
const client = new Client({ connectionString: process.env.DATABASE_URL });
client.connect()
  .then(() => client.query('ALTER TABLE "Call" ADD COLUMN "started_at" TIMESTAMP(3); ALTER TABLE "Call" ADD COLUMN "answered_at" TIMESTAMP(3); ALTER TABLE "Call" ADD COLUMN "ended_at" TIMESTAMP(3);'))
  .then(() => console.log('Done'))
  .catch(console.error)
  .finally(() => client.end());
