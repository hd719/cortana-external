import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { Hono } from "hono";
import { afterEach, describe, expect, it } from "vitest";

import { registerTonalRoutes } from "../tonal/index.js";
import { TonalService } from "../tonal/service.js";

async function makeTempDir(): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), "external-tonal-test-"));
}

async function writeJson(filePath: string, data: unknown): Promise<void> {
  await fs.writeFile(filePath, `${JSON.stringify(data, null, 2)}\n`, "utf-8");
}

describe("tonal service routes", () => {
  const dirs: string[] = [];

  afterEach(async () => {
    await Promise.all(
      dirs.map(async (dir) => {
        await fs.rm(dir, { recursive: true, force: true });
      }),
    );
    dirs.length = 0;
  });

  it("returns healthy on /tonal/health with refresh-token auth path", async () => {
    const dir = await makeTempDir();
    dirs.push(dir);
    const tokenPath = path.join(dir, "tonal_tokens.json");
    const dataPath = path.join(dir, "tonal_data.json");

    await writeJson(tokenPath, {
      id_token: "old-token",
      refresh_token: "refresh-token",
      expires_at: new Date(Date.now() - 60_000).toISOString(),
    });

    const fetchImpl: typeof fetch = async (input, init) => {
      const url = String(input);
      if (url.includes("/oauth/token")) {
        return new Response(JSON.stringify({ id_token: fakeJwt(3600), refresh_token: "new-refresh", expires_in: 3600 }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      if (url.includes("/v6/users/userinfo")) {
        return new Response(JSON.stringify({ id: "user-1" }), { status: 200 });
      }
      return new Response("not found", { status: 404 });
    };

    const service = new TonalService({
      email: "user@example.com",
      password: "pass",
      tokenPath,
      dataPath,
      requestDelayMs: 0,
      fetchImpl,
    });

    const app = new Hono();
    registerTonalRoutes(app, service);
    const response = await app.request("/tonal/health");
    const body = (await response.json()) as { status: string; user_id?: string };

    expect(response.status).toBe(200);
    expect(body.status).toBe("healthy");
    expect(body.user_id).toBe("user-1");
  });

  it("coerces numeric workout ids to string keys on /tonal/data", async () => {
    const dir = await makeTempDir();
    dirs.push(dir);
    const tokenPath = path.join(dir, "tonal_tokens.json");
    const dataPath = path.join(dir, "tonal_data.json");

    await writeJson(tokenPath, {
      id_token: fakeJwt(3600),
      refresh_token: "refresh-token",
      expires_at: new Date(Date.now() + 2 * 60 * 60_000).toISOString(),
    });
    await writeJson(dataPath, {
      user_id: "user-1",
      profile: {},
      workouts: {},
      strength_scores: null,
      last_updated: new Date().toISOString(),
    });

    const fetchImpl: typeof fetch = async (input) => {
      const url = String(input);
      if (url.includes("/v6/users/userinfo")) return json({ id: "user-1" });
      if (url.includes("/v6/users/user-1/profile")) return json({ totalWorkouts: 1 });
      if (url.includes("/v6/users/user-1/workout-activities")) return json([{ id: 123, name: "lift" }]);
      if (url.includes("/strength-scores/current")) return json([]);
      if (url.includes("/strength-scores/history")) return json([]);
      return new Response("not found", { status: 404 });
    };

    const service = new TonalService({
      email: "",
      password: "",
      tokenPath,
      dataPath,
      requestDelayMs: 0,
      fetchImpl,
    });
    const app = new Hono();
    registerTonalRoutes(app, service);

    const response = await app.request("/tonal/data");
    const body = (await response.json()) as { workouts: Record<string, unknown>; workout_count: number };

    expect(response.status).toBe(200);
    expect(body.workout_count).toBe(1);
    expect(Object.keys(body.workouts)).toEqual(["123"]);
  });

  it("self-heals after unauthorized and retries once", async () => {
    const dir = await makeTempDir();
    dirs.push(dir);
    const tokenPath = path.join(dir, "tonal_tokens.json");
    const dataPath = path.join(dir, "tonal_data.json");

    await writeJson(tokenPath, {
      id_token: fakeJwt(3600),
      refresh_token: "refresh-token",
      expires_at: new Date(Date.now() + 2 * 60 * 60_000).toISOString(),
    });
    await writeJson(dataPath, {
      user_id: "",
      profile: {},
      workouts: {},
      strength_scores: null,
      last_updated: new Date().toISOString(),
    });

    let userInfoCalls = 0;
    const fetchImpl: typeof fetch = async (input) => {
      const url = String(input);
      if (url.includes("/oauth/token")) return json({ id_token: fakeJwt(3600), refresh_token: "new-refresh", expires_in: 3600 });
      if (url.includes("/v6/users/userinfo")) {
        userInfoCalls += 1;
        if (userInfoCalls === 1) {
          return new Response(JSON.stringify({ error: "unauthorized" }), { status: 401 });
        }
        return json({ id: "user-1" });
      }
      if (url.includes("/v6/users/user-1/profile")) return json({ totalWorkouts: 0 });
      if (url.includes("/v6/users/user-1/workout-activities")) return json([]);
      if (url.includes("/strength-scores/current")) return json([]);
      if (url.includes("/strength-scores/history")) return json([]);
      return new Response("not found", { status: 404 });
    };

    const service = new TonalService({
      email: "user@example.com",
      password: "pass",
      tokenPath,
      dataPath,
      requestDelayMs: 0,
      fetchImpl,
    });
    const app = new Hono();
    registerTonalRoutes(app, service);

    const response = await app.request("/tonal/data");
    expect(response.status).toBe(200);
    expect(userInfoCalls).toBe(2);
  });
});

function fakeJwt(expiresInSeconds: number): string {
  const header = base64Url(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const payload = base64Url(JSON.stringify({ exp: Math.floor(Date.now() / 1000) + expiresInSeconds }));
  return `${header}.${payload}.signature`;
}

function base64Url(value: string): string {
  return Buffer.from(value, "utf-8").toString("base64url");
}

function json(value: unknown): Response {
  return new Response(JSON.stringify(value), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}
