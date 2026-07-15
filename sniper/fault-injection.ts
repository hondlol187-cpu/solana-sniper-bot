export type ExecutionCheckpoint =
  | 'risk-reserved'
  | 'signing-recorded'
  | 'broadcast-prepared'
  | 'transaction-sent'
  | 'submitted-recorded'
  | 'risk-settled'
  | 'execution-terminal'
  | 'plan-outcome-recorded'
  | 'audit-recorded'
  | 'archive-written'
  | 'archive-indexed';

export interface FaultInjector {
  checkpoint(
    checkpoint: ExecutionCheckpoint
  ): Promise<void>;
}

export const noFaults: FaultInjector = {
  async checkpoint() {},
};

/**
 * Creates a FaultInjector that throws at the specified
 * checkpoint on the Nth call (default: 1st). After the
 * throw, subsequent calls pass through, simulating a
 * process restart after the crash.
 */
export function faultAt(
  checkpoint: ExecutionCheckpoint,
  callCount: number = 1
): FaultInjector {
  let hits = 0;

  return {
    async checkpoint(cp: ExecutionCheckpoint) {
      if (cp === checkpoint) {
        hits += 1;

        if (hits === callCount) {
          throw new Error(
            `Injected fault at checkpoint: ${checkpoint}`
          );
        }
      }
    },
  };
}
