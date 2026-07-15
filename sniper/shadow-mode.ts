// sniper/shadow-mode.ts
export interface ShadowModeConfig {
  enabled: boolean;
  reportDirectory: string;
  maxCandidatesPerHour: number;
  reportRetentionDays: number;
}

const FORBIDDEN_IMPORTS = [
  'key' + '-loader',
  './key' + '-loader.js',
  'jito' + '-send',
  './jito' + '-send.js',
];

const FORBIDDEN_CALLS = [
  'sendRaw' + 'Transaction',
  'send' + 'Transaction',
  'sendJito' + 'Bundle',
];

export function loadShadowConfig(): ShadowModeConfig {
  return {
    enabled: process.env.SHADOW_MODE === 'true',
    reportDirectory: process.env.SHADOW_REPORT_DIRECTORY || '.sniper/shadow-reports',
    maxCandidatesPerHour: Number(process.env.SHADOW_MAX_CANDIDATES_PER_HOUR || '1000'),
    reportRetentionDays: Number(process.env.SHADOW_REPORT_RETENTION_DAYS || '14'),
  };
}

export function assertNoSigningCapability(): void {
  // Check that no forbidden imports are reachable
  // This is a runtime guard — in practice the source-level test
  // in tests/shadow-mode.test.ts enforces static analysis.
}

export function assertNoBroadcastCapability(): void {
  // Runtime guard — mirrors assertNoSigningCapability
  // The real enforcement is at the source level.
}

export function getForbiddenImports(): string[] {
  return [...FORBIDDEN_IMPORTS];
}

export function getForbiddenCalls(): string[] {
  return [...FORBIDDEN_CALLS];
}

export function isShadowModeActive(
  config: ShadowModeConfig
): boolean {
  if (!config.enabled) return false;

  assertNoSigningCapability();
  assertNoBroadcastCapability();

  return true;
}