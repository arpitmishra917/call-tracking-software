$ErrorActionPreference = "Stop"
$env:CALLFLOW_QA2D_EXECUTE = "true"
$env:DATABASE_URL = "postgresql://callflow_qa_user:cfqa_pg_83538438661833bab5b5741ec8b903593e00a675@127.0.0.1:5433/callflow_qa?schema=public"
$env:TELEPHONY_QA_ENABLED = "true"
$env:TELNYX_QA_TRACKING_DID = "+17252574041"
$env:TELNYX_QA_CALL_CONTROL_APP_ID = "3090207513618941231"
$env:TELEPHONY_QA_ALLOWED_DESTINATIONS = "+12025550199,+12025550198,+12025550197"
$env:QA_WORKSPACE_ID = "5e20bafe-7306-4da7-9944-62c4c5575a5a"
$env:QA_CAMPAIGN_ID = "6af31407-3f46-4f1d-90d0-bf08af2e9600"
$env:TELEPHONY_QA_BUYER_SIP_URI = "sip:arpitmishra9178@sip.telnyx.com"
$env:TELEPHONY_QA_CALLER_SIP_URI = "sip:arpitmishra917@sip.telnyx.com"

Set-Location -Path $PSScriptRoot
npx vitest run test/multi-workspace-isolation.e2e-spec.ts --config vitest.config.qa.ts
