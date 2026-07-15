// sniper/jito-reconciler.ts
import type { BundleJournalEntry } from './jito-bundle-journal.js';

export type BundleState =
  | 'prepared'
  | 'submitted'
  | 'accepted'
  | 'landed'
  | 'rejected'
  | 'expired'
  | 'ambiguous'
  | 'reconciled';

export interface ReconciliationResult {
  bundleId: string;
  previousState: BundleState;
  newState: BundleState;
  reason: string;
  reconciledAt: string;
  fallbackRecommended: boolean;
}

export interface ReconcilerConfig {
  ambiguousTimeoutMs: number;
  maxReconcileAttempts: number;
  endpointAllowlist: string[];
  tipAccountAllowlist: string[];
  maxAbsoluteTipLamports: number;
  maxTipBpsOfPosition: number;
}

const DEFAULT_CONFIG: ReconcilerConfig = {
  ambiguousTimeoutMs: 30_000,
  maxReconcileAttempts: 5,
  endpointAllowlist: [
    'https://mainnet.block-engine.jito.wtf/api/v1/bundles',
    'https://amsterdam.mainnet.block-engine.jito.wtf/api/v1/bundles',
    'https://tokyo.mainnet.block-engine.jito.wtf/api/v1/bundles',
  ],
  tipAccountAllowlist: [],
  maxAbsoluteTipLamports: 1_000_000,
  maxTipBpsOfPosition: 100,
};

export function validateTipAmount(
  tipLamports: number,
  positionValueLamports: number,
  config?: Partial<ReconcilerConfig>
): { valid: boolean; reason?: string } {
  const cfg = { ...DEFAULT_CONFIG, ...config };

  if (tipLamports > cfg.maxAbsoluteTipLamports) {
    return {
      valid: false,
      reason: `Tip ${tipLamports} lamports exceeds maximum ${cfg.maxAbsoluteTipLamports}`,
    };
  }

  const tipBps = (tipLamports / positionValueLamports) * 10_000;
  if (tipBps > cfg.maxTipBpsOfPosition) {
    return {
      valid: false,
      reason: `Tip ${tipBps.toFixed(1)} bps of position exceeds maximum ${cfg.maxTipBpsOfPosition} bps`,
    };
  }

  return { valid: true };
}

export function validateEndpoint(
  endpoint: string,
  config?: Partial<ReconcilerConfig>
): { valid: boolean; reason?: string } {
  const cfg = { ...DEFAULT_CONFIG, ...config };

  if (!cfg.endpointAllowlist.includes(endpoint)) {
    return {
      valid: false,
      reason: `Endpoint not in allowlist: ${endpoint}`,
    };
  }

  return { valid: true };
}

export function validateTipAccount(
  tipAccount: string,
  config?: Partial<ReconcilerConfig>
): { valid: boolean; reason?: string } {
  const cfg = { ...DEFAULT_CONFIG, ...config };

  if (cfg.tipAccountAllowlist.length > 0 && !cfg.tipAccountAllowlist.includes(tipAccount)) {
    return {
      valid: false,
      reason: `Tip account not in allowlist: ${tipAccount}`,
    };
  }

  return { valid: true };
}

const VALID_TRANSITIONS: Partial<Record<BundleState, Set<BundleState>>> = {
  'prepared': new Set(['submitted', 'rejected']),
  'submitted': new Set(['accepted', 'rejected', 'ambiguous', 'landed']),
  'accepted': new Set(['landed', 'rejected', 'ambiguous', 'expired']),
  'ambiguous': new Set(['landed', 'rejected', 'reconciled']),
  'rejected': new Set(),
  'landed': new Set(),
  'expired': new Set(['reconciled']),
};

export function reconcileBundleState(
  entry: BundleJournalEntry,
  bundleStatus: 'landed' | 'failed' | 'pending' | 'unknown',
  txStatus: 'confirmed' | 'failed' | 'not_found' | 'unknown',
  blockhashValid: boolean,
  currentSlot?: number
): ReconciliationResult {
  const previousState = entry.submissionState;
  let newState: BundleState = previousState;
  let reason = '';
  let fallbackRecommended = false;

  if (previousState === 'submitted') {
    if (bundleStatus === 'landed' || txStatus === 'confirmed') {
      newState = 'landed';
      reason = 'Bundle landed or transaction confirmed';
    } else if (bundleStatus === 'failed' && txStatus === 'failed') {
      newState = 'rejected';
      reason = 'Bundle and transaction both failed';
      fallbackRecommended = false;
    } else if (bundleStatus === 'pending' || txStatus === 'not_found') {
      // Check if timed out (becomes ambiguous, not failed)
      if (blockhashValid) {
        newState = 'ambiguous';
        reason = 'Bundle status unclear — blockhash still valid, response was ambiguous';
        fallbackRecommended = false;
      } else {
        newState = 'rejected';
        reason = 'Blockhash expired, bundle did not land';
        fallbackRecommended = true;
      }
    } else {
      newState = 'ambiguous';
      reason = 'Bundle status unknown after submission';
      fallbackRecommended = false;
    }
  } else if (previousState === 'ambiguous') {
    if (bundleStatus === 'landed' || txStatus === 'confirmed') {
      newState = 'landed';
      reason = 'Bundle ultimately landed after ambiguous period';
    } else if (bundleStatus === 'failed' || txStatus === 'failed') {
      newState = 'rejected';
      reason = 'Bundle ultimately failed after ambiguous period';
      fallbackRecommended = false;
    } else {
      newState = 'reconciled';
      reason = 'Ambiguity resolved — no landing confirmed, non-landing proven';
      fallbackRecommended = true;
    }
  } else if (previousState === 'accepted') {
    if (txStatus === 'confirmed') {
      newState = 'landed';
      reason = 'Transaction confirmed after acceptance';
    } else if (bundleStatus === 'failed') {
      newState = 'rejected';
      reason = 'Bundle failed after acceptance';
    } else if (!blockhashValid) {
      newState = 'expired';
      reason = 'Blockhash expired before landing';
    }
  } else {
    // Terminal or unhandled states: no reconciliation logic applies
    const allowed = VALID_TRANSITIONS[previousState];
    if (allowed && allowed.size === 0) {
      return {
        bundleId: entry.bundleId ?? 'unknown',
        previousState,
        newState: previousState,
        reason: `Invalid state transition: ${previousState} → ${newState}`,
        reconciledAt: new Date().toISOString(),
        fallbackRecommended: false,
      };
    }
  }

  // Validate transition
  const allowedTransitions = VALID_TRANSITIONS[previousState];
  if (allowedTransitions && !allowedTransitions.has(newState) && newState !== previousState) {
    return {
      bundleId: entry.bundleId ?? 'unknown',
      previousState,
      newState: previousState, // Stay in current state
      reason: `Invalid state transition: ${previousState} → ${newState}`,
      reconciledAt: new Date().toISOString(),
      fallbackRecommended: false,
    };
  }

  return {
    bundleId: entry.bundleId ?? 'unknown',
    previousState,
    newState,
    reason,
    reconciledAt: new Date().toISOString(),
    fallbackRecommended,
  };
}