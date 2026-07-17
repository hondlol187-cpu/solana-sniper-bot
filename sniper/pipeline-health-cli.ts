// sniper/pipeline-health-cli.ts
export {};

import { PipelineHealthManager } from './pipeline-health.js';

async function main(): Promise<void> {
  const jsonFlag = process.argv.includes('--json');
  const manager = new PipelineHealthManager();

  manager.registerProvider('raydium');
  manager.registerProvider('pumpfun');

  const summary = await manager.evaluatePipeline();

  if (jsonFlag) {
    console.log(JSON.stringify(summary, null, 2));
  } else {
    console.log('Pipeline Health');
    console.log('='.repeat(40));

    for (const provider of summary.providers) {
      console.log(`\n  ${provider.providerName}: ${provider.state}`);
      console.log(`    Slot lag: ${provider.slotLag ?? 'N/A'}`);
      console.log(`    Queue depth: ${provider.queueDepth}`);
      console.log(`    Errors (1m): ${provider.errorsInWindow}`);
      console.log(`    Reconnects: ${provider.reconnectCount}`);
      console.log(`    p50/p95/p99: ${provider.p50LatencyMs}/${provider.p95LatencyMs}/${provider.p99LatencyMs}ms`);
    }

    console.log(`\nTotal queued: ${summary.totalQueued}`);
    console.log(`Total dropped: ${summary.totalDropped}`);
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});