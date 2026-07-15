import type {
  PumpfunMigrationCandidate,
} from './pumpfun-types.js';

interface MigrationRecord {
  version: 1;
  migrations: MigrationEntry[];
}

interface MigrationEntry {
  mint: string;
  raydiumPoolAddress?: string;
  migrationSignature?: string;
  migrationDetectedAt: string;
  previousLifecycleStage: string;
  bondingCurveComplete: boolean;
}

const trackedMigrations = new Map<
  string,
  MigrationEntry
>();

export function trackMigration(
  candidate: PumpfunMigrationCandidate
): {
  tracked: boolean;
  reason?: string;
} {
  const existing = trackedMigrations.get(
    candidate.mint
  );

  if (existing) {
    return {
      tracked: false,
      reason:
        'Duplicate migration already tracked for this mint',
    };
  }

  const entry: MigrationEntry = {
    mint: candidate.mint,
    raydiumPoolAddress:
      candidate.raydiumPoolAddress,
    migrationSignature:
      candidate.migrationSignature,
    migrationDetectedAt:
      candidate.migrationDetectedAt,
    previousLifecycleStage:
      candidate.previousLifecycleStage,
    bondingCurveComplete:
      candidate.bondingCurveComplete,
  };

  trackedMigrations.set(candidate.mint, entry);

  return { tracked: true };
}

export function linkMigrationToRaydiumPool(
  mint: string,
  raydiumPoolAddress: string
): {
  linked: boolean;
  reason?: string;
} {
  const entry = trackedMigrations.get(mint);

  if (!entry) {
    return {
      linked: false,
      reason:
        'No tracked migration found for this mint',
    };
  }

  if (entry.raydiumPoolAddress) {
    return {
      linked: false,
      reason:
        'Migration already linked to a Raydium pool',
    };
  }

  entry.raydiumPoolAddress =
    raydiumPoolAddress;

  return { linked: true };
}

export function getMigrationByMint(
  mint: string
): MigrationEntry | undefined {
  return trackedMigrations.get(mint);
}

export function getAllMigrations(): MigrationEntry[] {
  return Array.from(
    trackedMigrations.values()
  );
}

export async function detectMigrationAndLink(
  candidate: PumpfunMigrationCandidate
): Promise<{
  accepted: boolean;
  reason?: string;
}> {
  const migrationResult =
    trackMigration(candidate);

  if (!migrationResult.tracked) {
    try {
      const { audit } = await import('./audit.js');
      await audit(
        'pumpfun.migration.duplicate',
        {
          mint: candidate.mint,
          reason: migrationResult.reason,
        }
      );
    } catch {
      /* audit not available in test env */
    }

    return {
      accepted: false,
      reason: migrationResult.reason,
    };
  }

  try {
    const { audit } = await import('./audit.js');
    await audit(
      'pumpfun.migration.detected',
      {
        mint: candidate.mint,
        raydiumPoolAddress:
          candidate.raydiumPoolAddress,
        migrationSignature:
          candidate.migrationSignature,
        previousLifecycleStage:
          candidate.previousLifecycleStage,
      }
    );
  } catch {
    /* audit not available in test env */
  }

  if (candidate.raydiumPoolAddress) {
    const linkResult =
      linkMigrationToRaydiumPool(
        candidate.mint,
        candidate.raydiumPoolAddress
      );

    if (linkResult.linked) {
      try {
        const { audit } = await import('./audit.js');
        await audit(
          'pumpfun.candidate.promoted',
          {
            mint: candidate.mint,
            raydiumPoolAddress:
              candidate.raydiumPoolAddress,
            lifecycleStage: 'raydium_pool_validated',
          }
        );
      } catch {
        /* audit not available in test env */
      }
    }
  }

  return { accepted: true };
}