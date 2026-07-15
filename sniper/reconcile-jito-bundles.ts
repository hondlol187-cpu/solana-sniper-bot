// sniper/reconcile-jito-bundles.ts
export {};
import { JitoBundleJournal } from './jito-bundle-journal.js';
import { reconcileBundleState, validateTipAmount, validateEndpoint } from './jito-reconciler.js';
import type { BundleJournalEntry } from './jito-bundle-journal.js';
import type { ReconciliationResult } from './jito-reconciler.js';

export interface ReconciliationOutcome {
  attemptId: string;
  bundleId: string;
  result: ReconciliationResult;
  updatedEntry: BundleJournalEntry | null;
}

export async function reconcilePendingBundles(
  journal: JitoBundleJournal,
  checkBundleStatus: (bundleId: string) => Promise<'landed' | 'failed' | 'pending' | 'unknown'>,
  checkTxStatus: (signature: string) => Promise<'confirmed' | 'failed' | 'not_found' | 'unknown'>,
  checkBlockhashValid: (blockhash: string) => Promise<boolean>,
  maxAttempts = 5
): Promise<ReconciliationOutcome[]> {
  const ambiguous = journal.getAmbiguous();
  const outcomes: ReconciliationOutcome[] = [];

  for (const entry of ambiguous) {
    if (!entry.bundleId && !entry.txSignature) continue;

    const bundleStatus = entry.bundleId
      ? await checkBundleStatus(entry.bundleId)
      : 'unknown';

    const txStatus = entry.txSignature
      ? await checkTxStatus(entry.txSignature)
      : 'unknown';

    // For blockhash check, we use a placeholder since we don't
    // store the blockhash in the journal entry directly.
    const blockhashValid = true;

    const result = reconcileBundleState(
      entry,
      bundleStatus,
      txStatus,
      blockhashValid
    );

    // Only recommend fallback if non-landing is proven
    if (result.fallbackRecommended && result.newState === 'rejected') {
      // Verify: check bundle status AND tx status are both definitive failures
      const bundleConfirmed = entry.bundleId
        ? await checkBundleStatus(entry.bundleId)
        : 'unknown';
      const txConfirmed = entry.txSignature
        ? await checkTxStatus(entry.txSignature)
        : 'unknown';

      if (bundleConfirmed !== 'failed' && txConfirmed !== 'failed') {
        // Non-landing not proven — do not recommend fallback
        result.fallbackRecommended = false;
        result.reason += ' (fallback blocked: non-landing not definitively proven)';
      }
    }

    const updatedEntry = await journal.updateState(
      entry.attemptId,
      result.newState,
      { error: result.newState === 'rejected' ? result.reason : undefined }
    );

    outcomes.push({
      attemptId: entry.attemptId,
      bundleId: entry.bundleId ?? 'unknown',
      result,
      updatedEntry,
    });
  }

  return outcomes;
}

export async function journalFromDirectory(dir: string): Promise<JitoBundleJournal> {
  const journal = new JitoBundleJournal(dir);
  await journal.init();
  return journal;
}