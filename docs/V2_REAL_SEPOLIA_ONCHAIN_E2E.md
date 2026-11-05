# VortexA — Real Sepolia On-Chain E2E

Verification date: 2026-11-05. Existing deployed VortexA Core contracts were used; no core contract was modified or deployed.

## Final verdict

**BLOCKED before wallet transaction approval.** Read-only deployment and backend integration are verified. Migration 0005 is applied. No private key, secure keystore, funded test wallet, or wallet approval was available in the local environment, so no transaction was signed or broadcast and there are no transaction hashes to claim.

## Existing deployment

Chain ID: `11155111` (Sepolia). The configured manifest is `packages/contracts/manifests/sepolia-v1.json`.

| Contract | Address |
| --- | --- |
| VaultFactory | `0xA7dc22764A76e776a75bf7bBbe37169ae2CC45B2` |
| VaultLens | `0x8d6F15c321135bc62247DFed56868E4EEB9D2745` |
| Vault implementation | `0x258D4A053d9007F00e509088d79E0b99C9C47A1e` |
| Zap | `0xd40eC68130fb7908739400E4E52972D3933a20B6` |
| PriceGuard | `0x5288B03FA0d74a7fE2d59611C360E50E77aC4bE3` |
| ShapeLibrary | `0xBc6D0A524d5DF7C6b86648564b05277d49B5c213` |
| Vault M6 module | `0x0423b71524324a2bf2f225EbAc066417C455dD2b` |
| Vault M5 module | `0xeD0cdc5f4ebD5D0a9F49d1029464Bc1B8ba99130` |

`npm run verify:live:contract-wiring` passed **59/59** checks at finalized block `12068067`. Factory `vaultCount` is `0`; PriceGuard and allowed pool reads are available.

## Database and Redis

- Railway PostgreSQL authenticated successfully; target database reports `railway`.
- Redis authenticated and `PING` returned `PONG`.
- Migration 0005 was applied successfully after 0001–0004; schema verification is 27/27 tables and checksums are valid.
- No tables were reset or deleted.

## Indexer

- Existing cursor before sync: finalized block `12033742`.
- A normal indexer run advanced it safely to `12033902`, with zero logs in the processed range.
- An accelerated run could not acquire the existing Redis lease and was stopped; the worker is not left running.
- Full synchronization to the current head is therefore **PARTIAL/BLOCKED** and must be resumed by the operator with the normal worker identity.
- Factory vault count remains zero; no V2 vault projection can be demonstrated yet.
- `npm run indexer:reconcile` reports `gaps: 0`, `duplicates: 0`, and cursor consistency through `12033902`; this is not current-head synchronization.
- Redis cache behavior is verified for the live empty listing: repeated HTTP reads returned 200 with `Cache-Control: no-store`, and a namespaced vault cache key was created.
- Catch-up diagnosis: the bottleneck is Sepolia RPC `getBlock` throughput, not PostgreSQL inserts or cursor commits. Batch 100/concurrency 1 completed one 100-block batch in about 60 seconds. Batch 500/concurrency 50 hit provider `HttpRequestError` failures on individual `getBlock` calls and was stopped safely; the cursor remains `12033902`.
- Historical backfill was intentionally skipped per operator instruction. The cursor was atomically anchored at finalized block `12068091` (`0x3ee70cfecbd052deef5d9fcfab189a7301a5d2da12e26534de20d0aec16c95e4`) after verifying the RPC header, then the indexer tracked only subsequent blocks. The follow-up run advanced the cursor to `12068189`; no events were observed and no gaps/duplicates were introduced.

## HTTP integration status

| Flow | Result |
| --- | --- |
| Listing | PASS at HTTP layer after migration; no live vault rows yet |
| Create config validation | PASS against live contracts |
| Unsigned create builder | PASS; simulation returned successfully |
| Deposit quote/builder | BLOCKED with semantic 404 because no registered vault exists |
| Withdraw quote/builder | BLOCKED with semantic 404 because no live position exists |
| Manager update | BLOCKED with semantic 404 because no registered vault exists |
| Manager rebalance | Input validation correctly rejects incomplete fixture |

## Wallet transaction gate

Foundry keystore aliases exist, but `cast wallet address --account vortexa-sepolia` requested the local password and was cancelled because that password is not available to the agent. The public address, compromise comparison, ETH/USDC balances and allowances remain unverified. No private key was read or printed. I did not create, import, sign, approve, or broadcast anything.

## Fresh-wallet create-vault preparation

The supplied public wallet `0x7CBaA5370f5d0Ae1b8D61581c020859a84C55583` was checked read-only. It has `0.454667156803865972` Sepolia ETH and `0` USDC (USDC `0x1c7d4b196cb0c7b01d743fbc6116a902379c7238`); allowances to VaultFactory, Zap and SwapExecutor are all zero. Because the previously exposed key is compromised, this address is not eligible for signing.

The current unsigned create plan targets VaultFactory `0xA7dc22764A76e776a75bf7bBbe37169ae2CC45B2`, calls `createVault`, sends value `0`, and simulates `PASSED`. Expected vault result is `0x9ae8b20e6d2fae8588007fad8269e2a83896910c`. Read-only gas estimate is `2,036,551`; gas price was `1,015 wei`, estimated network cost `2,067,099,265 wei` (`0.000000002067099265 ETH`).

No signing command was executed. After the operator creates a fresh dedicated keystore and explicitly approves this exact batch, the external wallet command is:

```powershell
cast send --account <fresh-dedicated-account> --rpc-url $env:SEPOLIA_RPC_URL `
  0xA7dc22764A76e776a75bf7bBbe37169ae2CC45B2 `
  --data <prepared-createVault-calldata> --value 0 --gas-limit 2036551
```

`<fresh-dedicated-account>` and the calldata must be supplied from the newly generated keystore/API plan; the compromised `vortexa-sepolia` account must not be used.

Before any live transaction, the operator must provide a fresh dedicated Sepolia wallet through a secure local keystore mechanism and explicitly approve a displayed batch containing:

1. target contract address and function calldata;
2. exact token amounts and exact approval amounts (never unlimited);
3. gas estimate and max fee;
4. expected events and rollback/expiry behavior.

After approval, the operator can run the existing unsigned builders, send wallet-signed transactions externally, and provide hashes for receipt/event/projection verification. Backend private-key custody remains prohibited.

## Remaining blockers

1. Fresh funded Sepolia test wallet and explicit transaction approval.
2. Resume indexer synchronization to finalized head and verify V2 projection/cache invalidation.
3. Create one real vault through the existing factory.
4. Approve exact token allowances and execute depositPair/zap flows where supported.
5. Execute withdrawPair/zapWithdraw from the confirmed position.
6. Re-run the complete HTTP and database projection matrix with transaction hashes and receipts.

