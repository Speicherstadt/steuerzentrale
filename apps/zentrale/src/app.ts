import { Hono } from "hono";
import { formatRequestLog, type LogSink, redactUrl } from "./log.ts";

export type AppDeps = {
  log: LogSink;
  now: () => number;
  version: string;
};

/** The HTTP app of the Zentrale; routes stay thin, logic lives in src/modules (docs/plan.md) */
export const createApp = (deps: AppDeps): Hono => {
  const app = new Hono();

  app.use(async (c, next) => {
    const start = deps.now();
    await next();
    deps.log(
      formatRequestLog({
        time: new Date(start).toISOString(),
        method: c.req.method,
        path: redactUrl(c.req.url),
        status: c.res.status,
        ms: deps.now() - start,
      }),
    );
  });

  // For an external monitor (Z-704): no login, nothing but liveness and version
  app.get("/health", (c) => c.json({ status: "ok", version: deps.version }));

  return app;
};
