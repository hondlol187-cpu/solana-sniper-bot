export interface DeployerRecord {
  address: string;
  launchCount: number;
  rejectedCount: number;
  rugLinked: boolean;
  lastLaunchAt: string;
}

export type DeployerRiskLevel =
  | 'low'
  | 'medium'
  | 'high';

interface DeployerHistoryStore {
  version: 1;
  deployers: DeployerRecord[];
}

const MAX_DEPLOYER_HISTORY = 10_000;
const deployers = new Map<string, DeployerRecord>();

const CHURN_THRESHOLD = 5;
const REJECT_RATIO_THRESHOLD = 0.5;

export function recordLaunch(
  deployerAddress: string
): void {
  const existing = deployers.get(
    deployerAddress
  );

  if (existing) {
    existing.launchCount += 1;
    existing.lastLaunchAt =
      new Date().toISOString();
  } else {
    deployers.set(deployerAddress, {
      address: deployerAddress,
      launchCount: 1,
      rejectedCount: 0,
      rugLinked: false,
      lastLaunchAt:
        new Date().toISOString(),
    });

    if (deployers.size > MAX_DEPLOYER_HISTORY) {
      const oldest = Array.from(
        deployers.entries()
      )
        .sort(
          (a, b) =>
            a[1].lastLaunchAt.localeCompare(
              b[1].lastLaunchAt
            )
        )
        .slice(0, 100);

      for (const [key] of oldest) {
        deployers.delete(key);
      }
    }
  }
}

export function recordRejection(
  deployerAddress: string
): void {
  const existing = deployers.get(
    deployerAddress
  );

  if (existing) {
    existing.rejectedCount += 1;
  } else {
    deployers.set(deployerAddress, {
      address: deployerAddress,
      launchCount: 0,
      rejectedCount: 1,
      rugLinked: false,
      lastLaunchAt:
        new Date().toISOString(),
    });
  }
}

export function flagRugLinked(
  deployerAddress: string
): void {
  const existing = deployers.get(
    deployerAddress
  );

  if (existing) {
    existing.rugLinked = true;
  } else {
    deployers.set(deployerAddress, {
      address: deployerAddress,
      launchCount: 0,
      rejectedCount: 0,
      rugLinked: true,
      lastLaunchAt:
        new Date().toISOString(),
    });
  }
}

export function getDeployerRecord(
  address: string
): DeployerRecord | undefined {
  return deployers.get(address);
}

export function assessDeployerRisk(
  deployerAddress: string
): {
  level: DeployerRiskLevel;
  reasons: string[];
} {
  const record = deployers.get(
    deployerAddress
  );

  if (!record) {
    return { level: 'low', reasons: [] };
  }

  const reasons: string[] = [];
  let level: DeployerRiskLevel = 'low';

  if (record.rugLinked) {
    reasons.push(
      'Deployer has been flagged for rug-pull association'
    );
    level = 'high';
  }

  const rejectRatio =
    record.launchCount > 0
      ? record.rejectedCount /
        record.launchCount
      : 0;

  if (
    rejectRatio > REJECT_RATIO_THRESHOLD &&
    record.rejectedCount > 2
  ) {
    reasons.push(
      `High rejection ratio: ${record.rejectedCount}/${record.launchCount} launches rejected`
    );
    level = 'high';
  }

  if (record.launchCount > CHURN_THRESHOLD) {
    reasons.push(
      `Excessive launch churn: ${record.launchCount} launches`
    );

    if (level === 'low') {
      level = 'medium';
    }
  }

  return { level, reasons };
}

export function clearDeployerHistory(): void {
  deployers.clear();
}