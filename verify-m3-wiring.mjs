import { ContractReader } from './dist/packages/adapters/src/contract-reader.js';
import { JsonRpcHttpAdapter, SepoliaReadAdapter } from './dist/packages/adapters/src/sepolia-rpc.js';
import { loadConfig } from './dist/apps/api/src/config/env.js';

const config = loadConfig();
const reader = new ContractReader(config.rpcUrls);
const chain = new SepoliaReadAdapter(
  new JsonRpcHttpAdapter(config.rpcUrl, config.rpcTimeoutMs, config.rpcMaxRetries),
  config.confirmations,
  config.chainId,
);
let passed = 0;
const check = (label, ok) => {
  if (!ok) throw new Error(`FAIL: ${label}`);
  passed++;
  console.log(`PASS: ${label}`);
};
const same = (a, b) => String(a).toLowerCase() === String(b).toLowerCase();
await chain.verifyNetwork();
check('Sepolia chain ID', true);
const block = await chain.finalizedBlock(config.chainId);
for (const [key, address] of Object.entries(config.contracts)) {
  const hash = await reader.runtimeCodeHash(address);
  check(`bytecode/hash ${key}`, same(hash, config.contractCodeHashes[key]));
}
const read = (key, name, getter) => reader.read(name, config.contracts[key], getter, block);
const values = {
  factoryOwner: await read('VAULT_FACTORY', 'VaultFactory', 'owner'),
  guardian: await read('VAULT_FACTORY', 'VaultFactory', 'guardian'),
  factoryPriceGuard: await read('VAULT_FACTORY', 'VaultFactory', 'priceGuard'),
  factorySwap: await read('VAULT_FACTORY', 'VaultFactory', 'swapExecutor'),
  factoryFee: await read('VAULT_FACTORY', 'VaultFactory', 'feeCollector'),
  factoryShapes: await read('VAULT_FACTORY', 'VaultFactory', 'shapes'),
  vaultCount: await read('VAULT_FACTORY', 'VaultFactory', 'vaultCount'),
  protocolFee: await read('VAULT_FACTORY', 'VaultFactory', 'protocolFeeBps'),
  priceOwner: await read('PRICE_GUARD', 'PriceGuard', 'owner'),
  feeOwner: await read('FEE_COLLECTOR', 'FeeCollector', 'owner'),
  recipient: await read('FEE_COLLECTOR', 'FeeCollector', 'recipient'),
  delay: await read('TIMELOCK_CONTROLLER', 'TimelockController', 'getMinDelay'),
  lensFactory: await read('VAULT_LENS', 'VaultLens', 'factory'),
  swapFactory: await read('SWAP_EXECUTOR', 'SwapExecutor', 'factory'),
  swapZap: await read('SWAP_EXECUTOR', 'SwapExecutor', 'zap'),
  zapFactory: await read('ZAP', 'Zap', 'factory'),
  zapExecutor: await read('ZAP', 'Zap', 'executor'),
  zapNormal: await read('ZAP', 'Zap', 'normalStrategy'),
  zapDip: await read('ZAP', 'Zap', 'buyTheDipStrategy'),
  zapPump: await read('ZAP', 'Zap', 'sellThePumpStrategy'),
  vaultFactory: await read('VAULT', 'Vault', 'factory'),
  vaultPriceGuard: await read('VAULT', 'Vault', 'priceGuard'),
  vaultSwap: await read('VAULT', 'Vault', 'swapExecutor'),
  vaultPaused: await read('VAULT', 'Vault', 'paused'),
};
for (const [name, value] of Object.entries(values))
  check(`ABI read ${name}`, value !== undefined && value !== null);
const wiring = [
  ['Factory PriceGuard', values.factoryPriceGuard, config.contracts.PRICE_GUARD],
  ['Factory SwapExecutor', values.factorySwap, config.contracts.SWAP_EXECUTOR],
  ['Factory FeeCollector', values.factoryFee, config.contracts.FEE_COLLECTOR],
  ['Factory ShapeLibrary', values.factoryShapes, config.contracts.SHAPE_LIBRARY],
  ['Lens factory', values.lensFactory, config.contracts.VAULT_FACTORY],
  ['SwapExecutor factory', values.swapFactory, config.contracts.VAULT_FACTORY],
  ['SwapExecutor Zap', values.swapZap, config.contracts.ZAP],
  ['Zap factory', values.zapFactory, config.contracts.VAULT_FACTORY],
  ['Zap executor', values.zapExecutor, config.contracts.SWAP_EXECUTOR],
  ['Zap NormalLP strategy', values.zapNormal, config.contracts.NORMAL_LP_STRATEGY],
  ['Zap BuyDip strategy', values.zapDip, config.contracts.BUY_THE_DIP_STRATEGY],
  ['Zap SellPump strategy', values.zapPump, config.contracts.SELL_THE_PUMP_STRATEGY],
  ['Vault factory', values.vaultFactory, config.contracts.VAULT_FACTORY],
  ['Vault PriceGuard', values.vaultPriceGuard, config.contracts.PRICE_GUARD],
  ['Vault SwapExecutor', values.vaultSwap, config.contracts.SWAP_EXECUTOR],
];
for (const [label, actual, expected] of wiring) check(`wiring ${label}`, same(actual, expected));
check('ownership alignment Factory/PriceGuard', same(values.factoryOwner, values.priceOwner));
check('ownership alignment Factory/FeeCollector', same(values.factoryOwner, values.feeOwner));
check('timelock delay >= 48 hours', BigInt(values.delay) >= 172800n);
check('vault implementation not paused', values.vaultPaused === false);
console.log(`M3 verification: ${passed}/${passed} PASS at finalized block ${block}`);
