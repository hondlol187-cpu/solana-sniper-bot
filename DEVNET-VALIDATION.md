# Devnet Validation Runbook

## Prerequisites

```bash
export EXPECTED_CLUSTER=devnet
export LIVE_TRADING=false
export ENABLE_MAINNET_EXECUTION=false

npm ci
npm run verify
```

## Phase 1 — Readiness checks (no broadcast)

```bash
npm run sniper:release-readiness -- --json
npm run sniper:doctor-approved-plans -- --json
npm run sniper:doctor-executions -- --json
npm run sniper:verify-plan-history -- --json
npm run sniper:verify-execution-archives -- --json
```

### Acceptance criteria

- Every command exits `0`.
- No transaction is broadcast.
- No unresolved journals, settlements, or risk reservations.
- Repeating any command changes nothing (idempotent).

## Phase 2 — Full devnet simulation flow

```bash
npm run sniper:prepare-approved -- <SIGNATURE> <MINT>
npm run sniper:simulate-approved-plan -- <PLAN_ID>
npm run sniper:preview-verified-execution -- <PLAN_ID> --json
npm run sniper:verify-simulation-artifact -- <PLAN_ID> --json
npm run sniper:execution-history -- <PLAN_ID> --json
npm run sniper:release-readiness -- --json
```

### Acceptance criteria

- Every command exits `0`.
- No transaction is broadcast during simulation or preview.
- Artifact, receipt, manifest, policy, plan, and archive hashes verify.
- The preview's confirmation phrase includes plan ID, artifact ID, buy lamports, and mint.
- The execution history CLI shows the plan, journal, and receipt.

## Phase 3 — Negative tests

### Wrong confirmation phrase

```bash
npm run sniper:execute-simulated-plan -- <PLAN_ID> --live CONFIRM:wrong
# Must exit non-zero with "Exact confirmation phrase required"
```

### Wrong wallet

```bash
# Set WALLET_PUBLIC_KEY to a different address
npm run sniper:preview-verified-execution -- <PLAN_ID> --json
# Must exit non-zero with "fee payer does not match receipt"
```

### Wrong cluster

```bash
export EXPECTED_CLUSTER=mainnet-beta
npm run sniper:release-readiness -- --json
# Must report "RELEASE NOT READY" (mainnet without ENABLE_MAINNET_EXECUTION)
export EXPECTED_CLUSTER=devnet
```

### Modified artifact bytes

```bash
# Manually edit the artifact file's serializedTransactionBase64
npm run sniper:verify-simulation-artifact -- <PLAN_ID> --json
# Must exit non-zero with hash mismatch
```

### Wrong signature

```bash
# Manually edit the journal's transactionSignature
npm run sniper:doctor-executions -- --json
# Must report hash mismatch or invalid signature
```

## Phase 4 — Live devnet execution (optional, requires burner wallet)

```bash
export LIVE_TRADING=true
export ENABLE_MAINNET_EXECUTION=false  # devnet doesn't need this
# Set PRIVATE_KEY_FILE to burner devnet wallet

npm run sniper:preview-verified-execution -- <PLAN_ID> --json
# Review the confirmation phrase

npm run sniper:execute-simulated-plan -- <PLAN_ID> --live CONFIRM:<PLAN_ID>:<ARTIFACT_ID>:<BUY_LAMPORTS>:<MINT>
# Must submit exactly one transaction

npm run sniper:reconcile-executions -- --json
# Must confirm or fail the execution

npm run sniper:doctor-executions -- --json
# Must show healthy state

npm run sniper:archive-execution-evidence -- <PLAN_ID> ARCHIVE:<PLAN_ID>
# Must archive without deleting originals

npm run sniper:verify-execution-archives -- --json
# Must verify archives and index
```
