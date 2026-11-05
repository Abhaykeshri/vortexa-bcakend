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
    shapeId: integer('shape_id'),
    name: text('name'),
    symbol: text('symbol'),
    manager: text('manager'),
    paused: boolean('paused'),
    inRange: boolean('in_range'),
    poolTick: integer('pool_tick'),
    ownerRole: text('owner_role').notNull(),
    asOfBlock: numeric('as_of_block', { precision: 78, scale: 0 }).notNull(),
    config: jsonb('config').notNull().default({}),
    factoryAddress: text('factory_address'),
    creator: text('creator'),
    creationTransactionHash: text('creation_transaction_hash'),
    creationBlock: numeric('creation_block', { precision: 78, scale: 0 }),
    poolId: text('pool_id'),
    strategyContract: text('strategy_contract'),
    totalShares: numeric('total_shares', { precision: 78, scale: 0 }).notNull().default('0'),
    totalAssets: numeric('total_assets', { precision: 78, scale: 0 }),
    totalAssets0: numeric('total_assets0', { precision: 78, scale: 0 }),
    totalAssets1: numeric('total_assets1', { precision: 78, scale: 0 }),
    accountingAvailable: boolean('accounting_available').notNull().default(false),
    finality: text('finality').notNull().default('OBSERVED'),
    indexedThroughBlock: numeric('indexed_through_block', { precision: 78, scale: 0 }),
    indexedBlockHash: text('indexed_block_hash'),
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
    blockTimestamp: timestamp('block_timestamp', { withTimezone: true }),
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
    transactionIndex: integer('transaction_index').notNull().default(0),
    logIndex: integer('log_index').notNull(),
    blockHash: text('block_hash').notNull(),
    blockNumber: numeric('block_number', { precision: 78, scale: 0 }).notNull(),
    address: text('address').notNull(),
    topics: jsonb('topics').notNull(),
    data: text('data').notNull(),
    eventName: text('event_name'),
    eventArgs: jsonb('event_args'),
    finality: text('finality').notNull().default('OBSERVED'),
    canonical: boolean('canonical').notNull().default(true),
    createdAt,
  },
  (t) => [
    primaryKey({ columns: [t.chainId, t.transactionHash, t.logIndex, t.blockHash] }),
    index('raw_logs_chain_block_idx').on(t.chainId, t.blockNumber),
  ],
);
export const reorgJournal = pgTable(
  'reorg_journal',
  {
    id: bigserial('id', { mode: 'bigint' }).primaryKey(),
    chainId: bigint('chain_id', { mode: 'number' }).notNull(),
    consumer: text('consumer').notNull(),
    ancestorBlock: numeric('ancestor_block', { precision: 78, scale: 0 }).notNull(),
    ancestorHash: text('ancestor_hash').notNull(),
    depth: integer('depth').notNull(),
    orphanedHashes: jsonb('orphaned_hashes').notNull(),
    status: text('status').notNull(),
    createdAt,
  },
  (t) => [index('reorg_journal_chain_created_idx').on(t.chainId, t.createdAt)],
);
export const reconciliationResults = pgTable('reconciliation_results', {
  id: bigserial('id', { mode: 'bigint' }).primaryKey(),
  chainId: bigint('chain_id', { mode: 'number' }).notNull(),
  consumer: text('consumer').notNull(),
  fromBlock: numeric('from_block', { precision: 78, scale: 0 }).notNull(),
  toBlock: numeric('to_block', { precision: 78, scale: 0 }).notNull(),
  manifestVersion: text('manifest_version').notNull(),
  passed: boolean('passed').notNull(),
  detail: jsonb('detail').notNull(),
  createdAt,
});
export const indexerWorkerState = pgTable(
  'indexer_worker_state',
  {
    chainId: bigint('chain_id', { mode: 'number' }).notNull(),
    consumer: text('consumer').notNull(),
    status: text('status').notNull(),
    fenceToken: bigint('fence_token', { mode: 'bigint' }).notNull().default(0n),
    lastSuccessAt: timestamp('last_success_at', { withTimezone: true }),
    lastError: text('last_error'),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.chainId, t.consumer] })],
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
    amount0: numeric('amount0', { precision: 78, scale: 0 }),
    amount1: numeric('amount1', { precision: 78, scale: 0 }),
    accountingAvailable: boolean('accounting_available').notNull().default(false),
    finality: text('finality').notNull().default('OBSERVED'),
    indexedBlockHash: text('indexed_block_hash'),
    asOfBlock: numeric('as_of_block', { precision: 78, scale: 0 }).notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.chainId, t.vaultAddress, t.walletAddress] })],
);
export const projectionState = pgTable('m7_projection_state', {
  chainId: bigint('chain_id', { mode: 'number' }).primaryKey(),
  generation: bigint('generation', { mode: 'bigint' }).notNull().default(0n),
  indexedThroughBlock: numeric('indexed_through_block', { precision: 78, scale: 0 }).notNull(),
  indexedBlockHash: text('indexed_block_hash').notNull(),
  finality: text('finality').notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});
