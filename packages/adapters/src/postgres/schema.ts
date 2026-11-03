import {
  bigint,
  bigserial,
  boolean,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

const createdAt = timestamp('created_at', { withTimezone: true }).notNull().defaultNow();
export const deployments = pgTable(
  'deployments',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    chainId: bigint('chain_id', { mode: 'number' }).notNull(),
    manifestVersion: text('manifest_version').notNull(),
    contractName: text('contract_name').notNull(),
    address: text('address').notNull(),
    codeHash: text('code_hash').notNull(),
    active: boolean('active').notNull().default(true),
    createdAt,
  },
  (t) => [
    uniqueIndex('deployments_chain_manifest_contract_uq').on(t.chainId, t.manifestVersion, t.contractName),
    uniqueIndex('deployments_chain_address_uq').on(t.chainId, t.address),
  ],
);
export const capabilities = pgTable(
  'capabilities',
  {
    chainId: bigint('chain_id', { mode: 'number' }).notNull(),
    manifestVersion: text('manifest_version').notNull(),
    feature: text('feature').notNull(),
    status: text('status').notNull(),
    reason: text('reason').notNull(),
    createdAt,
  },
  (t) => [primaryKey({ columns: [t.chainId, t.manifestVersion, t.feature] })],
);
export const vaults = pgTable(
  'vaults',
  {
    chainId: bigint('chain_id', { mode: 'number' }).notNull(),
    address: text('address').notNull(),
    strategy: text('strategy').notNull(),
    shapeId: integer('shape_id').notNull(),
    ownerRole: text('owner_role').notNull(),
    asOfBlock: numeric('as_of_block', { precision: 78, scale: 0 }).notNull(),
    config: jsonb('config').notNull().default({}),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    createdAt,
  },
  (t) => [primaryKey({ columns: [t.chainId, t.address] })],
);
export const configVersions = pgTable(
  'config_versions',
  {
    id: bigserial('id', { mode: 'bigint' }).primaryKey(),
    scope: text('scope').notNull(),
    version: text('version').notNull(),
    value: jsonb('value').notNull(),
    createdAt,
  },
  (t) => [uniqueIndex('config_versions_scope_version_uq').on(t.scope, t.version)],
);
export const headers = pgTable(
  'headers',
  {
    chainId: bigint('chain_id', { mode: 'number' }).notNull(),
    blockNumber: numeric('block_number', { precision: 78, scale: 0 }).notNull(),
    blockHash: text('block_hash').notNull(),
    parentHash: text('parent_hash').notNull(),
    canonical: boolean('canonical').notNull().default(true),
    finality: text('finality').notNull(),
    createdAt,
  },
  (t) => [
    primaryKey({ columns: [t.chainId, t.blockHash] }),
    index('headers_chain_number_idx').on(t.chainId, t.blockNumber),
  ],
);
export const rawLogs = pgTable(
  'raw_logs',
  {
    chainId: bigint('chain_id', { mode: 'number' }).notNull(),
    transactionHash: text('transaction_hash').notNull(),
    logIndex: integer('log_index').notNull(),
    blockHash: text('block_hash').notNull(),
    blockNumber: numeric('block_number', { precision: 78, scale: 0 }).notNull(),
    address: text('address').notNull(),
    topics: jsonb('topics').notNull(),
    data: text('data').notNull(),
    canonical: boolean('canonical').notNull().default(true),
    createdAt,
  },
  (t) => [
    primaryKey({ columns: [t.chainId, t.transactionHash, t.logIndex, t.blockHash] }),
    index('raw_logs_chain_block_idx').on(t.chainId, t.blockNumber),
  ],
);
export const cursors = pgTable(
  'cursors',
  {
    chainId: bigint('chain_id', { mode: 'number' }).notNull(),
    consumer: text('consumer').notNull(),
    blockNumber: numeric('block_number', { precision: 78, scale: 0 }).notNull(),
    blockHash: text('block_hash').notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.chainId, t.consumer] })],
);
export const balances = pgTable(
  'balances',
  {
    chainId: bigint('chain_id', { mode: 'number' }).notNull(),
    vaultAddress: text('vault_address').notNull(),
    walletAddress: text('wallet_address').notNull(),
    shares: numeric('shares', { precision: 78, scale: 0 }).notNull(),
    asOfBlock: numeric('as_of_block', { precision: 78, scale: 0 }).notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.chainId, t.vaultAddress, t.walletAddress] })],
);
export const transactions = pgTable(
  'transactions',
  {
    chainId: bigint('chain_id', { mode: 'number' }).notNull(),
    transactionHash: text('transaction_hash').notNull(),
    walletAddress: text('wallet_address'),
    status: text('status').notNull(),
    blockNumber: numeric('block_number', { precision: 78, scale: 0 }),
    metadata: jsonb('metadata').notNull().default({}),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    createdAt,
  },
  (t) => [primaryKey({ columns: [t.chainId, t.transactionHash] })],
);
export const sessions = pgTable('sessions', {
  id: uuid('id').primaryKey().defaultRandom(),
  walletAddress: text('wallet_address').notNull(),
  tokenHash: text('token_hash').notNull().unique(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  revokedAt: timestamp('revoked_at', { withTimezone: true }),
  createdAt,
});
export const auditEvents = pgTable(
  'audit_events',
  {
    id: bigserial('id', { mode: 'bigint' }).primaryKey(),
    action: text('action').notNull(),
    actor: text('actor'),
    target: text('target'),
    outcome: text('outcome').notNull(),
    detail: jsonb('detail').notNull().default({}),
    createdAt,
  },
  (t) => [index('audit_events_created_idx').on(t.createdAt)],
);
export const outbox = pgTable(
  'outbox',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    topic: text('topic').notNull(),
    idempotencyKey: text('idempotency_key').notNull().unique(),
    payload: jsonb('payload').notNull(),
    attempts: integer('attempts').notNull().default(0),
    availableAt: timestamp('available_at', { withTimezone: true }).notNull().defaultNow(),
    processedAt: timestamp('processed_at', { withTimezone: true }),
    deadLetteredAt: timestamp('dead_lettered_at', { withTimezone: true }),
    lastError: text('last_error'),
    createdAt,
  },
  (t) => [index('outbox_pending_idx').on(t.processedAt, t.availableAt)],
);
export const keeperJobs = pgTable(
  'keeper_jobs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    chainId: bigint('chain_id', { mode: 'number' }).notNull(),
    vaultAddress: text('vault_address').notNull(),
    jobType: text('job_type').notNull(),
    idempotencyKey: text('idempotency_key').notNull().unique(),
    status: text('status').notNull(),
    attempts: integer('attempts').notNull().default(0),
    availableAt: timestamp('available_at', { withTimezone: true }).notNull().defaultNow(),
    leaseOwner: text('lease_owner'),
    leaseUntil: timestamp('lease_until', { withTimezone: true }),
    payload: jsonb('payload').notNull().default({}),
    lastError: text('last_error'),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    createdAt,
  },
  (t) => [index('keeper_jobs_ready_idx').on(t.status, t.availableAt)],
);
