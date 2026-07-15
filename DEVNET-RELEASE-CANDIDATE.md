# Devnet Release-Candidate Validation Report Schema

## Required fields

```json
{
  "version": 1,
  "generatedAt": "ISO-8601",
  "cluster": "devnet",
  "planId": "string",
  "planInstanceId": "string",
  "executionId": "string",
  "artifactId": "string",
  "transactionSignature": "string or null",

  "hashes": {
    "artifactSha256": "hex",
    "serializedTransactionSha256": "hex",
    "transactionMessageSha256": "hex",
    "transactionPolicySha256": "hex",
    "journalSha256": "hex",
    "settlementSha256": "hex",
    "bundleSha256": "hex",
    "archiveSha256": "hex",
    "archiveIndexEntryHash": "hex or null"
  },

  "outcome": "confirmed or failed",
  "observedSlot": "number",
  "confirmationStatus": "confirmed or finalized or null",

  "riskBefore": {
    "completedTrades": "number",
    "reservations": "number",
    "spentLamports": "string",
    "haltedReason": "string or null"
  },

  "riskAfter": {
    "completedTrades": "number",
    "reservations": "number",
    "spentLamports": "string",
    "haltedReason": "string or null"
  },

  "recoveryResults": {
    "reconcileExecutions": "unchanged or changed",
    "recoverStaleSigning": "skipped or recovered",
    "recoverExecutionSettlements": "skipped or recovered",
    "doctorExecutions": "healthy or needs-attention",
    "releaseReadiness": "ready or not-ready"
  },

  "auditEvents": {
    "ready": "number",
    "broadcasting": "number",
    "submitted": "number",
    "confirmed": "number",
    "failed": "number"
  }
}
```

## Acceptance criteria

- Exactly one `transactionSignature` (or null if broadcast failed)
- `riskAfter.completedTrades` - `riskBefore.completedTrades` <= 1
- `riskAfter.reservations` == 0
- `auditEvents.confirmed` + `auditEvents.failed` == 1
- All `recoveryResults` are "unchanged", "skipped", or "healthy"
- `recoveryResults.releaseReadiness` == "ready" (or "not-ready" if RPC unavailable)
- No secrets or raw private keys in the report
- Report hash (SHA-256 over the report excluding the hash field) must be valid

## How to generate

```bash
# Set up devnet environment
export EXPECTED_CLUSTER=devnet
export LIVE_TRADING=true  # only for the execution step
export ENABLE_MAINNET_EXECUTION=false

# Prepare and simulate
npm run sniper:prepare-approved -- <SIGNATURE> <MINT>
npm run sniper:simulate-approved-plan -- <PLAN_ID>

# Preview and verify (offline)
npm run sniper:preview-verified-execution -- <PLAN_ID> --json
npm run sniper:verify-simulation-artifact -- <PLAN_ID> --json

# Execute (requires explicit confirmation)
npm run sniper:execute-simulated-plan -- <PLAN_ID> --live CONFIRM:<PLAN_ID>:<ARTIFACT_ID>:<BUY_LAMPORTS>:<MINT>

# Reconcile
npm run sniper:reconcile-executions -- --json

# Archive
npm run sniper:archive-execution-evidence -- <PLAN_ID> ARCHIVE:<PLAN_ID>

# Verify everything
npm run sniper:verify-execution-archives -- --json
npm run sniper:doctor-executions -- --json
npm run sniper:release-readiness -- --json

# Re-run recovery (must produce no changes)
npm run sniper:reconcile-executions -- --json
npm run sniper:recover-stale-signing -- --older-than-seconds 60 --json
npm run sniper:recover-execution-settlements -- --json
```
