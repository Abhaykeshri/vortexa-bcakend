# Railway PostgreSQL and Redis (M4-M5)

1. In Railway, rotate BOTH passwords previously exposed in chat.
2. PostgreSQL service > Connect > Public Networking: enable a TCP proxy and copy the external DATABASE_URL.
3. Redis service > Connect > Public Networking: enable a TCP proxy and copy the external REDIS_URL.
4. Replace placeholders only in local `.env` or PM2 server secrets, never `.env.example`.
5. `*.railway.internal` addresses are PRIVATE and do not work from your Windows laptop or Raj's external PM2 server.
6. Prefer encrypted connections (TLS) and IP restrictions where supported. Keep credentials out of logs.
7. Run `npm run verify:live:m4-m5` for isolated connectivity/behavior evidence. It creates and removes a random schema and namespaced Redis keys only.
8. Run the real migration only against an approved staging/production database after backup and restore planning.

Never concatenate database and Redis URLs. They are separate environment variables.
