import { Router, type RequestHandler } from 'express';
import { createContractsController } from '../controllers/contracts-controller.js';
import { createHealthController } from '../controllers/health-controller.js';
import { createVaultQueryController } from '../controllers/vault-query.controller.js';
import { createNetworkController } from '../controllers/network-controller.js';
import type { ApiDependencies } from '../api-dependencies.js';
import { validateRequestedChain } from '../validators/request.validator.js';
import { createVaultUiController } from '../controllers/vault-ui.controller.js';
import { openApiDocument } from '../openapi.js';

export function createApiRouter(dependencies: ApiDependencies): Router {
  const router = Router();
  const health = createHealthController(dependencies);
  const network = createNetworkController(dependencies);
  const contracts = createContractsController(dependencies);
  const vaultQueries = createVaultQueryController(dependencies);
  const vaultUi = createVaultUiController(dependencies);
  const chainValidation: RequestHandler = (req, _res, next) => {
    try {
      validateRequestedChain(req.query.chainId, dependencies.config.chainId);
      next();
    } catch (error) {
      next(error);
    }
  };
  router.get('/health/live', health.live);
  router.get('/health/ready', health.ready);
  router.get('/api/v1/network', chainValidation, network.configuration);
  router.get('/api/v1/chain/status', chainValidation, network.status);
  router.get('/api/v1/contracts/status', chainValidation, contracts.status);
  router.get('/api/v1/contracts/wiring', chainValidation, contracts.wiring);
  router.get('/api/v1/vaults', chainValidation, vaultQueries.listVaults);
  router.get('/api/v1/vaults/:address/events', chainValidation, vaultQueries.vaultEvents);
  router.get('/api/v1/vaults/:address', chainValidation, vaultQueries.vaultDetail);
  router.get('/api/v1/wallets/:address/positions', chainValidation, vaultQueries.walletPositions);
  router.get('/v1/openapi.json', (_req, res) => res.json(openApiDocument));
  router.get('/v1/shapes', vaultUi.shapes!);
  router.post('/v1/shapes/preview', vaultUi.previewShape!);
  router.get('/v1/chains/:chainId/vaults', vaultUi.listVaults!);
  router.get('/v1/chains/:chainId/vaults/:vault', vaultUi.vaultDetail!);
  router.get('/v1/chains/:chainId/vaults/:vault/bands', vaultUi.bands!);
  router.get('/v1/chains/:chainId/vaults/:vault/activity', vaultUi.activity!);
  router.get('/v1/chains/:chainId/vaults/:vault/history', vaultUi.history!);
  router.get('/v1/chains/:chainId/vaults/:vault/rebalances', vaultUi.rebalances!);
  router.get('/v1/chains/:chainId/users/:address/positions', vaultUi.positions!);
  router.get('/v1/chains/:chainId/pools', vaultUi.pools!);
  router.get('/v1/chains/:chainId/limits', vaultUi.limits!);
  router.post('/v1/chains/:chainId/tx/validate-config', vaultUi.validateConfig!);
  router.post('/v1/chains/:chainId/tx/create-vault', vaultUi.createVault!);
  router.post('/v1/chains/:chainId/quotes/deposit', vaultUi.quoteDeposit!);
  router.post('/v1/chains/:chainId/tx/deposit', vaultUi.buildDeposit!);
  router.post('/v1/chains/:chainId/quotes/withdraw', vaultUi.quoteWithdraw!);
  router.post('/v1/chains/:chainId/tx/withdraw', vaultUi.buildWithdraw!);
  router.post('/v1/chains/:chainId/tx/manager/update', vaultUi.managerUpdate!);
  router.post('/v1/chains/:chainId/tx/manager/rebalance', vaultUi.managerRebalance!);
  return router;
}