export const projectionEvents = pgTable(
  'm7_projection_events',
  {
    chainId: bigint('chain_id', { mode: 'number' }).notNull(),
    transactionHash: text('transaction_hash').notNull(),
    logIndex: integer('log_index').notNull(),
    blockHash: text('block_hash').notNull(),
    eventName: text('event_name').notNull(),
    canonical: boolean('canonical').notNull().default(true),
    appliedAt: timestamp('applied_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.chainId, t.transactionHash, t.logIndex, t.blockHash] })],
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
    claimOwner: text('claim_owner'),
    claimUntil: timestamp('claim_until', { withTimezone: true }),
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

export const pools = pgTable(
  'v2_pools',
  {
    chainId: bigint('chain_id', { mode: 'number' }).notNull(),
    poolId: text('pool_id').notNull(),
    poolKey: jsonb('pool_key').notNull(),
    allowed: boolean('allowed').notNull(),
    baseIsCurrency0: boolean('base_is_currency0').notNull(),
    maxDepositCap: numeric('max_deposit_cap', { precision: 78, scale: 0 }).notNull(),
    oracleConfig: jsonb('oracle_config'),
    indexedThroughBlock: numeric('indexed_through_block', { precision: 78, scale: 0 }).notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.chainId, t.poolId] })],
);

export const tokens = pgTable(
  'v2_tokens',
  {
    chainId: bigint('chain_id', { mode: 'number' }).notNull(),
    address: text('address').notNull(),
    symbol: text('symbol').notNull(),
    decimals: integer('decimals').notNull(),
    indexedThroughBlock: numeric('indexed_through_block', { precision: 78, scale: 0 }).notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.chainId, t.address] })],
);

export const vaultBands = pgTable(
  'v2_vault_bands',
  {
    chainId: bigint('chain_id', { mode: 'number' }).notNull(),
    vaultAddress: text('vault_address').notNull(),
    bandIndex: integer('band_index').notNull(),
    tickLower: integer('tick_lower').notNull(),
    tickUpper: integer('tick_upper').notNull(),
    tokenId: numeric('token_id', { precision: 78, scale: 0 }).notNull(),
    liquidity: numeric('liquidity', { precision: 78, scale: 0 }).notNull(),
    role: text('role').notNull(),
    indexedThroughBlock: numeric('indexed_through_block', { precision: 78, scale: 0 }).notNull(),
  },
  (t) => [primaryKey({ columns: [t.chainId, t.vaultAddress, t.bandIndex] })],
);

export const activities = pgTable(
  'v2_activities',
  {
    chainId: bigint('chain_id', { mode: 'number' }).notNull(),
    transactionHash: text('transaction_hash').notNull(),
    logIndex: integer('log_index').notNull(),
    blockHash: text('block_hash').notNull(),
    blockNumber: numeric('block_number', { precision: 78, scale: 0 }).notNull(),
    vaultAddress: text('vault_address').notNull(),
    kind: text('kind').notNull(),
    actor: text('actor'),
    receiver: text('receiver'),
    amounts: jsonb('amounts').notNull().default({}),
    finality: text('finality').notNull(),
    canonical: boolean('canonical').notNull().default(true),
    createdAt,
  },
  (t) => [
    primaryKey({ columns: [t.chainId, t.transactionHash, t.logIndex, t.blockHash] }),
    index('v2_activities_vault_block_idx').on(
      t.chainId,
      t.vaultAddress,
      t.canonical,
      t.blockNumber,
      t.logIndex,
    ),
  ],
);

