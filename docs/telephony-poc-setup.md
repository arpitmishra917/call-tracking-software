# Telephony POC Setup Guide

## Overview
This POC demonstrates a provider-agnostic sequential call routing engine (Inbound Caller -> Buyer A -> Buyer B) supporting both Telnyx and Twilio. 

## Requirements
* Node.js (v18+)
* A public tunneling service (e.g., `ngrok`) for local webhook testing

## Installation
```bash
npm install
```

## Environment Variables
Copy `.env.example` to `.env` and fill in the required values:

```env
# Telephony Provider Selection ('twilio' or 'telnyx')
TELEPHONY_PROVIDER=twilio

# Public Base URL (e.g., your ngrok URL for webhooks)
BASE_URL=https://your-ngrok-url.ngrok-free.app

# Server Port
PORT=3000

# Buyer Phone Numbers (E.164 format)
BUYER_A_NUMBER=+15550000001
BUYER_B_NUMBER=+15550000002

# --- Twilio Credentials ---
TWILIO_ACCOUNT_SID=your_twilio_account_sid
TWILIO_AUTH_TOKEN=your_twilio_auth_token

# --- Telnyx Credentials ---
TELNYX_API_KEY=your_telnyx_api_key
TELNYX_PUBLIC_KEY=your_telnyx_public_key
TELNYX_CONNECTION_ID=your_telnyx_call_control_connection_id
```

## Running the Server
```bash
npm start
```
The server will listen on the specified `$PORT` (default 3000).

## Webhook Configuration
### Twilio
In the Twilio Console, configure your active phone number:
* Under "A CALL COMES IN", set the webhook URL to: `[BASE_URL]/webhooks/twilio`
* Ensure the HTTP method is `POST`.

### Telnyx
In the Telnyx Portal, configure your Call Control Application:
* Set the webhook URL to: `[BASE_URL]/webhooks`
* Ensure the HTTP method is `POST`.

## Running Automated Tests
To run the Jest test suite validating the generic routing engine, idempotency, webhook signatures, and provider adapters:
```bash
npm test
```
