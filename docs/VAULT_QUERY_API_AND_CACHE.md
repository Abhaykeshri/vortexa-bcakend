# M7 API and cache

## Internal projection read endpoints

| Method | Route                               | Result                                  |
| ------ | ----------------------------------- | --------------------------------------- |
| GET    | `/api/v1/vaults`                    | Stable vault catalog page               |
| GET    | `/api/v1/vaults/:vault`             | Vault detail at the projection snapshot |
| GET    | `/api/v1/vaults/:vault/events`      | Stable canonical event page             |
| GET    | `/api/v1/wallets/:wallet/positions` | Stable wallet-position page             |

All routes require the server-only bearer `INTERNAL_API_KEY` and reject browser origins. They accept `chainId=11155111`; list routes accept `limit` and an opaque `cursor`. Unknown/duplicate query parameters, invalid addresses, invalid limits, and invalid cursors fail with safe 400 responses. Quantities that may exceed JavaScript integer precision are decimal strings.

Each successful response includes `snapshotBlock`, `indexedThroughBlock`, `indexedBlockHash`, `finality`, `stale`, and projection `generation`. A response is stale when the head cannot be checked, the configured lag threshold is exceeded, or the projection is only observed. Stale data is never presented as live.

## Cursor and ordering contract

- Vaults: creation block descending, then address.
- Events: block descending, transaction index descending, log index descending.
- Positions: vault address ascending.
- Cursors are scoped to route, chain, generation, and snapshot block. Reusing a cursor after projection generation changes returns `INVALID_CURSOR`.

## Redis cache contract

The logical key has exactly four colon-separated fields: `<route_name>:<version>:<cursor>:<limit>`. The route field contains chain, resource/filter, and public authorization scope; version contains the projection generation. This prevents cross-chain, cross-address, cross-page, and post-reorg collisions without broad key scans.

TTL is bounded and ENV-driven separately for vault lists, details, events, and positions. Cache read/write failure falls back to authoritative PostgreSQL reads. Rate limiting remains fail-closed and is separate from optional response caching.
