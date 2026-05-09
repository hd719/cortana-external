import { Hono } from "hono";
import { jsonErrorResponse } from "../lib/cached-connector.js";
import { WhoopService } from "./service.js";
import { createWhoopWebhookRouter, type WhoopWebhookRouteOptions } from "./webhook-routes.js";

const STALE_WARNING = '110 - "Serving stale Whoop cache after token refresh failure"';

export function createWhoopRouter(service: WhoopService, webhookOptions?: WhoopWebhookRouteOptions): Hono {
  const router = new Hono();

  router.get("/auth/url", (c) => c.json({ url: service.getAuthUrl() }));

  router.get("/auth/callback", async (c) => {
    const error = c.req.query("error");
    if (error) {
      return c.json(
        {
          error,
          description: c.req.query("error_description") ?? "",
        },
        400 as never,
      );
    }

    const code = c.req.query("code");
    if (!code) {
      return c.json({ error: "missing code parameter" }, 400 as never);
    }

    try {
      await service.exchangeCode(code);
      return c.json({ status: "ok", message: "tokens saved successfully" });
    } catch {
      return c.json({ error: "token exchange failed" }, 502 as never);
    }
  });

  router.get("/auth/status", async (c) => c.json(await service.getAuthStatus()));

  router.get("/whoop/health", async (c) => {
    const result = await service.getHealth();
    return c.json(result.body, result.status as never);
  });

  router.get("/whoop/data", async (c) => {
    const forceFresh = c.req.query("fresh") === "true";
    try {
      const { data, servedStale } = await service.getWhoopData(forceFresh);
      if (servedStale) {
        c.header("Warning", STALE_WARNING);
      }
      return c.json(data);
    } catch (error) {
      return jsonErrorResponse(error);
    }
  });

  router.get("/whoop/recovery", async (c) => {
    const forceFresh = c.req.query("fresh") === "true";
    try {
      const { data, servedStale } = await service.getWhoopData(forceFresh);
      if (servedStale) {
        c.header("Warning", STALE_WARNING);
      }
      return c.json({ recovery: data.recovery });
    } catch (error) {
      return jsonErrorResponse(error);
    }
  });

  router.get("/whoop/recovery/latest", async (c) => {
    const forceFresh = c.req.query("fresh") === "true";
    try {
      const { data, servedStale } = await service.getWhoopData(forceFresh);
      if (servedStale) {
        c.header("Warning", STALE_WARNING);
      }
      if (data.recovery.length === 0) {
        return c.json({ error: "no recovery data available" }, 404 as never);
      }
      return c.json(data.recovery[0]);
    } catch (error) {
      return jsonErrorResponse(error);
    }
  });

  if (webhookOptions) {
    router.route("/", createWhoopWebhookRouter(webhookOptions));
  }

  return router;
}
