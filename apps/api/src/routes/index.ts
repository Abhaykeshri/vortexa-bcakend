import { Router, type RequestHandler } from 'express';
import { contractsController } from '../controllers/contracts-controller.js';
import { healthController } from '../controllers/health-controller.js';
import { m7Controller } from '../controllers/m7-controller.js';
import { networkController } from '../controllers/network-controller.js';
import type { ApiDependencies } from '../http-context.js';
import { validateRequestedChain } from '../validators/http.js';

export function createApiRouter(dependencies: ApiDependencies): Router {
  const router = Router();
  const health = healthController(dependencies);
  const network = networkController(dependencies);
  const contracts = contractsController(dependencies);
  const m7 = m7Controller(dependencies);
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
  router.get('/api/v1/vaults', chainValidation, m7.listVaults);
  router.get('/api/v1/vaults/:address/events', chainValidation, m7.vaultEvents);
  router.get('/api/v1/vaults/:address', chainValidation, m7.vaultDetail);
  router.get('/api/v1/wallets/:address/positions', chainValidation, m7.walletPositions);
  return router;
}
