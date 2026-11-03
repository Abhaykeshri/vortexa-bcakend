import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { Address } from '../../../../packages/domain/src/types.js';
import { loadManifest, type DeploymentManifest } from '../../../../packages/contracts/src/manifest.js';

// Single configuration entrypoint. Reads .env without external dependencies.
// No other application module should read process.env directly.
export function parseDotEnv(source: string): Record<string, string> {
  const values: Record<string, string> = {};
  for (const line of source.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq <= 0) throw new Error('Invalid .env line (expected KEY=VALUE)');
    const key = trimmed.slice(0, eq).trim();
    if (!/^[A-Z][A-Z0-9_]*$/.test(key)) throw new Error('Invalid environment key');
    let value = trimmed.slice(eq + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'")))
      value = value.slice(1, -1);
    values[key] = value;
  }
  return values;
}
export function readEnvironment(
  projectDirectory = '.',
  processValues: Record<string, string | undefined> = process.env,
): Record<string, string> {
  const nodeEnv = processValues.NODE_ENV ?? 'development';
  const fromFiles: Record<string, string> = {};
  // Local files are a development/test convenience. Deployment variables are the only production source.
  if (nodeEnv !== 'production') {
    for (const name of ['.env', `.env.${nodeEnv}`, '.env.local', `.env.${nodeEnv}.local`]) {
      const path = resolve(projectDirectory, name);
      if (existsSync(path)) Object.assign(fromFiles, parseDotEnv(readFileSync(path, 'utf8')));
    }
  }
  const supplied = Object.fromEntries(
    Object.entries(processValues).filter((entry): entry is [string, string] => entry[1] !== undefined),
  );
  return { ...fromFiles, ...supplied };
}
export const CONTRACT_KEYS = [
  'PRICE_GUARD',
  'SHAPE_LIBRARY',
  'TIMELOCK_CONTROLLER',
  'VAULT',
  'VAULT_FACTORY',
  'VAULT_LENS',
  'FEE_COLLECTOR',
  'NORMAL_LP_STRATEGY',
  'BUY_THE_DIP_STRATEGY',
  'SELL_THE_PUMP_STRATEGY',
  'SWAP_EXECUTOR',
  'ZAP',
] as const;
export type ContractKey = (typeof CONTRACT_KEYS)[number];
export interface Config {
  nodeEnv: 'development' | 'test' | 'production';
  host: string;
  port: number;
  chainId: 11155111;
  blockchainMode: 'single-chain';
  activeChainIds: readonly [11155111];
  defaultChainId: 11155111;
  rpcUrl: string;
  rpcUrls: readonly string[];
  rpcTimeoutMs: number;
  rpcMaxRetries: number;
  confirmations: number;
  databaseUrl?: string;
  redisUrl?: string;
  corsAllowedOrigins: string[];
  internalApiKey?: string;
  trustProxy: boolean;
  rateLimitWindowSeconds: number;
  networkRateLimit: number;
  chainRateLimit: number;
  contractStatusRateLimit: number;
  manifestVersion: string;
  contracts: Record<ContractKey, Address>;
  contractCodeHashes: Partial<Record<ContractKey, `0x${string}`>>;
  manifest: DeploymentManifest;
  logLevel: 'debug' | 'info' | 'warn' | 'error';
  workerEnabled: boolean;
  workerPollIntervalMs: number;
}
function required(env: Record<string, string>, key: string): string {
  const value = env[key];
  if (!value || value.startsWith('REPLACE_') || value.includes('YOUR_'))
    throw new Error(`Missing or placeholder configuration: ${key}`);
  return value;
}
function int(env: Record<string, string>, key: string, fallback: number, min: number, max: number): number {
  const raw = env[key];
  const n = raw === undefined ? fallback : Number(raw);
  if (!Number.isSafeInteger(n) || n < min || n > max) throw new Error(`Invalid numeric config: ${key}`);
  return n;
}
function boolean(env: Record<string, string>, key: string, fallback = false): boolean {
  const value = env[key];
  if (value === undefined) return fallback;
  if (value === 'true') return true;
  if (value === 'false') return false;
  throw new Error(`Invalid boolean config: ${key}`);
}
function exactOrigins(source: string, production: boolean): string[] {
  const origins = source
    .split(',')
    .map((x) => x.trim())
    .filter(Boolean);
  if (new Set(origins).size !== origins.length) throw new Error('Duplicate CORS origin');
  for (const origin of origins) {
    if (origin === '*' || origin === 'null') throw new Error('Unsafe CORS origin');
    const url = new URL(origin);
    if (url.origin !== origin || url.pathname !== '/' || url.search || url.hash)
      throw new Error('CORS origins must be exact scheme/host/port origins');
    if (production && url.protocol !== 'https:') throw new Error('Production CORS origins must use HTTPS');
    if (!['https:', 'http:'].includes(url.protocol)) throw new Error('Invalid CORS origin protocol');
  }
  return origins;
}
export function loadConfig(
  env: Record<string, string> = readEnvironment(),
  suppliedManifest?: DeploymentManifest,
): Config {
  const nodeEnv = env.NODE_ENV ?? 'development';
  if (!['development', 'test', 'production'].includes(nodeEnv)) throw new Error('Invalid NODE_ENV');
  const blockchainMode = env.BLOCKCHAIN_MODE ?? 'single-chain';
  if (blockchainMode !== 'single-chain') throw new Error('Only single-chain mode is currently supported');
  const activeChainIds = (env.ACTIVE_CHAIN_IDS ?? '11155111').split(',').map((value) => Number(value.trim()));
  if (activeChainIds.length !== 1 || activeChainIds[0] !== 11155111)
    throw new Error('Only Ethereum Sepolia (11155111) may be active');
  const defaultChainId = int(env, 'DEFAULT_CHAIN_ID', 11155111, 11155111, 11155111) as 11155111;
  const chainId = int(env, 'CHAIN_ID', defaultChainId, 11155111, 11155111) as 11155111;
  if (chainId !== defaultChainId) throw new Error('CHAIN_ID must match DEFAULT_CHAIN_ID');
  const rpcUrls = (env.SEPOLIA_RPC_URLS ?? required(env, 'SEPOLIA_RPC_URL'))
    .split(',')
    .map((x) => x.trim())
    .filter(Boolean);
  if (rpcUrls.length < 1 || rpcUrls.length > 3) throw new Error('Invalid RPC provider count');
  for (const value of rpcUrls) {
    const rpc = new URL(value);
    if (
      !['https:', 'http:'].includes(rpc.protocol) ||
      (nodeEnv === 'production' && rpc.protocol !== 'https:')
    )
      throw new Error('Invalid SEPOLIA_RPC_URL');
  }
  const rpcUrl = rpcUrls[0]!;
  const manifest = suppliedManifest ?? loadManifest(env.CONTRACT_MANIFEST_PATH);
  if (manifest.chainId !== chainId) throw new Error('Manifest chain mismatch');
  const contracts = {} as Record<ContractKey, Address>;
  const contractCodeHashes: Partial<Record<ContractKey, `0x${string}`>> = {};
  for (const key of CONTRACT_KEYS) {
    const address = required(env, `CONTRACT_${key}`);
    if (!/^0x[a-fA-F0-9]{40}$/.test(address)) throw new Error(`Invalid contract address: CONTRACT_${key}`);
    contracts[key] = address as Address;
    if (manifest.contracts[key]?.runtimeCodeHash)
      contractCodeHashes[key] = manifest.contracts[key].runtimeCodeHash;
  }
  for (const key of ['DATABASE_URL', 'REDIS_URL'] as const) {
    const value = env[key];
    if (value && !value.includes('YOUR_') && !value.includes('REPLACE_')) {
      const u = new URL(value);
      if (key === 'DATABASE_URL' && !['postgres:', 'postgresql:'].includes(u.protocol))
        throw new Error('Invalid DATABASE_URL');
      if (key === 'REDIS_URL' && !['redis:', 'rediss:'].includes(u.protocol))
        throw new Error('Invalid REDIS_URL');
    }
  }
  const originVariable =
    nodeEnv === 'production' ? 'CORS_ALLOWED_ORIGINS_PRODUCTION' : 'CORS_ALLOWED_ORIGINS_DEVELOPMENT';
  const originSource =
    env[originVariable] ??
    (nodeEnv === 'production' ? '' : (env.CORS_ALLOWED_ORIGINS ?? 'http://localhost:5173'));
  const corsAllowedOrigins = exactOrigins(originSource, nodeEnv === 'production');
  const internalApiKey = env.INTERNAL_API_KEY;
  const logLevel = env.LOG_LEVEL ?? 'info';
  if (!['debug', 'info', 'warn', 'error'].includes(logLevel)) throw new Error('Invalid LOG_LEVEL');
  if (nodeEnv === 'production') {
    if (!env.DATABASE_URL || env.DATABASE_URL.includes('REPLACE_') || env.DATABASE_URL.includes('YOUR_'))
      throw new Error('Missing production dependency configuration: DATABASE_URL');
    if (!env.REDIS_URL || env.REDIS_URL.includes('REPLACE_') || env.REDIS_URL.includes('YOUR_'))
      throw new Error('Missing production security configuration: REDIS_URL');
    if (corsAllowedOrigins.length === 0)
      throw new Error('Missing production security configuration: CORS_ALLOWED_ORIGINS_PRODUCTION');
    if (!internalApiKey || internalApiKey.startsWith('REPLACE_') || internalApiKey.length < 32)
      throw new Error('Missing or weak production security configuration: INTERNAL_API_KEY');
  }
  return {
    nodeEnv: nodeEnv as Config['nodeEnv'],
    host: env.HOST ?? '127.0.0.1',
    port: int(env, 'PORT', 3000, 1, 65535),
    chainId,
    blockchainMode,
    activeChainIds: [11155111],
    defaultChainId,
    rpcUrl,
    rpcUrls,
    rpcTimeoutMs: int(env, 'RPC_TIMEOUT_MS', 10000, 1000, 60000),
    rpcMaxRetries: int(env, 'RPC_MAX_RETRIES', 1, 0, 3),
    confirmations: int(env, 'RPC_CONFIRMATIONS', 12, 1, 100),
    ...(env.DATABASE_URL && !env.DATABASE_URL.includes('YOUR_') && !env.DATABASE_URL.includes('REPLACE_')
      ? { databaseUrl: env.DATABASE_URL }
      : {}),
    ...(env.REDIS_URL && !env.REDIS_URL.includes('YOUR_') && !env.REDIS_URL.includes('REPLACE_')
      ? { redisUrl: env.REDIS_URL }
      : {}),
    corsAllowedOrigins,
    ...(internalApiKey && !internalApiKey.startsWith('REPLACE_') ? { internalApiKey } : {}),
    trustProxy: boolean(env, 'TRUST_PROXY'),
    rateLimitWindowSeconds: int(env, 'RATE_LIMIT_WINDOW_SECONDS', 60, 1, 3600),
    networkRateLimit: int(env, 'NETWORK_RATE_LIMIT', 60, 1, 10000),
    chainRateLimit: int(env, 'CHAIN_RATE_LIMIT', 30, 1, 10000),
    contractStatusRateLimit: int(env, 'CONTRACT_STATUS_RATE_LIMIT', 10, 1, 10000),
    manifestVersion: manifest.manifestVersion,
    contracts,
    contractCodeHashes,
    manifest,
    logLevel: logLevel as Config['logLevel'],
    workerEnabled: boolean(env, 'WORKER_ENABLED'),
    workerPollIntervalMs: int(env, 'WORKER_POLL_INTERVAL_MS', 5000, 250, 300000),
  };
}
export function publicConfig(config: Config) {
  return {
    chainId: config.chainId,
    activeChainIds: config.activeChainIds,
    defaultChainId: config.defaultChainId,
    blockchainMode: config.blockchainMode,
    manifestVersion: config.manifestVersion,
    contracts: config.contracts,
    confirmations: config.confirmations,
  };
}
