# V2 final integration readiness audit

Audit date: 2026-11-05. Scope: the four supplied VortexA screenshots, the 27-page backend specification, the local Express API, PostgreSQL/Redis read-only connectivity, migration `0005`, and the Sepolia deployment. No deployment, migration, backfill, signing, or transaction broadcast was performed.

## Executive result

**Current result: BLOCKED only on live-data availability.** The six route parsing defects are fixed, response DTOs now expose honest availability metadata, shape/strategy/preset catalogues and unsigned manager builders are documented, and V2 events have reorg-safe projectors. Sepolia currently has no registered V2 vault, so vault-scoped live workflows cannot be demonstrated.

| Screen | Result | Main reason |
| --- | --- | --- |
| V2 Vault Listing | PASS (fixture) / BLOCKED (live) | Filters/search and honest summary fields are available; Sepolia has no indexed vault rows. USD analytics remain explicitly unavailable. |
| Create V2 Vault | PASS (unsigned) / BLOCKED (live E2E) | Config validation and unsigned builders are available; a live created vault is required to prove the follow-on deposit. |
| Vault Detail + Deposit | PASS (routes) / BLOCKED (live) | Parameter validation and DTOs are fixed; no registered Sepolia vault exists for quote/simulation. |
| Withdraw | PASS (routes) / BLOCKED (live) | Unsigned workflow is guarded; no live vault/position exists for an end-to-end call. |

## Actual HTTP audit

All calls were made over TCP to `http://127.0.0.1:3000` with the configured browser Origin. `404` on transaction routes is the expected current-chain result for an unregistered fixture vault, not a successful deposit/withdraw.

| # | Method and path | HTTP | Audit result |
| --- | --- | --- | --- |
| 1 | `GET /v1/openapi.json` | 200 | PASS: valid OpenAPI 3.1 JSON, but response/error schemas are incomplete. |
| 2 | `GET /v1/chains/11155111/vaults?limit=20&sort=age&direction=desc` | 200 | PASS at transport level; empty/stale projection. |
| 3 | `GET /v1/chains/11155111/vaults/:vault?user=:user` | 404* | PASS validation; unknown fixture is correctly not found. |
| 4 | `GET /v1/chains/11155111/vaults/:vault/bands` | 404* | PASS validation; unknown fixture is correctly not found. |
| 5 | `GET /v1/chains/11155111/vaults/:vault/activity?limit=20` | 404* | PASS validation; unknown fixture is correctly not found. |
| 6 | `GET /v1/chains/11155111/vaults/:vault/history` | 404* | PASS validation; unknown fixture is correctly not found. |
| 7 | `GET /v1/chains/11155111/vaults/:vault/rebalances` | 404* | PASS validation; unknown fixture is correctly not found. |
| 8 | `GET /v1/chains/11155111/users/:address/positions?limit=20` | 200 | PASS validation; empty position page when no vaults are indexed. |
| 9 | `GET /v1/chains/11155111/pools` | 200 | PASS: live allowed pool and PriceGuard state. |
| 10 | `GET /v1/shapes` | 200 | PARTIAL: IDs/validity only; names are placeholders and metadata is unavailable. |
| 11 | `POST /v1/shapes/preview` | 200 | PASS: live bands/weights from `ShapeLibrary`. |
| 12 | `GET /v1/chains/11155111/limits` | 200 | PARTIAL: main numeric limits only. |
| 13 | `POST /v1/chains/11155111/tx/validate-config` | 200 | PASS with `{ "config": ... }`; pool allowed/trusted and zero violations. |
| 14 | `POST /v1/chains/11155111/tx/create-vault` | 200 | PASS: unsigned calldata, `PASSED` live simulation, expiry block, no signature/hash. |
| 15 | `POST /v1/chains/11155111/quotes/deposit` | 404 | BLOCKED: fixture address is not a factory vault; factory has zero vaults. |
| 16 | `POST /v1/chains/11155111/tx/deposit` | 404 | BLOCKED for the same reason. |
| 17 | `POST /v1/chains/11155111/quotes/withdraw` | 404 | BLOCKED for the same reason. |
| 18 | `POST /v1/chains/11155111/tx/withdraw` | 404 | BLOCKED for the same reason. |

