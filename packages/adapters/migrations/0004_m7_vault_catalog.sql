ALTER TABLE vaults ALTER COLUMN shape_id DROP NOT NULL;
ALTER TABLE vaults ADD COLUMN IF NOT EXISTS factory_address text CHECK(factory_address IS NULL OR factory_address ~ '^0x[0-9a-fA-F]{40}$');
ALTER TABLE vaults ADD COLUMN IF NOT EXISTS creator text CHECK(creator IS NULL OR creator ~ '^0x[0-9a-fA-F]{40}$');
ALTER TABLE vaults ADD COLUMN IF NOT EXISTS creation_transaction_hash text;
ALTER TABLE vaults ADD COLUMN IF NOT EXISTS creation_block numeric(78,0) CHECK(creation_block IS NULL OR creation_block >= 0);
ALTER TABLE vaults ADD COLUMN IF NOT EXISTS pool_id text;
ALTER TABLE vaults ADD COLUMN IF NOT EXISTS strategy_contract text CHECK(strategy_contract IS NULL OR strategy_contract ~ '^0x[0-9a-fA-F]{40}$');
ALTER TABLE vaults ADD COLUMN IF NOT EXISTS total_shares numeric(78,0) NOT NULL DEFAULT 0 CHECK(total_shares >= 0);
ALTER TABLE vaults ADD COLUMN IF NOT EXISTS total_assets numeric(78,0) CHECK(total_assets IS NULL OR total_assets >= 0);
ALTER TABLE vaults ADD COLUMN IF NOT EXISTS total_assets0 numeric(78,0) CHECK(total_assets0 IS NULL OR total_assets0 >= 0);
ALTER TABLE vaults ADD COLUMN IF NOT EXISTS total_assets1 numeric(78,0) CHECK(total_assets1 IS NULL OR total_assets1 >= 0);
ALTER TABLE vaults ADD COLUMN IF NOT EXISTS accounting_available boolean NOT NULL DEFAULT false;
ALTER TABLE vaults ADD COLUMN IF NOT EXISTS finality text NOT NULL DEFAULT 'OBSERVED' CHECK(finality IN ('OBSERVED','CONFIRMED','FINALIZED'));
ALTER TABLE vaults ADD COLUMN IF NOT EXISTS indexed_through_block numeric(78,0) CHECK(indexed_through_block IS NULL OR indexed_through_block >= 0);
ALTER TABLE vaults ADD COLUMN IF NOT EXISTS indexed_block_hash text;

CREATE UNIQUE INDEX IF NOT EXISTS vaults_chain_creation_tx_uq
  ON vaults(chain_id,creation_transaction_hash) WHERE creation_transaction_hash IS NOT NULL;
CREATE INDEX IF NOT EXISTS vaults_catalog_order_idx
  ON vaults(chain_id,creation_block DESC,address) WHERE factory_address IS NOT NULL;

ALTER TABLE balances ADD COLUMN IF NOT EXISTS amount0 numeric(78,0) CHECK(amount0 IS NULL OR amount0 >= 0);
ALTER TABLE balances ADD COLUMN IF NOT EXISTS amount1 numeric(78,0) CHECK(amount1 IS NULL OR amount1 >= 0);
ALTER TABLE balances ADD COLUMN IF NOT EXISTS accounting_available boolean NOT NULL DEFAULT false;
ALTER TABLE balances ADD COLUMN IF NOT EXISTS finality text NOT NULL DEFAULT 'OBSERVED' CHECK(finality IN ('OBSERVED','CONFIRMED','FINALIZED'));
ALTER TABLE balances ADD COLUMN IF NOT EXISTS indexed_block_hash text;
CREATE INDEX IF NOT EXISTS balances_wallet_order_idx ON balances(chain_id,wallet_address,vault_address);

CREATE TABLE IF NOT EXISTS m7_projection_state (
  chain_id bigint PRIMARY KEY,
  generation bigint NOT NULL DEFAULT 0 CHECK(generation >= 0),
  indexed_through_block numeric(78,0) NOT NULL CHECK(indexed_through_block >= 0),
  indexed_block_hash text NOT NULL,
  finality text NOT NULL CHECK(finality IN ('OBSERVED','CONFIRMED','FINALIZED')),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS m7_projection_events (
  chain_id bigint NOT NULL,
  transaction_hash text NOT NULL,
  log_index integer NOT NULL CHECK(log_index >= 0),
  block_hash text NOT NULL,
  event_name text NOT NULL,
  canonical boolean NOT NULL DEFAULT true,
  applied_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(chain_id,transaction_hash,log_index,block_hash)
);
CREATE INDEX IF NOT EXISTS m7_projection_events_canonical_idx
  ON m7_projection_events(chain_id,canonical,block_hash);
