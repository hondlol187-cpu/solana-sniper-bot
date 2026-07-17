# Shadow Soak Runbook

## Purpose
Validate the complete sniper pipeline remains stable over sustained operation before expanded mainnet use.

## Prerequisites
- `SHADOW_MODE=true`
- `LIVE_TRADING` must be unset or `false`
- `ENABLE_MAINNET_EXECUTION` must be unset or `false`
- No wallet private key required

## Running a Soak Test

### Short CI Soak (1 minute, deterministic)
```bash
SHADOW_MODE=true bun run sniper:shadow-soak -- --duration-minutes 1
```

### Extended Soak (24+ hours)
```bash
SHADOW_MODE=true \
SHADOW_REPORT_DIRECTORY=.sniper/shadow-reports \
SHADOW_MAX_CANDIDATES_PER_HOUR=1000 \
SHADOW_REPORT_RETENTION_DAYS=14 \
bun run sniper:shadow-soak -- --duration-minutes 1440
```

## Acceptance Criteria
| Criterion | Threshold |
|-----------|-----------|
| Signing/broadcast calls | Zero |
| Unhandled promise rejections | Zero |
| Evidence-integrity failures | Zero |
| Queue-overflow data loss without audit | Zero |
| Memory growth | Bounded |
| Stale candidate accepted | Zero |
| Duplicate candidate promoted | Zero |
| Clean shutdown with flushed reports | Yes |

## Interpreting Results
The soak report includes `acceptanceCriteria` which lists pass/fail for each criterion.
Any failure blocks release readiness.

## CI Integration
CI runs a short deterministic soak via the chain-event replay corpus.
The real 24-hour soak runs manually or through a scheduled workflow.