Regression coverage now verifies valid registered resources return 200, unknown vaults return 404, and malformed addresses/unsupported chains remain 400.

## Final implementation status

- Six strict-route regressions: fixed and covered by three regression groups (98/98 automated tests passing).
- Listing: search, strategy/pool filters, opaque pagination, current-page TVL/active summary, and grouped pair counts are returned without fabricated analytics.
- Shape/strategy/volatility metadata, display-only tick/decimal helpers, detail pool/fee/balance fields, and manager update/rebalance unsigned builders are implemented.
- V2 activity, rebalance, and fee projectors use `(chain, transaction, log index, block hash)` identities and are marked non-canonical on reorg. Migration `0005` remains unapplied by design.
- OpenAPI now includes response envelopes and common 400/404/409/429/503 error responses.

The local HTTP process could not complete a live 18-endpoint sweep because the configured PostgreSQL/Redis dependencies were unavailable (the API correctly failed closed with `503`). The fixture-backed HTTP suite is the verification source until those services are started.

## Screenshot field/action coverage

### V2 Vault Listing

| Visible UI item | Backend coverage |
| --- | --- |
| Total TVL, Active Vaults, 24h Volume, Average Fee APR cards | Missing aggregate DTO/endpoint. |
| V2 Vaults / My Vaults | `wallet` filter exists; current data is empty/stale. |
| Strategy filter | Supported: `NormalLP`, `BuyDip`, `SellPump`. |
| Network filter | Not supported as a query; API is currently Sepolia-only. |
| Pair filter | Supported indirectly by `poolId`, not token symbols. |
| Search vault name/token pair | Missing; no `search` query and vault name/symbol are absent from list projection. |
| Vault/pair name and icons | Token metadata comes from pools, but list row lacks name/symbol and presentation metadata. |
| Network and strategy | `chainId` and strategy exist; display label/icon is frontend metadata. |
| Per-pair vault count | Missing; API returns individual vault rows, not grouped pair rows. |
| TVL | Raw total assets can exist; verified USD is `null`. |
| 24h volume | `null`/history unavailable. |
| 24h fees | Missing field. |
| 24h APR | Only `apr7d: null`; requested period/type does not match UI. |
| Numbered pagination | API uses opaque cursors. Frontend must adapt; random page jumps are unsupported. |

### Create V2 Vault

| Visible UI item | Backend coverage |
| --- | --- |
| Chain/pair picker | Pool catalogue exists, but only Sepolia ETH/USDC is deployed. |
| Pool price, 24h volume/change, pool TVL/fees/APR | PriceGuard reference/raw sqrt price exists; formatted market price and analytics are missing. |
| Hook, tick spacing | Present in pool key. |
| Vault name | Required `name`; API also requires `symbol`, which is not visibly collected in the screenshot. |
| Candlestick chart/timeframes/market liquidity | Missing; requires market/history provider. |
| Normal LP / Buy the Dip / Sell the Pump | Supported as numeric strategy `0/1/2`; display enum metadata is not returned. |
| Liquidity shape name (for example Exponential) | Missing. `/shapes` returns placeholder `Shape N` and `metadataAvailable:false`. |
| Volatility strategy preset | Missing catalogue/field; it could only be a frontend preset that derives config values. |
| Auto-rebalance and Swap/Limit/Asset ratio | Supported. |
| Lower/center/upper price controls | Backend accepts ticks, not displayed prices; no price-to-tick conversion endpoint. |
| AI Pool / Reset Range / chart controls | Unsupported backend actions; could be frontend-only, but no recommendation endpoint exists. |
| Limit width, token weights, carpet | Config fields exist. |
| Exact/custom token ratio and required ratio | Raw pair amounts exist; no required-ratio/optimal-deposit quote for create. |
| Token balances | Builder checks balances; no balance DTO is returned for display. |
| Slippage | `toleranceBps` is bounded to 500; swap slippage to 100. |
| Automation funding | Supported; zero or at least `0.001 ETH`. |
| Create V2 Vault | `createVault` and `createVaultAndDeposit` builder paths exist; only no-deposit create has a live passing simulation. |

