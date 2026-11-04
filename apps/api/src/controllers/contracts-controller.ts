import type { RequestHandler } from 'express';
import type { ApiDependencies } from '../api-dependencies.js';
import { presentJson } from '../presenters/json-response.presenter.js';

export function createContractsController(dependencies: ApiDependencies): {
  status: RequestHandler;
  wiring: RequestHandler;
} {
  return {
    status: async (_req, res, next) => {
      try {
        await dependencies.chain.verifyNetwork();
        const results = await Promise.all(
          Object.keys(dependencies.config.contracts).map(async (name) => ({
            name,
            ...((await dependencies.chain.inspect(
              dependencies.contractRegistry.resolve(dependencies.config.chainId, name),
            )) as object),
          })),
        );
        presentJson(res, 200, { chainId: dependencies.config.chainId, contracts: results });
      } catch (error) {
        next(error);
      }
    },
    wiring: async (_req, res, next) => {
      try {
        await dependencies.chain.verifyNetwork();
        const checks = [
          ['VAULT_FACTORY', 'VaultFactory', 'swapExecutor', 'SWAP_EXECUTOR'],
          ['ZAP', 'Zap', 'factory', 'VAULT_FACTORY'],
          ['ZAP', 'Zap', 'executor', 'SWAP_EXECUTOR'],
          ['SWAP_EXECUTOR', 'SwapExecutor', 'factory', 'VAULT_FACTORY'],
          ['SWAP_EXECUTOR', 'SwapExecutor', 'zap', 'ZAP'],
        ] as const;
        const results = await Promise.all(
          checks.map(async ([key, name, getter, expectedKey]) => {
            const actual = await dependencies.contractReader.read(
              name,
              dependencies.config.contracts[key],
              getter,
            );
            const expected = dependencies.config.contracts[expectedKey];
            return {
              contract: name,
              getter,
              expected,
              actual: String(actual),
              passed: String(actual).toLowerCase() === expected.toLowerCase(),
            };
          }),
        );
        const passed = results.filter((result) => result.passed).length;
        presentJson(res, passed === results.length ? 200 : 409, {
          chainId: dependencies.config.chainId,
          passed,
          total: results.length,
          checks: results,
        });
      } catch (error) {
        next(error);
      }
    },
  };
}
