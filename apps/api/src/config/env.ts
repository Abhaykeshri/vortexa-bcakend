import { existsSync, readFileSync } from 'node:fs';
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
export function readEnvironment(file = '.env'): Record<string, string> {
  const fromFile = existsSync(file) ? parseDotEnv(readFileSync(file, 'utf8')) : {};
  return { ...fromFile, ...process.env } as Record<string, string>;
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
  const chainId = int(env, 'CHAIN_ID', 11155111, 11155111, 11155111) as 11155111;
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
    const address = manifest.contracts[key]?.address;
    if (!address || !/^0x[a-fA-F0-9]{40}$/.test(address))
      throw new Error(`Missing manifest contract: ${key}`);
    const legacyOverride = env[`CONTRACT_${key}`];
    if (legacyOverride && legacyOverride.toLowerCase() !== address.toLowerCase())
      throw new Error(`Environment/manifest address mismatch: CONTRACT_${key}`);
    contracts[key] = address;
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
  if (nodeEnv === 'production') {
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
  };
}
export function publicConfig(config: Config) {
  return {
    chainId: config.chainId,
    manifestVersion: config.manifestVersion,
    contracts: config.contracts,
    confirmations: config.confirmations,
  };
}