export const rebalances = pgTable(
  'v2_rebalances',
  {
    chainId: bigint('chain_id', { mode: 'number' }).notNull(),
    transactionHash: text('transaction_hash').notNull(),
    logIndex: integer('log_index').notNull(),
    blockHash: text('block_hash').notNull(),
    vaultAddress: text('vault_address').notNull(),
    blockNumber: numeric('block_number', { precision: 78, scale: 0 }).notNull(),
    detail: jsonb('detail').notNull(),
    finality: text('finality').notNull(),
    canonical: boolean('canonical').notNull().default(true),
    createdAt,
  },
  (t) => [
    primaryKey({ columns: [t.chainId, t.transactionHash, t.logIndex, t.blockHash] }),
    index('v2_rebalances_vault_block_idx').on(t.chainId, t.vaultAddress, t.canonical, t.blockNumber, t.logIndex),
  ],
);

export const feeCollections = pgTable(
  'v2_fee_collections',
  {
    chainId: bigint('chain_id', { mode: 'number' }).notNull(),
    transactionHash: text('transaction_hash').notNull(),
    logIndex: integer('log_index').notNull(),
    blockHash: text('block_hash').notNull(),
    vaultAddress: text('vault_address').notNull(),
    amount0: numeric('amount0', { precision: 78, scale: 0 }).notNull(),
    amount1: numeric('amount1', { precision: 78, scale: 0 }).notNull(),
    protocolFee0: numeric('protocol_fee0', { precision: 78, scale: 0 }).notNull(),
    protocolFee1: numeric('protocol_fee1', { precision: 78, scale: 0 }).notNull(),
    blockNumber: numeric('block_number', { precision: 78, scale: 0 }).notNull(),
    finality: text('finality').notNull(),
    canonical: boolean('canonical').notNull().default(true),
    createdAt,
  },
  (t) => [
    primaryKey({ columns: [t.chainId, t.transactionHash, t.logIndex, t.blockHash] }),
    index('v2_fee_collections_vault_block_idx').on(
      t.chainId,
      t.vaultAddress,
      t.canonical,
      t.blockNumber,
      t.logIndex,
    ),
  ],
);

export const vaultSnapshots = pgTable(
  'v2_vault_snapshots',
  {
    chainId: bigint('chain_id', { mode: 'number' }).notNull(),
    vaultAddress: text('vault_address').notNull(),
    bucket: timestamp('bucket', { withTimezone: true }).notNull(),
    blockNumber: numeric('block_number', { precision: 78, scale: 0 }).notNull(),
    totalShares: numeric('total_shares', { precision: 78, scale: 0 }).notNull(),
    totalAssets: numeric('total_assets', { precision: 78, scale: 0 }).notNull(),
    totalAssets0: numeric('total_assets0', { precision: 78, scale: 0 }),
    totalAssets1: numeric('total_assets1', { precision: 78, scale: 0 }),
    sqrtPriceX96: numeric('sqrt_price_x96', { precision: 78, scale: 0 }),
    poolTick: integer('pool_tick'),
    inRange: boolean('in_range'),
    createdAt,
  },
  (t) => [primaryKey({ columns: [t.chainId, t.vaultAddress, t.bucket] })],
);

export const prices = pgTable(
  'v2_prices',
  {
    chainId: bigint('chain_id', { mode: 'number' }).notNull(),
    tokenAddress: text('token_address').notNull(),
    source: text('source').notNull(),
    observedAt: timestamp('observed_at', { withTimezone: true }).notNull(),
    usdX18: numeric('usd_x18', { precision: 78, scale: 0 }).notNull(),
    createdAt,
  },
  (t) => [primaryKey({ columns: [t.chainId, t.tokenAddress, t.source, t.observedAt] })],
);