### Vault Detail + Deposit

| Visible UI item | Backend coverage |
| --- | --- |
| Vault name/symbol/config/manager/strategy/address | Present in live `VaultLens.vaultInfo`, but detail HTTP route currently fails before the use case. |
| Active/in-range/paused flags | Lens fields exist. |
| TVL, 24h volume, 24h fees, APR, depositors | Raw assets exist; USD/volume/APR unavailable; 24h fees and depositor count missing. |
| Share/copy/explorer | Can be frontend-derived from address/chain. |
| Historical rate, Position Price/APY/TVL/Price tabs | History endpoint deliberately returns unavailable; no chart series. |
| Min/current/max displayed prices | Ticks/current sqrt price exist; formatted edge prices are not returned. |
| LP breakdown and token amounts | Total assets 0/1 and shares exist; USD values and underlying-pool breakdown are missing. |
| Exact/custom deposit and token inputs | `pair`, `zapSingle`, and `zapPair` DTOs support the contract actions. |
| Deposit fee / withdrawal fee / performance fee | No complete fee-breakdown DTO. |
| Pool details | Pool catalogue plus vault config can supply pair, fee, spacing, hook, pool ID after route fix. |
| Vault transactions | Raw canonical events exist after route fix/backfill; formatted description/amount/status is frontend work. |
| Rebalance tab/action | Read history returns unavailable; manager update/rebalance transaction endpoints required by the PDF are missing. |

### Withdraw

| Visible UI item | Backend coverage |
| --- | --- |
| Exact ratio / custom mix | `pair` and `zap` with `token0ShareBps` support in-kind/custom mix. |
| Amount displayed in token terms and percentage slider | API requires raw vault `shares`; frontend must convert percentage using position shares. No direct token-amount withdrawal input. |
| Slippage | Supported and bounded. |
| Withdrawal quote and unsigned call | Implemented, but live verification is blocked by zero deployed vaults/positions. |
| Share approval to Zap | Exact requested share approval is generated for `zap`; in-kind pair needs no approval. |
| Header/history/LP/pool/address/transactions | Same missing/failed fields as the detail screen. |

## DTO handover

All chain quantities are JSON decimal strings. Addresses are 20-byte hex strings. Browser endpoints require an exact configured CORS Origin; they do **not** require an API key or wallet signature. Distributed Redis rate limiting applies. The backend does not use cookie authentication on these routes.

### Shared vault config - all fields required

`poolKey { currency0, currency1, fee, tickSpacing, hooks }`, `strategy`, `shapeId`, `centerTick`, `ticksLeft`, `ticksRight`, `driftTicks`, `trailTicks`, `autoRebalance`, `lockOnFill`, `depositCap` (decimal string), `baseIsCurrency0`, `triggerTicksDown`, `triggerTicksUp`, `rebalanceMethod`, `limitWidthTicks`, `token0WeightBps`, and `carpetBps`.

### Endpoint request/response guide

