export interface SellabilityReport {
  sellable: boolean;
  hardReject: boolean;
  estimatedBuyOutAmount?: string;
  estimatedSellBackAmount?: string;
  effectiveRoundTripLossBps?: number;
  reasons: string[];
  warnings: string[];
}

export interface SellabilityArtifact {
  version: 1;
  planId: string;
  mintAddress: string;
  assessedAt: string;
  report: SellabilityReport;
  routeSource?: string;
  quoteTimestamp?: string;
  rejectionReason?: string;
}