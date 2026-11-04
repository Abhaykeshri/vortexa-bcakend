import { loadConfig } from '../dist/apps/api/src/config/env.js';
import {
  AbiEventDecoder,
  IndexerRpcOperationError,
  ViemIndexerSource,
} from '../dist/packages/adapters/src/indexer/viem-indexer-source.adapter.js';
import { orderedLogs } from '../dist/packages/application/src/blockchain-indexer.service.js';
process.on('uncaughtException', reportSanitizedFailure);
process.on('unhandledRejection', reportSanitizedFailure);
const config = loadConfig(undefined, undefined, 'tool');
const chainId = config.chainId;
const from = 12032363n;
// Keep the live sample inside restricted provider ranges. Wide-range adaptive
// splitting is covered deterministically by the automated test suite.
const to = from + 9n;
const source = new ViemIndexerSource(
  chainId,
  config.rpcUrls,
  new AbiEventDecoder(config.contracts, config.manifest),
);
await source.verifyChain(chainId);
const heads = await source.heads();
const first = await source.block(from);
const second = await source.block(from + 1n);
const last = await source.block(to);
if (second.parentHash.toLowerCase() !== first.hash.toLowerCase())
  throw new Error('Live header continuity failed');
const logs = orderedLogs(await source.logs(from, to, Object.values(config.contracts)));
const identities = new Set(logs.map((l) => `${l.transactionHash}:${l.logIndex}:${l.blockHash}`));
if (identities.size !== logs.length) throw new Error('Duplicate live log identity');
console.log(
  JSON.stringify({
    result: 'PASS',
    chainId,
    range: `${from}-${to}`,
    latest: heads.latest.toString(),
    confirmed: heads.confirmed?.toString() ?? null,
    finalized: heads.finalized?.toString() ?? null,
    firstHashPresent: Boolean(first.hash),
    lastHashPresent: Boolean(last.hash),
    logs: logs.length,
    decoded: logs.filter((l) => l.eventName).length,
    unknown: logs.filter((l) => !l.eventName).length,
  }),
);

function reportSanitizedFailure(error) {
  console.error(
    JSON.stringify({
      event: 'live_indexer_verification_failed',
      errorType: error instanceof Error ? error.name : 'unknown',
      ...(error instanceof IndexerRpcOperationError
        ? {
            operation: error.operation,
            fromBlock: error.fromBlock?.toString(),
            toBlock: error.toBlock?.toString(),
            rpcCode: error.rpcCode,
            rpcCauseType: error.rpcCauseType,
          }
        : {}),
    }),
  );
  process.exitCode = 1;
}
