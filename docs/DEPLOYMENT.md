# Deployment

Railway is the documented deployment target for this release. Follow [RAILWAY_DEPLOYMENT_GUIDE.md](./RAILWAY_DEPLOYMENT_GUIDE.md) for the service build/start commands, private PostgreSQL/Redis networking, health checks, release procedure, and rollback.

The current Railway Infrastructure as Code definition is `.railway/railway.ts`. Generate and review a plan before applying it; the definition intentionally excludes automatic database migrations. Do not use public database or Redis proxy URLs for deployed services.

Before any release, complete [PRODUCTION_READINESS_CHECKLIST.md](./PRODUCTION_READINESS_CHECKLIST.md). Production migration, credential rotation, deployment, and shared-service operations require their respective owner approvals and are not authorized by a successful local test run.
