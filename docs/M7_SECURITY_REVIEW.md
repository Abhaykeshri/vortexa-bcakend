# M7 security review

- CORS uses exact values from comma-separated `CORS_ALLOWED_ORIGINS`; multiple development URLs such as localhost and 127.0.0.1 are supported. Production requires HTTPS origins.
- All 12 deployment addresses remain required `CONTRACT_*` ENV values. Runtime code consumes the central validated config; no production address is embedded in M7 source.
- Public M7 routes are Redis rate limited before handlers. Missing/failing Redis fails rate-limited requests closed.
- Internal routes retain constant-time Bearer API-key checks and reject browser origins.
- Native Node security headers provide Helmet-equivalent protections without adding framework middleware.
- JSON serialization escapes HTML-significant characters while preserving the parsed JSON value.
- Declared request bodies over `MAX_REQUEST_BODY_BYTES` fail before application handling.
- CSRF is not applicable to the public GET endpoints or Bearer-authenticated internal routes because no cookie-authenticated state-changing route exists. A reusable fail-closed applicability helper is tested for future routes.
- Errors do not return credentials, RPC URLs, SQL details, or raw provider errors.
- Redis response caching is optional and isolated by chain, resource, generation, cursor, limit, and authorization scope.

Open release controls: authorized migration approval, managed-environment smoke test, real finalized pinned parity, and named security/release approval.
