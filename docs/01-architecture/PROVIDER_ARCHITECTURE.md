# Provider Architecture
The application uses an abstract `TelephonyProvider` (`apps/api/src/telephony/telephony.provider.ts`). 
This interface implements `answer`, `dial`, `bridge`, `hangup`, `startRecording`.
- `TelnyxProvider`: The production implementation using Telnyx Call Control.
- `TwilioProvider`: Development-only implementation.
- `FakeProvider`: Used for fast automated tests.
