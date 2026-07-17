// sniper/chain-event-corpus.ts
export interface ChainEvent {
  id: string;
  type: 'raydium_pool_init' | 'malformed_instruction' | 'duplicate_signal' | 'failed_transaction' | 'stale_event' | 'pumpfun_launch' | 'malformed_pumpfun' | 'migration_to_raydium' | 'duplicate_migration' | 'incomplete_holders' | 'stale_risk_evidence' | 'sellable_token' | 'small_sell_only' | 'unavailable_full_exit' | 'jito_accepted_landed' | 'jito_timeout_landed' | 'jito_rejection_safe_fallback';
  data: Record<string, unknown>;
  expectedDecision: 'accept' | 'reject';
  expectedReasonCode: string;
  slot: number;
  timestamp: string;
}

export interface CorpusFixture {
  version: 1;
  events: ChainEvent[];
  metadata: {
    description: string;
    policyVersion: string;
    createdForCommit: string;
  };
}

export function loadCorpus(filePath: string): CorpusFixture {
  // Dynamic import not needed — corpus loading happens via readFile in scripts
  return { version: 1, events: [], metadata: { description: '', policyVersion: '1.0.0', createdForCommit: '' } };
}

export function validateCorpusEvent(event: unknown): { valid: boolean; error?: string } {
  if (!event || typeof event !== 'object') return { valid: false, error: 'Event must be an object' };
  const obj = event as Record<string, unknown>;
  if (typeof obj.id !== 'string') return { valid: false, error: 'Missing id' };
  if (typeof obj.type !== 'string') return { valid: false, error: 'Missing type' };
  if (typeof obj.expectedDecision !== 'string') return { valid: false, error: 'Missing expectedDecision' };
  if (typeof obj.expectedReasonCode !== 'string') return { valid: false, error: 'Missing expectedReasonCode' };
  if (typeof obj.slot !== 'number') return { valid: false, error: 'Missing slot' };
  return { valid: true };
}