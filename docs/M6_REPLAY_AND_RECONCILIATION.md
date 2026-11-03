# M6 replay and reconciliation

Replay command:

`npm run indexer:replay -- --chain-id 11155111 --from-block <BLOCK> --to-block <BLOCK>`

It reads canonical inputs in bounded order, uses ABI decoding, writes through idempotent identities and emits a deterministic SHA-256 logical-state hash. Repeat the identical range twice and compare hashes; timestamps/randomness are excluded from the hash.

`npm run indexer:reconcile` checks canonical block continuity, duplicate event identity and cursor state, then stores evidence with chain and manifest version. It does not claim vault/balance parity, which belongs to later projections/M7. Both commands require an approved migrated database; production execution requires operational approval.
