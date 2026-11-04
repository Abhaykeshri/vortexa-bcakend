import { Router, type RequestHandler } from 'express';
import { createContractsController } from '../controllers/contracts-controller.js';
import { createHealthController } from '../controllers/health-controller.js';
import { createVaultQueryController } from '../controllers/vault-query.controller.js';
import { createNetworkController } from '../controllers/network-controller.js';
import type { ApiDependencies } from '../api-dependencies.js';
import { validateRequestedChain } from '../validators/request.validator.js';

export function createApiRouter(dependencies: ApiDependencies): Router {
  const router = Router();
  const health = createHealthController(dependencies);
  const network = createNetworkController(dependencies);
  const contracts = createContractsController(dependencies);
  const vaultQueries = createVaultQueryController(dependencies);
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
  return router;
}
