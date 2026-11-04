# Sepolia timelock delay remediation

The deployed `TimelockController` currently reports a minimum delay of `0` seconds. The release policy requires at least `172800` seconds (48 hours). This is an on-chain governance configuration blocker, not a backend code defect.

## Finalized read-only observation

At finalized Sepolia block `12061857`, the timelock was deployed at block `12060412` with an initial delay of zero and had no later `MinDelayChange`. The timelock itself is the only default administrator. One externally owned account, `0x169974B654a5F635B47D58e57236fA705434050B`, holds proposer, executor, and canceller roles; the executor role is not open. The deterministic remediation operation produced by the inspector was `Unset`, and no transaction was executed.

This single-EOA governance concentration is a separate release risk. First enforce the 48-hour delay using the current authorized role holder under multi-party offline review. Then schedule a separately reviewed role migration to an approved multisig/governance contract under the newly enforced delay. Do not combine unknown role changes with the delay repair.

OpenZeppelin restricts `updateDelay(uint256)` to calls from the timelock itself. The change must therefore be encoded as a timelock operation targeting the timelock, scheduled by an account with `PROPOSER_ROLE`, and executed by an account with `EXECUTOR_ROLE`. A direct owner or administrator call to `updateDelay` must not be attempted.

## Read-only preparation

Run:

```text
npm run inspect:timelock
npm run verify:live:contracts
npm run verify:live:contract-wiring
```

The inspector discovers the deployment block, reconstructs role membership from finalized role events, confirms current roles with `hasRole`, reports delay history, and produces exact calldata, salt, and operation ID. It never requests a signer or sends a transaction.

Before remediation, contract/security owners must confirm:

- Runtime bytecode matches the pinned manifest.
- Verified source/compiler provenance and OpenZeppelin version are acceptable.
- At least one controlled proposer and executor remain available.
- Whether the executor role is open to the zero address.
- Any external `DEFAULT_ADMIN_ROLE` holder is intentional.
- The generated operation ID is `Unset`; do not reuse a salt for an existing operation.
- The target, value, calldata, predecessor, salt, and resulting operation ID are independently reproduced by a second reviewer.

## Approval-controlled transaction sequence

1. Freeze unrelated privileged actions and announce the maintenance window.
2. Through the approved multisig/governance signer, call `schedule` with:
   - target: the timelock address
   - value: `0`
   - data: generated `updateDelay(172800)` calldata
   - predecessor: zero bytes32
   - salt: the reviewed inspector salt
   - delay: the current on-chain minimum delay (`0` until remediated)
3. Verify the emitted `CallScheduled`, operation ID, calldata, and `Ready` state from an independent RPC.
4. Through an approved executor, call `execute` using exactly the same target, value, data, predecessor, and salt.
5. Verify `MinDelayChange(0, 172800)`, `getMinDelay() == 172800`, and operation state `Done` at a finalized block.
6. Rerun contract runtime and wiring verification; release requires all checks to pass.
7. Review role hygiene. Any role grant/revocation is a separate governed change and must not be bundled without an explicit security review.

Because the current delay is zero, the chain cannot enforce a review period for this repair. The safest practical control is multi-party offline verification followed by prompt schedule/execute once approvals are complete, minimizing the time the zero-delay configuration remains active. No transaction in this sequence is authorized by this document alone.

References: [OpenZeppelin access-control documentation](https://docs.openzeppelin.com/contracts/5.x/access-control#timelock) and [TimelockController source](https://github.com/OpenZeppelin/openzeppelin-contracts/blob/master/contracts/governance/TimelockController.sol).

