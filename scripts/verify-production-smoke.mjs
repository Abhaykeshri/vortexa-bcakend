const baseUrl = requiredUrl('PRODUCTION_BASE_URL');
const internalApiKey = required('INTERNAL_API_KEY');
const allowedOrigin = process.env.SMOKE_ALLOWED_ORIGIN;
const timeoutMs = integer('SMOKE_TIMEOUT_MS', 10000, 1000, 60000);

if (
  baseUrl.protocol !== 'https:' &&
  !(process.env.ALLOW_HTTP_SMOKE === 'true' && ['127.0.0.1', 'localhost'].includes(baseUrl.hostname))
)
  throw new Error('Production smoke target must use HTTPS');

const checks = [
  { name: 'liveness', path: '/health/live' },
  { name: 'readiness', path: '/health/ready', internal: true },
  { name: 'network', path: '/api/v1/network', browser: true },
  { name: 'chain status', path: '/api/v1/chain/status', browser: true },
  { name: 'contract status', path: '/api/v1/contracts/status', browser: true },
  { name: 'contract wiring', path: '/api/v1/contracts/wiring', internal: true },
  { name: 'vault catalog', path: '/api/v1/vaults?limit=1', browser: true },
];

if (process.env.SMOKE_VAULT_ADDRESS)
  checks.push({
    name: 'vault detail',
    path: `/api/v1/vaults/${validatedAddress(process.env.SMOKE_VAULT_ADDRESS)}`,
    browser: true,
  });
if (process.env.SMOKE_WALLET_ADDRESS)
  checks.push({
    name: 'wallet positions',
    path: `/api/v1/wallets/${validatedAddress(process.env.SMOKE_WALLET_ADDRESS)}/positions?limit=1`,
    browser: true,
  });

let failed = 0;
for (const check of checks) {
  const controller = new AbortController();
  const deadline = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const headers = { accept: 'application/json' };
    if (check.internal) headers.authorization = `Bearer ${internalApiKey}`;
    if (check.browser && allowedOrigin) headers.origin = allowedOrigin;
    const response = await fetch(new URL(check.path, baseUrl), {
      headers,
      signal: controller.signal,
      redirect: 'error',
    });
    const contentType = response.headers.get('content-type') ?? '';
    const body = contentType.includes('application/json') ? await response.json() : null;
    const requestId = response.headers.get('x-request-id');
    const passed = response.ok && typeof requestId === 'string' && requestId.length > 0;
    if (!passed) failed += 1;
    console.log(
      JSON.stringify({
        check: check.name,
        status: response.status,
        passed,
        requestIdPresent: Boolean(requestId),
        applicationStatus:
          body && typeof body === 'object' && 'status' in body ? String(body.status) : undefined,
      }),
    );
  } catch (error) {
    failed += 1;
    console.error(
      JSON.stringify({
        check: check.name,
        passed: false,
        errorType: error instanceof Error ? error.name : 'unknown',
      }),
    );
  } finally {
    clearTimeout(deadline);
  }
}

console.log(`Production smoke verification: ${checks.length - failed}/${checks.length} passed`);
if (failed > 0) process.exitCode = 1;

function required(name) {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

function requiredUrl(name) {
  const url = new URL(required(name));
  if (url.username || url.password || url.search || url.hash)
    throw new Error(`${name} must not contain credentials, query parameters, or fragments`);
  if (url.pathname !== '/' && url.pathname !== '') throw new Error(`${name} must be an origin URL`);
  return url;
}

function integer(name, fallback, minimum, maximum) {
  const value = process.env[name] === undefined ? fallback : Number(process.env[name]);
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum)
    throw new Error(`Invalid numeric environment variable: ${name}`);
  return value;
}

function validatedAddress(value) {
  if (!/^0x[a-fA-F0-9]{40}$/.test(value)) throw new Error('Invalid smoke-test address');
  return value;
}
