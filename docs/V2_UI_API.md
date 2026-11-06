# V2 UI API contract

All blockchain quantities are decimal strings in JSON. Addresses are normalized lowercase. Every response includes a server-generated `requestId`. Quote and transaction endpoints set `Cache-Control: no-store`; a response is advisory and expires at `expiresAfterBlock`. The backend never signs or broadcasts.

## Endpoint inventory

| Method | Path | Screen/use |
| --- | --- | --- |
| GET | `/v1/openapi.json` | Generated OpenAPI 3.1 document |
| GET | `/v1/chains/:chainId/vaults` | Vault listing and My Vaults |
| GET | `/v1/chains/:chainId/vaults/:vault` | Vault detail and optional `?user=` position |
| GET | `/v1/chains/:chainId/vaults/:vault/bands` | Liquidity bands |
| GET | `/v1/chains/:chainId/vaults/:vault/activity` | Canonical activity page |
| GET | `/v1/chains/:chainId/vaults/:vault/history` | Available history or explicit unavailable state |
| GET | `/v1/chains/:chainId/vaults/:vault/rebalances` | Available rebalance history or unavailable state |
| GET | `/v1/chains/:chainId/users/:address/positions` | Wallet positions |
| GET | `/v1/chains/:chainId/pools` | Contract-verified pool catalogue |
| GET | `/v1/shapes` | Contract-verified shape IDs |
| POST | `/v1/shapes/preview` | Shape bands and weights |
| GET | `/v1/chains/:chainId/limits` | Client validation limits |
| POST | `/v1/chains/:chainId/tx/validate-config` | Domain plus live-contract validation |
| POST | `/v1/chains/:chainId/tx/create-vault` | Unsigned `createVault` or `createVaultAndDeposit` plan |
| POST | `/v1/chains/:chainId/quotes/deposit` | Pair, single-token Zap, or pair-Zap quote |
| POST | `/v1/chains/:chainId/tx/deposit` | Exact approvals plus unsigned deposit call |
| POST | `/v1/chains/:chainId/quotes/withdraw` | In-kind or Zap-withdraw quote |
| POST | `/v1/chains/:chainId/tx/withdraw` | Share approval when required plus unsigned withdrawal |
| POST | `/v1/chains/:chainId/tx/manager/update` | Unsigned manager configuration update |
| POST | `/v1/chains/:chainId/tx/manager/rebalance` | Unsigned manager rebalance |

The legacy `/api/v1/*` routes remain available.

## Read examples

```http
GET /v1/chains/11155111/vaults?limit=25&strategy=NormalLP&sort=tvl&direction=desc
GET /v1/chains/11155111/vaults?wallet=0x1111111111111111111111111111111111111111
```

```json
{
  "data": [],
  "nextCursor": null,
  "meta": { "stale": true, "generation": "138" },
  "requestId": "<uuid>"
}
```

Each vault card includes `metrics.tvlRaw`; `tvlUsd`, `apr7d`, and `volume24hUsd` are `null` with an availability reason until verified prices/history exist. Listing responses include an explicit `summary.scope`; unavailable aggregate values remain `null` rather than fabricated.

```http
GET /v1/chains/11155111/vaults/0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa?user=0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb
GET /v1/chains/11155111/vaults/0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/bands
GET /v1/chains/11155111/vaults/0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/activity?limit=25
GET /v1/chains/11155111/vaults/0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/history
GET /v1/chains/11155111/vaults/0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/rebalances
GET /v1/chains/11155111/users/0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb/positions?limit=25
```

Detail is read live through `VaultLens.vaultInfo`; activity and positions use finalized PostgreSQL projections. Vault history is sampled once per minute from finalized pinned projections and returns chronological snapshots with block number, token totals, pool tick, and range status. Until the indexer records the first finalized snapshot, history returns an empty page with `available: false` and `HISTORICAL_SNAPSHOTS_PENDING`. Rebalance history remains unavailable until its read model is wired:

```json
{
  "data": [],
  "available": false,
  "reason": "HISTORICAL_SNAPSHOTS_PENDING",
  "requestId": "<uuid>"
}
```

```http
GET /v1/chains/11155111/pools
GET /v1/shapes
GET /v1/chains/11155111/limits
```

Pool responses include token metadata, `allowed`, `maxDepositCap`, `priceTrusted`, `priceDeviationBps`, and the PriceGuard reference price. Shape names remain nullable metadata; validity comes from `ShapeLibrary.isValidShape`.

```http
POST /v1/shapes/preview
Content-Type: application/json

{"shapeId":3,"centerTick":-199050,"ticksLeft":2500,"ticksRight":2500,"tickSpacing":25}
```

