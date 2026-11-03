import { loadConfig } from '../dist/apps/api/src/config/env.js';
import { AbiEventDecoder, ViemIndexerSource } from '../dist/packages/adapters/src/indexer/viem-source.js';
import { orderedLogs } from '../dist/packages/application/src/indexer.js';
const config = loadConfig();
const chainId = config.chainId;
const from = 12032363n;
const to = 12032735n;
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
