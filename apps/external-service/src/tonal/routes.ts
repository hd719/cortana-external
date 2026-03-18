import type { Hono } from "hono";

import type { TonalService } from "./service.js";

export function registerTonalRoutes(app: Hono, service: TonalService): void {
  app.get("/tonal/health", async (c) => {
    const result = await service.handleHealth(c.req.raw);
    return c.json(result.body, result.status as never);
  });

  app.get("/tonal/data", async (c) => {
    const forceFresh = c.req.query("fresh") === "true";
    const result = await service.handleData(c.req.raw, forceFresh);
    return c.json(result.body, result.status as never);
  });
}