```json
{"bands":[],"weights":[],"requestId":"<uuid>"}
```

The arrays above are populated only with values returned by `ShapeLibrary.computeBands`.

## Configuration and create examples

The shared configuration object is:

```json
{
  "poolKey": {
    "currency0": "0x0000000000000000000000000000000000000000",
    "currency1": "0x1c7d4b196cb0c7b01d743fbc6116a902379c7238",
    "fee": 2345,
    "tickSpacing": 25,
    "hooks": "0x0000000000000000000000000000000000000000"
  },
  "strategy": 0,
  "shapeId": 3,
  "centerTick": -199050,
  "ticksLeft": 2500,
  "ticksRight": 2500,
  "driftTicks": 0,
  "trailTicks": 0,
  "autoRebalance": true,
  "lockOnFill": false,
  "depositCap": "1000000000",
  "baseIsCurrency0": true,
  "triggerTicksDown": 0,
  "triggerTicksUp": 0,
  "rebalanceMethod": 0,
  "limitWidthTicks": 0,
  "token0WeightBps": 0,
  "carpetBps": 0
}
```

```http
POST /v1/chains/11155111/tx/validate-config
{"config":<configuration>}
```

```json
{"valid":true,"violations":[],"pool":{"allowed":true,"priceTrusted":true},"requestId":"<uuid>"}
```

```http
POST /v1/chains/11155111/tx/create-vault
{
  "user":"0x1111111111111111111111111111111111111111",
  "name":"Example Vault",
  "symbol":"EVLT",
  "config":<configuration>
}
```

To use `createVaultAndDeposit`, add:

```json
{"deposit":{"amount0":"1000000000000000","amount1":"1000000","automationFunding":"1000000000000000","toleranceBps":50}}
```

Plans contain only unsigned steps:

```json
{
  "chainId":11155111,
  "blockNumber":"<block>",
  "steps":[{
    "kind":"call",
    "to":"<registry address>",
    "data":"0x...",
    "value":"0",
    "summary":"Create V2 vault",
    "simulation":{"status":"PASSED"}
  }],
  "quote":{},
  "expiresAfterBlock":"<block+2>",
  "requestId":"<uuid>"
}
```

If ERC-20 approval is missing for create-and-deposit, the first response contains only exact approval steps and `quote.status = APPROVAL_REQUIRED`. After those approvals confirm, rebuild the plan to obtain a simulated final call with a contract-derived minimum.

## Deposit examples

The same body is sent to `/quotes/deposit` and `/tx/deposit`.

Plain pair:

```json
{"mode":"pair","vault":"0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","user":"0x1111111111111111111111111111111111111111","receiver":"0x1111111111111111111111111111111111111111","amount0":"1000000000000000","amount1":"1000000","toleranceBps":50,"swapSlippageBps":50}
```

Single-token Zap:

```json
{"mode":"zapSingle","vault":"0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","user":"0x1111111111111111111111111111111111111111","receiver":"0x1111111111111111111111111111111111111111","tokenIn":"0x1c7d4b196cb0c7b01d743fbc6116a902379c7238","amountIn":"1000000","toleranceBps":50,"swapSlippageBps":50}
```

Pair Zap uses `mode: "zapPair"` with `amount0` and `amount1`. Quote responses contain `expectedShares`, `minimumShares`, block expiry, and `requiresApproval`. Transaction responses add exact `approve` steps and the unsigned `depositPair`, `zapDeposit`, or `zapDepositPair` call.

## Withdraw examples

The same body is sent to `/quotes/withdraw` and `/tx/withdraw`.

```json
{"mode":"pair","vault":"0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","user":"0x1111111111111111111111111111111111111111","receiver":"0x1111111111111111111111111111111111111111","shares":"1000000000000000000","token0ShareBps":5000,"toleranceBps":50,"swapSlippageBps":50}
```

Use `mode: "zap"` for `quoteZapWithdraw`/`zapWithdraw`. The plan includes an exact vault-share approval to the deployed Zap when necessary. Quotes contain expected and minimum token0/token1 amounts. Insufficient shares, unsafe slippage, unknown vaults, untrusted pools, and failed simulation are returned without a signed or broadcast transaction.

## Frontend sequence

1. Load pools, shapes, limits, and listing.
2. Submit config validation before requesting a create plan.
3. Display every plan step and its simulation state.
4. Send approval steps from the connected wallet and wait for confirmation.
5. Re-request the plan so the final call is simulated against current allowance/state.
6. Refuse to send a call whose simulation is `FAILED` or `PENDING_APPROVAL`, or whose current block exceeds `expiresAfterBlock`.
7. After a wallet transaction confirms, refresh listing/detail/position projections; never insert optimistic chain facts into server responses.

