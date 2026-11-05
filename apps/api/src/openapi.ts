import { OpenAPIRegistry, OpenApiGeneratorV31 } from '@asteasolutions/zod-to-openapi';
import { z } from './validators/zod-openapi.js';
import {
  ChainParamsSchema,
  CreateVaultSchema,
  DepositSchema,
  PageQuerySchema,
  ShapePreviewSchema,
  UserParamsSchema,
  VaultConfigSchema,
  VaultDetailQuerySchema,
  VaultListQuerySchema,
  VaultParamsSchema,
  WithdrawSchema,
  ManagerUpdateSchema,
  ManagerRebalanceSchema,
} from './validators/vault-ui.schemas.js';

const registry = new OpenAPIRegistry();
const response = z
  .object({
    requestId: z.string().uuid(),
    data: z.unknown().optional(),
    nextCursor: z.string().nullable().optional(),
    meta: z.unknown().optional(),
    availability: z.unknown().optional(),
  })
  .passthrough();
const errorResponse = z.object({
  error: z.string(),
  code: z.string().optional(),
  requestId: z.string().uuid().optional(),
});
const success = {
  200: { description: 'Successful response', content: { 'application/json': { schema: response } } },
  400: { description: 'Validation or unsupported-chain error', content: { 'application/json': { schema: errorResponse } } },
  404: { description: 'Registered vault/resource not found', content: { 'application/json': { schema: errorResponse } } },
  409: { description: 'Contract safety or state conflict', content: { 'application/json': { schema: errorResponse } } },
  429: { description: 'Distributed rate limit exceeded', content: { 'application/json': { schema: errorResponse } } },
  503: { description: 'Verified data source unavailable', content: { 'application/json': { schema: errorResponse } } },
};

registry.register('VaultConfig', VaultConfigSchema);
registry.register('CreateVaultRequest', CreateVaultSchema);
registry.register('DepositRequest', DepositSchema);
registry.register('WithdrawRequest', WithdrawSchema);

function get(path: string, summary: string, params?: z.ZodObject, query?: z.ZodObject) {
  registry.registerPath({
    method: 'get',
    path,
    summary,
    request: { ...(params ? { params } : {}), ...(query ? { query } : {}) },
    responses: success,
  });
}

function post(path: string, summary: string, body: z.ZodType, params?: z.ZodObject) {
  registry.registerPath({
    method: 'post',
    path,
    summary,
    request: {
      ...(params ? { params } : {}),
      body: { required: true, content: { 'application/json': { schema: body } } },
    },
    responses: success,
  });
}

get('/v1/chains/{chainId}/vaults', 'List V2 vaults', ChainParamsSchema, VaultListQuerySchema);
get(
  '/v1/chains/{chainId}/vaults/{vault}',
  'Get live V2 vault detail',
  VaultParamsSchema,
  VaultDetailQuerySchema,
);
get('/v1/chains/{chainId}/vaults/{vault}/bands', 'Get vault liquidity bands', VaultParamsSchema);
get(
  '/v1/chains/{chainId}/vaults/{vault}/activity',
  'Get canonical vault activity',
  VaultParamsSchema,
  PageQuerySchema,
);
get('/v1/chains/{chainId}/vaults/{vault}/history', 'Get available vault history', VaultParamsSchema);
get('/v1/chains/{chainId}/vaults/{vault}/rebalances', 'Get available rebalance history', VaultParamsSchema);
get(
  '/v1/chains/{chainId}/users/{address}/positions',
  'Get projected user positions',
  UserParamsSchema,
  PageQuerySchema,
);
get('/v1/chains/{chainId}/pools', 'Get contract-verified allowed pools', ChainParamsSchema);
get('/v1/chains/{chainId}/limits', 'Get V2 protocol limits', ChainParamsSchema);
get('/v1/shapes', 'Get deployed shape catalogue');
post('/v1/shapes/preview', 'Preview shape bands', ShapePreviewSchema);
post(
  '/v1/chains/{chainId}/tx/validate-config',
  'Validate a vault configuration against domain and deployed contract rules',
  z.strictObject({ config: VaultConfigSchema }),
  ChainParamsSchema,
);
post(
  '/v1/chains/{chainId}/tx/create-vault',
  'Build an unsigned create-vault plan',
  CreateVaultSchema,
  ChainParamsSchema,
);
post('/v1/chains/{chainId}/quotes/deposit', 'Quote a V2 vault deposit', DepositSchema, ChainParamsSchema);
post(
  '/v1/chains/{chainId}/tx/deposit',
  'Build an unsigned V2 vault deposit plan',
  DepositSchema,
  ChainParamsSchema,
);
post(
  '/v1/chains/{chainId}/quotes/withdraw',
  'Quote a V2 vault withdrawal',
  WithdrawSchema,
  ChainParamsSchema,
);
post(
  '/v1/chains/{chainId}/tx/withdraw',
  'Build an unsigned V2 vault withdrawal plan',
  WithdrawSchema,
  ChainParamsSchema,
);
post('/v1/chains/{chainId}/tx/manager/update', 'Build an unsigned manager configuration update', ManagerUpdateSchema, ChainParamsSchema);
post('/v1/chains/{chainId}/tx/manager/rebalance', 'Build an unsigned manager rebalance', ManagerRebalanceSchema, ChainParamsSchema);

export const openApiDocument = new OpenApiGeneratorV31(registry.definitions).generateDocument({
  openapi: '3.1.0',
  info: {
    title: 'VortexA V2 Vault API',
    version: '1.0.0',
    description: 'Read APIs and unsigned transaction plans for the four V2 vault screens.',
  },
  servers: [{ url: '/' }],
});
