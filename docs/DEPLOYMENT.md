# Deployment

Railway is the documented deployment target for this release. Follow [RAILWAY_DEPLOYMENT_GUIDE.md](./RAILWAY_DEPLOYMENT_GUIDE.md) for the service build/start commands, private PostgreSQL/Redis networking, health checks, release procedure, and rollback.

The PM2 configuration in `ecosystem.config.cjs` is a legacy template, not an approved production deployment path. Do not use the older PM2 procedure or public database proxy URLs for a Railway deployment.

Before any release, complete [PRODUCTION_READINESS_CHECKLIST.md](./PRODUCTION_READINESS_CHECKLIST.md). Production migration, credential rotation, deployment, and shared-service operations require their respective owner approvals and are not authorized by a successful local test run.