| Endpoint | Required request fields | Optional request fields/defaults | Principal response |
| --- | --- | --- | --- |
| `GET /vaults` | path `chainId` | `cursor`, `limit`, `strategy`, `poolId`, `wallet`, `sort`, `direction` | `data[]`, `nextCursor`, `meta`; each row has projection fields and nullable metrics. |
| `GET /vaults/:vault` | `chainId`, `vault` | query `user` | `vault`, `projection`, `position`, `metrics`. Currently broken. |
| `GET /bands` | `chainId`, `vault` | none | `data[]`, `poolTick`. Currently broken. |
| `GET /activity` | `chainId`, `vault` | `cursor`, `limit` | canonical event page. Currently broken. |
| `GET /history`, `/rebalances` | `chainId`, `vault` | none | `{data:[],available:false,reason}`. Currently broken before that response. |
| `GET /users/:address/positions` | `chainId`, `address` | `cursor`, `limit` | position page with decimal-string shares/amounts. Currently broken. |
| `GET /pools` | `chainId` | none | live pool rules, token metadata, cap and PriceGuard state. |
| `GET /shapes` | none | none | `{id,valid,name,metadataAvailable}[]`. |
| `POST /shapes/preview` | `shapeId`, `centerTick`, `ticksLeft`, `ticksRight`, `tickSpacing` | none | `bands[]`, `weights[]`. |
| `GET /limits` | `chainId` | none | shape, width, carpet, tolerance, slippage and funding limits. |
| `POST /tx/validate-config` | `{config:<shared config>}` | none | `valid`, `pool`, `violations[]`. |
| `POST /tx/create-vault` | `user`, `name`, `symbol`, `config` | `deposit {amount0,amount1,automationFunding='0',toleranceBps=50}` | expiring unsigned transaction plan. |
| `POST /quotes/deposit`, `/tx/deposit` | `mode`, `vault`, `user`, `receiver`; pair modes need `amount0/amount1`; single needs `tokenIn/amountIn` | `toleranceBps=50`, `swapSlippageBps=50` | quote-only metadata or unsigned steps. |
| `POST /quotes/withdraw`, `/tx/withdraw` | `mode`, `vault`, `user`, `receiver`, `shares` | `token0ShareBps=5000`, `toleranceBps=50`, `swapSlippageBps=50` | expected/minimum token outputs or unsigned steps. |

Concrete JSON examples for every endpoint are in `docs/V2_UI_API.md`. The generated OpenAPI currently validates request parameters/bodies, but every `200` response is incorrectly documented as only `{requestId}` and error responses/security metadata are absent. Do not generate the frontend response client from this OpenAPI until it is corrected.

### Transaction approval sequence

1. Request a quote/plan using the connected wallet as `user` and intended `receiver`.
2. Reject expired plans (`currentBlock > expiresAfterBlock`) and calls with `FAILED` or `PENDING_APPROVAL` simulation.
3. Send only the returned exact `approve` step(s) through the user's wallet and wait for confirmation.
4. Request a fresh plan after approvals. Never reuse the pre-approval plan as authoritative.
5. Confirm the final step has `simulation.status = PASSED`, then let the user's wallet sign and broadcast it.
6. Refresh chain/projection reads after confirmation. The backend never signs or broadcasts.

Code review confirms `approve(spender, requestedAmount)` is used, unlimited approval is not generated, targets come from the deployment registry/factory registration, balances and allowances are checked, quote minimums use bounded tolerance, and calls use `eth_call`. Source search found no signing or broadcast path in the V2 adapter. A fixture HTTP workflow passed create -> exact approval + deposit -> exact share approval + withdraw. This proves HTTP/serialization orchestration only; it is not a fork/live contract success claim.

### Error contract

Observed stable transport/security codes include `INVALID_INPUT` (400), `NOT_FOUND` (404), `RATE_LIMITED` (429), `PAYLOAD_TOO_LARGE` (413), `ORIGIN_NOT_ALLOWED` (403), `METHOD_NOT_ALLOWED` (405), `SECURITY_DEPENDENCY_UNAVAILABLE` (503), `STALE_STATE` (503), and `UPSTREAM_UNAVAILABLE` (503). All include `requestId` except the raw OpenAPI document.

The PDF's contract error catalogue is **not implemented as specified**. Contract validation/revert cases are mostly collapsed to `INVALID_INPUT` 400 or a simulation `revert` name, rather than the required 403/404/409/422/503 mapping and UI-safe messages. Responses are JSON, not RFC 9457 `application/problem+json`.

### Null/unavailable policy

- Listing: `tvlUsd`, `apr7d`, `volume24hUsd` are `null` with availability reasons. `tvlRaw` may also be unavailable.
- Detail: those metrics and history are `null`; `unavailable` identifies missing price/history providers.
- History/rebalances: empty data with `available:false` and a reason, once the path bug is fixed.
- Missing values must render as `--` or “Unavailable”, never `$0`, `0%`, or fabricated production data.

