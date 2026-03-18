import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { Hono } from "hono";
import { describe, expect, it } from "vitest";

import { createWhoopRouter } from "../whoop/routes.js";
import { WhoopService } from "../whoop/service.js";

function createTempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "whoop-routes-"));
}

describe("whoop routes", () => {
  it("returns auth url", async () => {
    const app = new Hono();
    const service = new WhoopService({
      clientId: "abc",
      clientSecret: "secret",
      redirectUrl: "http://localhost:3033/auth/callback",
      tokenPath: path.join(createTempDir(), "tokens.json"),
      dataPath: path.join(createTempDir(), "whoop.json"),
      fetchImpl: globalThis.fetch,
    });
    app.route("/", createWhoopRouter(service));

    const response = await app.request("/auth/url");
    expect(response.status).toBe(200);
    const payload = (await response.json()) as { url: string };
    expect(payload.url).toContain("client_id=abc");
  });

  it("serves stale data with warning when token refresh fails", async () => {
    const temp = createTempDir();
    const tokenPath = path.join(temp, "tokens.json");
    const dataPath = path.join(temp, "whoop.json");
    fs.writeFileSync(
      tokenPath,
      JSON.stringify({
        access_token: "expired",
        refresh_token: "",
        expires_at: "2020-01-01T00:00:00.000Z",
      }),
    );
    fs.writeFileSync(
      dataPath,
      JSON.stringify({
        profile: { name: "cached" },
        body_measurement: {},
        cycles: [],
        recovery: [{ score: 90 }],
        sleep: [],
        workouts: [],
      }),
    );

    const app = new Hono();
    const service = new WhoopService({
      clientId: "abc",
      clientSecret: "secret",
      redirectUrl: "http://localhost:3033/auth/callback",
      tokenPath,
      dataPath,
      fetchImpl: globalThis.fetch,
    });
    app.route("/", createWhoopRouter(service));

    const response = await app.request("/whoop/data");
    expect(response.status).toBe(200);
    expect(response.headers.get("Warning")).toBe('110 - "Serving stale Whoop cache after token refresh failure"');
    const payload = (await response.json()) as { profile: { name: string } };
    expect(payload.profile.name).toBe("cached");
  });

  it("returns 404 for latest recovery when empty", async () => {
    const temp = createTempDir();
    const tokenPath = path.join(temp, "tokens.json");
    fs.writeFileSync(
      tokenPath,
      JSON.stringify({
        access_token: "valid",
        refresh_token: "refresh",
        expires_at: "2999-01-01T00:00:00.000Z",
      }),
    );

    const fetchImpl: typeof fetch = async (input) => {
      const url = String(input);
      if (url.includes("/v2/user/profile/basic")) return new Response(JSON.stringify({}), { status: 200 });
      if (url.includes("/v2/user/measurement/body")) return new Response(JSON.stringify({}), { status: 200 });
      if (url.includes("/v2/cycle")) return new Response(JSON.stringify({ records: [], next_token: "" }), { status: 200 });
      if (url.includes("/v2/recovery")) return new Response(JSON.stringify({ records: [], next_token: "" }), { status: 200 });
      if (url.includes("/v2/activity/sleep")) return new Response(JSON.stringify({ records: [], next_token: "" }), { status: 200 });
      if (url.includes("/v2/activity/workout")) return new Response(JSON.stringify({ records: [], next_token: "" }), { status: 200 });
      return new Response("not found", { status: 404 });
    };

    const app = new Hono();
    const service = new WhoopService({
      clientId: "abc",
      clientSecret: "secret",
      redirectUrl: "http://localhost:3033/auth/callback",
      tokenPath,
      dataPath: path.join(temp, "whoop.json"),
      fetchImpl,
    });
    app.route("/", createWhoopRouter(service));

    const response = await app.request("/whoop/recovery/latest");
    expect(response.status).toBe(404);
  });

  it("deduplicates concurrent refresh calls", async () => {
    const temp = createTempDir();
    const tokenPath = path.join(temp, "tokens.json");
    fs.writeFileSync(
      tokenPath,
      JSON.stringify({
        access_token: "expired",
        refresh_token: "refresh",
        expires_at: "2020-01-01T00:00:00.000Z",
      }),
    );

    let refreshCalls = 0;
    const fetchImpl: typeof fetch = async (input, init) => {
      const url = String(input);
      if (url.includes("/oauth/oauth2/token") && init?.method === "POST") {
        refreshCalls += 1;
        await new Promise((resolve) => setTimeout(resolve, 25));
        return new Response(
          JSON.stringify({
            access_token: "new-access",
            refresh_token: "new-refresh",
            expires_in: 3600,
          }),
          { status: 200 },
        );
      }
      if (url.includes("/v2/user/profile/basic")) return new Response(JSON.stringify({}), { status: 200 });
      if (url.includes("/v2/user/measurement/body")) return new Response(JSON.stringify({}), { status: 200 });
      if (url.includes("/v2/cycle")) return new Response(JSON.stringify({ records: [], next_token: "" }), { status: 200 });
      if (url.includes("/v2/recovery")) return new Response(JSON.stringify({ records: [], next_token: "" }), { status: 200 });
      if (url.includes("/v2/activity/sleep")) return new Response(JSON.stringify({ records: [], next_token: "" }), { status: 200 });
      if (url.includes("/v2/activity/workout")) return new Response(JSON.stringify({ records: [], next_token: "" }), { status: 200 });
      return new Response("not found", { status: 404 });
    };

    const service = new WhoopService({
      clientId: "abc",
      clientSecret: "secret",
      redirectUrl: "http://localhost:3033/auth/callback",
      tokenPath,
      dataPath: path.join(temp, "whoop.json"),
      fetchImpl,
    });

    await Promise.all([service.getWhoopData(true), service.getWhoopData(true), service.getWhoopData(true)]);
    expect(refreshCalls).toBe(1);
  });
});
