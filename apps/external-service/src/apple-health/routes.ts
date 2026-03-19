import { Hono } from "hono";

import { AppleHealthService } from "./service.js";

const MAX_BODY_SIZE = 1024 * 1024; // 1MB

export function createAppleHealthRouter(service: AppleHealthService): Hono {
  const router = new Hono();

  router.get("/apple-health/health", async (c) => {
    return c.json(await service.getHealth());
  });

  router.post("/apple-health/test", async (c) => {
    if (!service.validateToken(c.req.header("authorization"))) {
      return c.json({ error: "unauthorized" }, 401 as never);
    }

    const contentLength = Number(c.req.header("content-length") ?? "0");
    if (contentLength > MAX_BODY_SIZE) {
      return c.json({ error: "payload too large" }, 413 as never);
    }

    try {
      const body = await c.req.json();
      const result = await service.handleTest(body);
      return c.json(result);
    } catch (error) {
      if (error instanceof Error && error.name === "ZodError") {
        return c.json({ error: "validation failed", details: (error as { issues?: unknown }).issues }, 400 as never);
      }
      return c.json({ error: error instanceof Error ? error.message : String(error) }, 500 as never);
    }
  });

  router.post("/apple-health/sync", async (c) => {
    if (!service.validateToken(c.req.header("authorization"))) {
      return c.json({ error: "unauthorized" }, 401 as never);
    }

    const contentLength = Number(c.req.header("content-length") ?? "0");
    if (contentLength > MAX_BODY_SIZE) {
      return c.json({ error: "payload too large" }, 413 as never);
    }

    try {
      const body = await c.req.json();
      const result = await service.handleSync(body);
      return c.json(result);
    } catch (error) {
      if (error instanceof Error && error.name === "ZodError") {
        return c.json({ error: "validation failed", details: (error as { issues?: unknown }).issues }, 400 as never);
      }
      return c.json({ error: error instanceof Error ? error.message : String(error) }, 500 as never);
    }
  });

  return router;
}
