import { readFileSync } from 'node:fs';
import {
  createPublicClient,
  decodeEventLog,
  encodeFunctionData,
  fallback,
  getAddress,
  http,
  keccak256,
  toBytes,
  zeroAddress,
  zeroHash,
} from 'viem';
import { sepolia } from 'viem/chains';
import { loadConfig } from '../dist/apps/api/src/config/env.js';

process.on('uncaughtException', reportSanitizedFailure);
process.on('unhandledRejection', reportSanitizedFailure);

const REQUIRED_DELAY_SECONDS = 172800n;
const config = loadConfig(undefined, undefined, 'tool');
const address = getAddress(config.contracts.TIMELOCK_CONTROLLER);
const abi = JSON.parse(
  readFileSync('packages/adapters/abis/TimelockController.json', 'utf8').replace(/^\uFEFF/, ''),
);
const client = createPublicClient({
  chain: sepolia,
  transport:
    config.rpcUrls.length === 1
      ? http(config.rpcUrls[0], { timeout: config.rpcTimeoutMs, retryCount: config.rpcMaxRetries })
      : fallback(
          config.rpcUrls.map((url) =>
            http(url, { timeout: config.rpcTimeoutMs, retryCount: config.rpcMaxRetries }),
          ),
        ),
});

const chainId = await client.getChainId();
if (chainId !== config.chainId) throw new Error(`RPC chain mismatch: ${chainId}`);
const finalizedBlock = await client.getBlock({ blockTag: 'finalized' });
const deploymentBlock = process.env.TIMELOCK_DEPLOYMENT_BLOCK
  ? validatedBlock(process.env.TIMELOCK_DEPLOYMENT_BLOCK, finalizedBlock.number)
  : await findDeploymentBlock(finalizedBlock.number);
const logs = await contractLogs(deploymentBlock, finalizedBlock.number);
const decodedLogs = logs.flatMap((log) => {
  try {
    return [{ ...log, ...decodeEventLog({ abi, data: log.data, topics: log.topics }) }];
  } catch {
    return [];
  }
});

const roleNames = ['DEFAULT_ADMIN_ROLE', 'PROPOSER_ROLE', 'EXECUTOR_ROLE', 'CANCELLER_ROLE'];
const roleIds = Object.fromEntries(
  await Promise.all(
    roleNames.map(async (role) => [role, await client.readContract({ address, abi, functionName: role })]),
  ),
);
const members = new Map(Object.values(roleIds).map((role) => [String(role).toLowerCase(), new Set()]));
const delayHistory = [];
for (const log of decodedLogs) {
  if (log.eventName === 'RoleGranted' || log.eventName === 'RoleRevoked') {
    const role = String(log.args.role).toLowerCase();
    const account = getAddress(log.args.account);
    const accounts = members.get(role) ?? new Set();
    if (log.eventName === 'RoleGranted') accounts.add(account);
    else accounts.delete(account);
    members.set(role, accounts);
  }
  if (log.eventName === 'MinDelayChange')
    delayHistory.push({
      blockNumber: log.blockNumber.toString(),
      oldDuration: log.args.oldDuration.toString(),
      newDuration: log.args.newDuration.toString(),
    });
}

const roles = {};
for (const [name, role] of Object.entries(roleIds)) {
  const observed = [...(members.get(String(role).toLowerCase()) ?? [])];
  const candidates = [...new Set([address, zeroAddress, ...observed])];
  const active = [];
  for (const account of candidates) {
    if (await client.readContract({ address, abi, functionName: 'hasRole', args: [role, account] }))
      active.push(account);
  }
  roles[name] = active;
}

