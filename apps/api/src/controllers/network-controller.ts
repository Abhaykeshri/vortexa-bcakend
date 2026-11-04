import type { RequestHandler } from 'express';
import { publicConfig } from '../config/env.js';
import type { ApiDependencies } from '../http-context.js';
import { presentJson } from '../presenters/json.js';

export function networkController(dependencies: ApiDependencies): {
  configuration: RequestHandler;
  status: RequestHandler;
} {
  return {
    configuration: (_req, res) => presentJson(res, 200, publicConfig(dependencies.config)),
    status: async (_req, res, next) => {
      try {
        await dependencies.chain.verifyNetwork();
        const latest = await dependencies.chain.latestBlock();
        const finalized = await dependencies.chain.finalizedBlock(dependencies.config.chainId);
        presentJson(res, 200, {
          chainId: dependencies.config.chainId,
          latestBlock: latest.toString(),
          safeConfirmationBlock: finalized.toString(),
          confirmationDepth: dependencies.config.confirmations,
        });
      } catch (error) {
        next(error);
      }
    },
  };
}
