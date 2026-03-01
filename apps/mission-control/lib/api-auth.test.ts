import { afterEach, describe, expect, it } from "vitest";
import { requireApiAuth } from "@/lib/api-auth";

const originalToken = process.env.MISSION_CONTROL_API_TOKEN;

const resetEnv = () => {
  if (originalToken === undefined) {
    delete process.env.MISSION_CONTROL_API_TOKEN;
  } else {
    process.env.MISSION_CONTROL_API_TOKEN = originalToken;
  }
};

afterEach(() => {
  resetEnv();
});

const buildRequest = (headers?: Record<string, string>, method = "GET") =>
  new Request("http://localhost/api/test", {
    method,
    headers,
  });

describe("requireApiAuth", () => {
  it("allows access when no token is configured", () => {
    delete process.env.MISSION_CONTROL_API_TOKEN;
    const result = requireApiAuth(buildRequest());
    expect(result.ok).toBe(true);
  });

  it("rejects requests without credentials when token is configured", () => {
    process.env.MISSION_CONTROL_API_TOKEN = "secret";
    const result = requireApiAuth(buildRequest());
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.response.status).toBe(401);
    }
  });

  it("accepts bearer tokens", () => {
    process.env.MISSION_CONTROL_API_TOKEN = "secret";
    const result = requireApiAuth(buildRequest({ authorization: "Bearer secret" }));
    expect(result.ok).toBe(true);
  });

  it("accepts cookie tokens", () => {
    process.env.MISSION_CONTROL_API_TOKEN = "secret";
    const result = requireApiAuth(buildRequest({ cookie: "mc_api_token=secret" }));
    expect(result.ok).toBe(true);
  });

  it("accepts additional tokens when primary token is unset", () => {
    delete process.env.MISSION_CONTROL_API_TOKEN;
    const result = requireApiAuth(buildRequest({ authorization: "Bearer alt" }), {
      additionalTokens: ["alt"],
    });
    expect(result.ok).toBe(true);
  });

  it("rejects unsafe methods without same-origin when using cookies", () => {
    process.env.MISSION_CONTROL_API_TOKEN = "secret";
    const result = requireApiAuth(
      buildRequest({ cookie: "mc_api_token=secret", origin: "https://evil.test" }, "POST")
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.response.status).toBe(403);
    }
  });
});