## Migration 0005 review

| Area | Result | Finding |
| --- | --- | --- |
| Additive/backward compatibility | PASS with caveat | Creates only new `v2_*` tables; no existing table alteration or data rewrite. |
| Existing table safety | FAIL | `CREATE TABLE IF NOT EXISTS` can silently accept an incompatible pre-existing table and still record the migration. The down script could then drop a table the migration did not create. |
| Core keys/checks | PARTIAL | Primary keys and decimal precision are present; token decimals and nonnegative indexes have checks. Address/hash length, nonnegative amounts/blocks, tick ordering and enum/finality/role checks are absent. |
| Query indexes | FAIL | Activity lacks canonical + descending `(chain_id,vault_address,block_number,log_index)` coverage; rebalances and fee collections lack vault/block indexes. |
| Reorg identity | FAIL | `v2_rebalances` omits `log_index`, `block_hash`, and finality; `v2_fee_collections` primary identity omits `block_hash`. This is weaker than the repository's reorg-safe event identity. |
| Rollback safety | PARTIAL | Reverse dependency order is correct and rollback requires an environment guard, but it is destructive and unqualified `DROP TABLE` can remove pre-existing same-name tables. |
| Ledger compatibility | PASS | Version is appended to the ordered migration list, SHA-256 is verified, an advisory lock and per-migration transaction are used. Production ledger currently contains only `0001`-`0004`; `0005` remains unapplied. |
| Drizzle parity | PARTIAL | Tables/columns match broadly, but SQL checks are not represented in Drizzle schema and no repository/projector currently populates the new tables. |

## Infrastructure and Sepolia evidence

- PostgreSQL: PASS using `BEGIN READ ONLY`; server reachable, migration ledger readable, `0001`-`0004` present, no `v2_*` tables present. No write was made.
- Redis: PASS using `PING` only. No key was written.
- Chain ID: Sepolia `11155111` PASS.
- Latest observed block: `12067739`; finalized wiring check block: `12067726`.
- Factory deployment/start block: `12060681`.
- 15/15 pinned contract runtime hashes match their ABIs/deployment manifest.
- Wiring: 59 passed, 0 failed; PriceGuard wiring/trust passed; timelock is 172800 seconds; Vault implementation is not paused.
- Factory vault count: zero. Therefore no live deposit or withdrawal success is claimed.

## Verification summary

- Build and TypeScript checks: PASS.
- Railway TypeScript check: PASS.
- ESLint and Prettier check: PASS.
- Hexagonal boundaries/import cycles/HTTP SQL isolation: PASS.
- Secret scan: PASS.
- Test suite: 95 passed, 0 failed, but it does not catch the strict path-param bug or prove adapter-level deposit/withdraw calldata on a real/forked vault.
- Production dependency audit: 0 vulnerabilities.
- Full dependency audit has 10 moderate findings in development lint tooling; no high or critical findings.

## Exact blockers before frontend integration

1. Fix and regression-test the six parameterized read routes.
2. Correct OpenAPI response/error/security schemas and validate generated clients against actual bodies.
3. Decide whether the screenshot's listing aggregate cards, search, grouped pair rows, 24h fees and exact APR period are mandatory; implement matching DTOs if yes.
4. Add authoritative shape names/strategy compatibility and define the volatility preset contract or mark it frontend-only.
5. Add/choose verified pricing and historical analytics sources for USD TVL, 24h volume/fees/APR and chart data.
6. Add depositor count and fee-breakdown DTOs if those visible fields must be populated.
7. Add the PDF-required manager update/rebalance endpoints if the visible Rebalance tab is in this release.
8. Harden migration `0005` constraints/indexes/reorg identity and remove unsafe pre-existing-table ambiguity before approval.
9. Apply `0005` only after backup/checkpoint/rollback approval, then implement and reconcile the projectors; do not backfill yet.
10. Create a funded test vault on an isolated Anvil/Sepolia test workflow and run all create-and-deposit, pair/zap deposit, pair/zap withdrawal and stale-quote scenarios. A live Sepolia vault is required before claiming live success.

