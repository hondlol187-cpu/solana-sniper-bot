export interface QueueItem<T> {
  id: string;
  event: T;
  enqueuedAt: number;
}

export interface QueueMetrics {
  enqueued: number;
  processed: number;
  dropped: number;
  duplicates: number;
  currentSize: number;
  overflowCount: number;
  avgWaitMs: number;
  avgProcessMs: number;
}

type DedupKeyFn<T> = (event: T) => string;

export class CandidateQueue<T> {
  private queue: QueueItem<T>[] = [];
  private readonly maxSize: number;
  private readonly dedupKeys: Set<string> =
    new Set();
  private readonly dedupFn: DedupKeyFn<T>;
  private processing = 0;
  private readonly maxConcurrency: number;

  private metrics: QueueMetrics = {
    enqueued: 0,
    processed: 0,
    dropped: 0,
    duplicates: 0,
    currentSize: 0,
    overflowCount: 0,
    avgWaitMs: 0,
    avgProcessMs: 0,
  };

  private totalWaitMs = 0;
  private totalProcessMs = 0;

  constructor(
    maxSize: number,
    dedupFn: DedupKeyFn<T>,
    maxConcurrency = 4
  ) {
    this.maxSize = maxSize;
    this.dedupFn = dedupFn;
    this.maxConcurrency = maxConcurrency;
  }

  enqueue(event: T): boolean {
    const key = this.dedupFn(event);

    if (this.dedupKeys.has(key)) {
      this.metrics.duplicates++;
      return false;
    }

    if (this.queue.length >= this.maxSize) {
      this.metrics.dropped++;
      this.metrics.overflowCount++;
      this.queue.shift();
    }

    this.dedupKeys.add(key);

    this.queue.push({
      id: key,
      event,
      enqueuedAt: Date.now(),
    });

    this.metrics.enqueued++;
    this.metrics.currentSize =
      this.queue.length;

    return true;
  }

  dequeue(): QueueItem<T> | undefined {
    if (this.processing >= this.maxConcurrency) {
      return undefined;
    }

    const item = this.queue.shift();

    if (!item) return undefined;

    this.processing++;
    this.metrics.currentSize =
      this.queue.length;

    return item;
  }

  markProcessed(
    item: QueueItem<T>,
    processDurationMs: number
  ): void {
    this.processing--;
    this.metrics.processed++;

    const waitMs =
      Date.now() - item.enqueuedAt;

    this.totalWaitMs += waitMs;
    this.totalProcessMs += processDurationMs;

    const processedTotal =
      this.metrics.processed;

    this.metrics.avgWaitMs =
      Math.round(
        this.totalWaitMs / processedTotal
      );

    this.metrics.avgProcessMs =
      Math.round(
        this.totalProcessMs /
          processedTotal
      );
  }

  getMetrics(): QueueMetrics {
    return { ...this.metrics };
  }

  getSize(): number {
    return this.queue.length;
  }

  clear(): void {
    this.queue = [];
    this.dedupKeys.clear();
  }
}