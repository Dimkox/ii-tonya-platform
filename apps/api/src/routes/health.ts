import type { FastifyPluginAsync } from "fastify";

export interface ReadinessProbe {
  check(): Promise<Readonly<{
    postgres: boolean;
    migrations: boolean;
    workerLease: boolean;
    adapters: boolean;
  }>>;
}

export const healthRoutes: FastifyPluginAsync<{ readiness: ReadinessProbe }> = async (app, options) => {
  app.get("/health/live", async () => ({ status: "live" }));
  app.get("/health/ready", async (_request, reply) => {
    const checks = await options.readiness.check();
    const ready = Object.values(checks).every(Boolean);
    return reply.code(ready ? 200 : 503).send({ status: ready ? "ready" : "not_ready", checks });
  });
};
