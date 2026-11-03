# M0-M5 implementation report

Date: 2026-11-02.

## Implemented

- Replaced committed credential-like values in `.env.example` with placeholders and added a repository secret scan. The ignored local `.env` was not edited.
- Expanded M2 domain models and ports for positions, strategies, liquidity shapes, capabilities, eligibility, chain events, transaction intents, portfolios, event sources, persistence, cache, leases and signing boundaries.
- Added a versioned Sepolia manifest pinning 12 addresses and live runtime code hashes. Central config rejects chain/address mismatches, supports up to three RPC providers and exposes the manifest version.
- Added viem failover transport, block-tagged reads and runtime-code hashing. Readiness requires all pinned hashes plus Sepolia, PostgreSQL and Redis health.
- Added a Drizzle PostgreSQL schema for deployments, capabilities, vaults, config versions, headers, raw logs, cursors, balances, transactions, sessions, audit events, outbox and keeper jobs. EVM integers use `numeric(78,0)`/decimal strings.
- Added checksummed, advisory-locked, transactional migration tooling plus guarded rollback SQL.
- Added parameterized vault/audit repositories and a durable outbox repository with `FOR UPDATE SKIP LOCKED`, idempotency keys, retry timestamps and transaction rollback.
- Added Redis JSON cache, TTL/rate counters, notifications, owner-safe leases, key validation and outage behavior. Cache/notifications degrade safely; authorization coordination fails closed; PostgreSQL remains durable.
- Added a durable outbox worker with bounded exponential backoff and an eight-attempt dead-letter transition.
- Added enforced ESLint and Prettier gates and corrected the test command for Node 22 compatibility.
- Added isolated live-verification scripts that clean only the random PostgreSQL schema and Redis keys they create.

## API and operations

The existing GET endpoints remain: `/health/live`, `/health/ready`, `/api/v1/network`, `/api/v1/chain/status`, `/api/v1/contracts/status`, and `/api/v1/contracts/wiring`. Mutation methods return 405. No endpoint signs, broadcasts or stores a private key.

Migration commands are `npm run migrate` and guarded `npm run migrate:down`; neither was run against the shared application schema. Verification commands are documented in the README.

Principal changes cover domain types/ports/validation and mocks; config/API readiness; contract reader/RPC adapters; contract manifest; PostgreSQL schema/migrations/repositories; Redis coordination; verification/secret scripts; package/CI configuration; tests; and this documentation set.
