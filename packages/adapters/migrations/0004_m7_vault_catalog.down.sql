DROP TABLE IF EXISTS m7_projection_events;
DROP TABLE IF EXISTS m7_projection_state;
DELETE FROM balances WHERE (chain_id,vault_address) IN (
  SELECT chain_id,address FROM vaults WHERE factory_address IS NOT NULL AND shape_id IS NULL
);
DELETE FROM vaults WHERE factory_address IS NOT NULL AND shape_id IS NULL;
DROP INDEX IF EXISTS balances_wallet_order_idx;
ALTER TABLE balances DROP COLUMN IF EXISTS indexed_block_hash;
ALTER TABLE balances DROP COLUMN IF EXISTS finality;
ALTER TABLE balances DROP COLUMN IF EXISTS accounting_available;
ALTER TABLE balances DROP COLUMN IF EXISTS amount1;
ALTER TABLE balances DROP COLUMN IF EXISTS amount0;
DROP INDEX IF EXISTS vaults_catalog_order_idx;
DROP INDEX IF EXISTS vaults_chain_creation_tx_uq;
ALTER TABLE vaults DROP COLUMN IF EXISTS indexed_block_hash;
ALTER TABLE vaults DROP COLUMN IF EXISTS indexed_through_block;
ALTER TABLE vaults DROP COLUMN IF EXISTS finality;
ALTER TABLE vaults DROP COLUMN IF EXISTS accounting_available;
ALTER TABLE vaults DROP COLUMN IF EXISTS total_assets1;
ALTER TABLE vaults DROP COLUMN IF EXISTS total_assets0;
ALTER TABLE vaults DROP COLUMN IF EXISTS total_assets;
ALTER TABLE vaults DROP COLUMN IF EXISTS total_shares;
ALTER TABLE vaults DROP COLUMN IF EXISTS strategy_contract;
ALTER TABLE vaults DROP COLUMN IF EXISTS pool_id;
ALTER TABLE vaults DROP COLUMN IF EXISTS creation_block;
ALTER TABLE vaults DROP COLUMN IF EXISTS creation_transaction_hash;
ALTER TABLE vaults DROP COLUMN IF EXISTS creator;
ALTER TABLE vaults DROP COLUMN IF EXISTS factory_address;
ALTER TABLE vaults ALTER COLUMN shape_id SET NOT NULL;
