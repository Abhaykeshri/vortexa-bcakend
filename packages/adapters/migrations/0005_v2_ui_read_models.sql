ALTER TABLE vaults
  ADD COLUMN name text,
  ADD COLUMN symbol text,
  ADD COLUMN manager text CHECK(manager IS NULL OR manager ~ '^0x[0-9a-f]{40}$'),
  ADD COLUMN paused boolean,
  ADD COLUMN in_range boolean,
  ADD COLUMN pool_tick integer CHECK(pool_tick IS NULL OR pool_tick BETWEEN -887272 AND 887272);

CREATE TABLE v2_pools (
  chain_id bigint NOT NULL,
  pool_id text NOT NULL CHECK(pool_id ~ '^0x[0-9a-f]{64}$'),
  pool_key jsonb NOT NULL,
  allowed boolean NOT NULL,
  base_is_currency0 boolean NOT NULL,
  max_deposit_cap numeric(78,0) NOT NULL,
  oracle_config jsonb,
  indexed_through_block numeric(78,0) NOT NULL CHECK(indexed_through_block >= 0),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(chain_id,pool_id)
);
CREATE TABLE v2_tokens (
  chain_id bigint NOT NULL,
  address text NOT NULL CHECK(address ~ '^0x[0-9a-f]{40}$'),
  symbol text NOT NULL,
  decimals integer NOT NULL CHECK(decimals BETWEEN 0 AND 255),
  indexed_through_block numeric(78,0) NOT NULL CHECK(indexed_through_block >= 0),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(chain_id,address)
);
CREATE TABLE v2_vault_bands (
  chain_id bigint NOT NULL,
  vault_address text NOT NULL CHECK(vault_address ~ '^0x[0-9a-f]{40}$'),
  band_index integer NOT NULL CHECK(band_index >= 0),
  tick_lower integer NOT NULL,
  tick_upper integer NOT NULL,
  token_id numeric(78,0) NOT NULL CHECK(token_id >= 0),
  liquidity numeric(78,0) NOT NULL CHECK(liquidity >= 0),
  role text NOT NULL CHECK(role IN ('LADDER','LIMIT','CARPET')),
  indexed_through_block numeric(78,0) NOT NULL CHECK(indexed_through_block >= 0),
  CHECK(tick_lower < tick_upper),
  PRIMARY KEY(chain_id,vault_address,band_index)
);
CREATE TABLE v2_activities (
  chain_id bigint NOT NULL,
  transaction_hash text NOT NULL CHECK(transaction_hash ~ '^0x[0-9a-f]{64}$'),
  log_index integer NOT NULL CHECK(log_index >= 0),
  block_hash text NOT NULL CHECK(block_hash ~ '^0x[0-9a-f]{64}$'),
  block_number numeric(78,0) NOT NULL CHECK(block_number >= 0),
  vault_address text NOT NULL CHECK(vault_address ~ '^0x[0-9a-f]{40}$'),
  kind text NOT NULL,
  actor text,
  receiver text,
  amounts jsonb NOT NULL DEFAULT '{}'::jsonb,
  finality text NOT NULL CHECK(finality IN ('OBSERVED','CONFIRMED','FINALIZED')),
  canonical boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(chain_id,transaction_hash,log_index,block_hash)
);
CREATE INDEX v2_activities_vault_block_idx ON v2_activities(chain_id,vault_address,canonical,block_number DESC,log_index DESC);
CREATE TABLE v2_rebalances (
  chain_id bigint NOT NULL,
  transaction_hash text NOT NULL CHECK(transaction_hash ~ '^0x[0-9a-f]{64}$'),
  log_index integer NOT NULL CHECK(log_index >= 0),
  block_hash text NOT NULL CHECK(block_hash ~ '^0x[0-9a-f]{64}$'),
  vault_address text NOT NULL CHECK(vault_address ~ '^0x[0-9a-f]{40}$'),
  block_number numeric(78,0) NOT NULL CHECK(block_number >= 0),
  detail jsonb NOT NULL,
  finality text NOT NULL CHECK(finality IN ('OBSERVED','CONFIRMED','FINALIZED')),
  canonical boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(chain_id,transaction_hash,log_index,block_hash)
);
CREATE INDEX v2_rebalances_vault_block_idx ON v2_rebalances(chain_id,vault_address,canonical,block_number DESC,log_index DESC);
CREATE TABLE v2_fee_collections (
  chain_id bigint NOT NULL,
  transaction_hash text NOT NULL CHECK(transaction_hash ~ '^0x[0-9a-f]{64}$'),
  log_index integer NOT NULL CHECK(log_index >= 0),
  block_hash text NOT NULL CHECK(block_hash ~ '^0x[0-9a-f]{64}$'),
  vault_address text NOT NULL CHECK(vault_address ~ '^0x[0-9a-f]{40}$'),
  amount0 numeric(78,0) NOT NULL CHECK(amount0 >= 0),
  amount1 numeric(78,0) NOT NULL CHECK(amount1 >= 0),
  protocol_fee0 numeric(78,0) NOT NULL CHECK(protocol_fee0 >= 0),
  protocol_fee1 numeric(78,0) NOT NULL CHECK(protocol_fee1 >= 0),
  block_number numeric(78,0) NOT NULL CHECK(block_number >= 0),
  finality text NOT NULL CHECK(finality IN ('OBSERVED','CONFIRMED','FINALIZED')),
  canonical boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(chain_id,transaction_hash,log_index,block_hash)
);
CREATE INDEX v2_fee_collections_vault_block_idx ON v2_fee_collections(chain_id,vault_address,canonical,block_number DESC,log_index DESC);
CREATE TABLE v2_vault_snapshots (
  chain_id bigint NOT NULL,
  vault_address text NOT NULL,
  bucket timestamptz NOT NULL,
  block_number numeric(78,0) NOT NULL CHECK(block_number >= 0),
  total_shares numeric(78,0) NOT NULL CHECK(total_shares >= 0),
  total_assets numeric(78,0) NOT NULL CHECK(total_assets >= 0),
  total_assets0 numeric(78,0),
  total_assets1 numeric(78,0),
  sqrt_price_x96 numeric(78,0),
  pool_tick integer,
  in_range boolean,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(chain_id,vault_address,bucket)
);
CREATE TABLE v2_prices (
  chain_id bigint NOT NULL,
  token_address text NOT NULL CHECK(token_address ~ '^0x[0-9a-f]{40}$'),
  source text NOT NULL,
  observed_at timestamptz NOT NULL,
  usd_x18 numeric(78,0) NOT NULL CHECK(usd_x18 > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(chain_id,token_address,source,observed_at)
);
