export interface LatencySample {
  stage: string;
  durationMs: number;
  timestamp: string;
}

export interface LatencyMetrics {
  detection: LatencySample[];
  decode: LatencySample[];
  validation: LatencySample[];
  promotion: LatencySample[];
}

export interface LatencySummary {
  avgDetectionMs: number;
  avgDecodeMs: number;
  avgValidationMs: number;
  avgPromotionMs: number;
  totalAvgMs: number;
  sampleCount: number;
}

const MAX_SAMPLES = 1000;

export class LatencyTracker {
  private samples: LatencyMetrics = {
    detection: [],
    decode: [],
    validation: [],
    promotion: [],
  };

  recordDetection(durationMs: number): void {
    this.pushSample(
      'detection',
      durationMs
    );
  }

  recordDecode(durationMs: number): void {
    this.pushSample(
      'decode',
      durationMs
    );
  }

  recordValidation(
    durationMs: number
  ): void {
    this.pushSample(
      'validation',
      durationMs
    );
  }

  recordPromotion(
    durationMs: number
  ): void {
    this.pushSample(
      'promotion',
      durationMs
    );
  }

  private pushSample(
    stage: keyof LatencyMetrics,
    durationMs: number
  ): void {
    const arr = this.samples[stage];

    arr.push({
      stage,
      durationMs,
      timestamp:
        new Date().toISOString(),
    });

    while (arr.length > MAX_SAMPLES) {
      arr.shift();
    }
  }

  getSummary(): LatencySummary {
    const avg = (
      arr: LatencySample[]
    ) =>
      arr.length > 0
        ? Math.round(
            arr.reduce(
              (s, v) =>
                s + v.durationMs,
              0
            ) / arr.length
          )
        : 0;

    const avgDetection = avg(
      this.samples.detection
    );
    const avgDecode = avg(
      this.samples.decode
    );
    const avgValidation = avg(
      this.samples.validation
    );
    const avgPromotion = avg(
      this.samples.promotion
    );

    return {
      avgDetectionMs: avgDetection,
      avgDecodeMs: avgDecode,
      avgValidationMs: avgValidation,
      avgPromotionMs: avgPromotion,
      totalAvgMs:
        avgDetection +
        avgDecode +
        avgValidation +
        avgPromotion,
      sampleCount: Object.values(
        this.samples
      ).reduce(
        (s, arr) => s + arr.length,
        0
      ),
    };
  }

  getMetrics(): LatencyMetrics {
    return {
      detection: [
        ...this.samples.detection,
      ],
      decode: [...this.samples.decode],
      validation: [
        ...this.samples.validation,
      ],
      promotion: [
        ...this.samples.promotion,
      ],
    };
  }

  clear(): void {
    this.samples = {
      detection: [],
      decode: [],
      validation: [],
      promotion: [],
    };
  }
}