const currentDelay = await client.readContract({ address, abi, functionName: 'getMinDelay' });
const roleAccounts = [...new Set(Object.values(roles).flat())];
const roleAccountTypes = Object.fromEntries(
  await Promise.all(
    roleAccounts.map(async (account) => {
      if (account === zeroAddress) return [account, 'open-role'];
      const code = await withRpcRetry(() => client.getCode({ address: account }));
      return [account, code && code !== '0x' ? 'contract' : 'externally-owned-account'];
    }),
  ),
);
const updateDelayCalldata = encodeFunctionData({
  abi,
  functionName: 'updateDelay',
  args: [REQUIRED_DELAY_SECONDS],
});
const remediationSalt = keccak256(toBytes('VORTEXA_TIMELOCK_DELAY_172800_V1'));
const operationId = await client.readContract({
  address,
  abi,
  functionName: 'hashOperation',
  args: [address, 0n, updateDelayCalldata, zeroHash, remediationSalt],
});
const [operationExists, operationPending, operationReady, operationDone] = await Promise.all(
  ['isOperation', 'isOperationPending', 'isOperationReady', 'isOperationDone'].map((functionName) =>
    client.readContract({ address, abi, functionName, args: [operationId] }),
  ),
);
const operationState = operationDone
  ? 'Done'
  : operationReady
    ? 'Ready'
    : operationPending
      ? 'Waiting'
      : operationExists
        ? 'Unknown'
        : 'Unset';
const operationTimestamp = await client.readContract({
  address,
  abi,
  functionName: 'getTimestamp',
  args: [operationId],
});

const report = {
  readOnly: true,
  chainId,
  finalizedBlock: finalizedBlock.number.toString(),
  timelock: address,
  deploymentBlock: deploymentBlock.toString(),
  currentDelaySeconds: currentDelay.toString(),
  requiredDelaySeconds: REQUIRED_DELAY_SECONDS.toString(),
  compliant: currentDelay >= REQUIRED_DELAY_SECONDS,
  roles,
  roleAccountTypes,
  delayHistory,
  remediation: {
    target: address,
    valueWei: '0',
    updateDelayCalldata,
    predecessor: zeroHash,
    salt: remediationSalt,
    operationId,
    operationState,
    operationTimestamp: operationTimestamp.toString(),
    scheduleDelaySeconds: currentDelay.toString(),
    transactionExecuted: false,
  },
};
console.log(JSON.stringify(report, null, 2));
if (!report.compliant) process.exitCode = 2;

/** Finds the first block whose state contains the deployed timelock bytecode. */
async function findDeploymentBlock(highestBlock) {
  let low = 0n;
  let high = highestBlock;
  while (low < high) {
    const middle = (low + high) / 2n;
    const code = await withRpcRetry(() => client.getCode({ address, blockNumber: middle }));
    if (code && code !== '0x') high = middle;
    else low = middle + 1n;
  }
  const code = await withRpcRetry(() => client.getCode({ address, blockNumber: low }));
  if (!code || code === '0x') throw new Error('Timelock deployment block not found');
  return low;
}

/** Reads raw logs in paced ten-block windows accepted by restricted RPC plans. */
async function contractLogs(fromBlock, toBlock) {
  const logs = [];
  const range = 10n;
  for (let start = fromBlock; start <= toBlock; start += range) {
    const end = start + range - 1n < toBlock ? start + range - 1n : toBlock;
    logs.push(...(await withRpcRetry(() => client.getLogs({ address, fromBlock: start, toBlock: end }))));
    await delay(250);
  }
  return logs;
}

/** Retries transient provider failures without ever logging the provider response. */
async function withRpcRetry(operation) {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    try {
      return await operation();
    } catch {
      if (attempt === 4) throw new Error('RPC_READ_FAILED');
      await delay(500 * 2 ** attempt);
    }
  }
  throw new Error('RPC_READ_FAILED');
}

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function validatedBlock(value, maximum) {
  if (!/^[0-9]+$/.test(value)) throw new Error('Invalid timelock deployment block');
  const block = BigInt(value);
  if (block > maximum) throw new Error('Timelock deployment block exceeds finalized head');
  return block;
}

/** Prevents RPC URLs, credentials, and raw provider messages from reaching logs. */
function reportSanitizedFailure(error) {
  console.error(
    JSON.stringify({
      event: 'timelock_inspection_failed',
      errorType: error instanceof Error ? error.name : 'unknown',
    }),
  );
  process.exitCode = 1;
}
