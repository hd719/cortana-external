import { NextResponse } from "next/server";

const AUTH_COOKIE_NAME = "mc_api_token";

const normalizeToken = (value?: string | null) => {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
};

const safeEqual = (left: string, right: string) => {
  if (left.length !== right.length) return false;
  let result = 0;
  for (let i = 0; i < left.length; i += 1) {
    result |= left.charCodeAt(i) ^ right.charCodeAt(i);
  }
  return result === 0;
};

const parseCookieHeader = (cookieHeader: string | null) => {
  const map = new Map<string, string>();
  if (!cookieHeader) return map;

  cookieHeader.split(";").forEach((pair: any) => {
    const [rawKey, ...rest] = pair.trim().split("=");
    if (!rawKey) return;
    const key = rawKey.trim();
    const value = rest.join("=").trim();
    if (key) map.set(key, decodeURIComponent(value));
  });

  return map;
};

type TokenSource = "authorization" | "api-key" | "cookie";

const extractToken = (request: Request): { token: string; source: TokenSource } | null => {
  const authHeader = normalizeToken(request.headers.get("authorization"));
  if (authHeader?.toLowerCase().startsWith("bearer ")) {
    const token = normalizeToken(authHeader.slice(7));
    if (token) return { token, source: "authorization" };
  }

  const apiKey = normalizeToken(request.headers.get("x-api-key"));
  if (apiKey) return { token: apiKey, source: "api-key" };

  const cookieHeader = request.headers.get("cookie");
  const cookies = parseCookieHeader(cookieHeader);
  const cookieToken = normalizeToken(cookies.get(AUTH_COOKIE_NAME) ?? null);
  if (cookieToken) return { token: cookieToken, source: "cookie" };

  return null;
};

const resolveExpectedTokens = (additionalTokens?: Array<string | null | undefined>) => {
  const tokens = [normalizeToken(process.env.MISSION_CONTROL_API_TOKEN), ...(additionalTokens ?? [])];
  return tokens.map((token: any) => normalizeToken(token)).filter((token): token is string => Boolean(token));
};

const isSafeMethod = (method: string) =>
  method === "GET" || method === "HEAD" || method === "OPTIONS";

const isSameOrigin = (request: Request) => {
  const originHeader = normalizeToken(request.headers.get("origin"));
  const refererHeader = normalizeToken(request.headers.get("referer"));
  const hostHeader = normalizeToken(request.headers.get("host"));
  const expectedOrigin = normalizeToken(process.env.MISSION_CONTROL_URL);

  const originValue = originHeader ?? refererHeader;
  if (!originValue || !hostHeader) return false;

  try {
    const origin = new URL(originValue);
    if (origin.host === hostHeader) return true;
    if (expectedOrigin) {
      const expected = new URL(expectedOrigin);
      return expected.host === origin.host;
    }
  } catch {
    return false;
  }

  return false;
};

type AuthResult =
  | { ok: true; tokenConfigured: boolean }
  | { ok: false; response: NextResponse };

export const requireApiAuth = (
  request: Request,
  options?: { additionalTokens?: Array<string | null | undefined> },
): AuthResult => {
  const expectedTokens = resolveExpectedTokens(options?.additionalTokens);

  if (expectedTokens.length === 0) {
    return { ok: true, tokenConfigured: false };
  }

  const provided = extractToken(request);
  if (!provided) {
    return {
      ok: false,
      response: NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
    };
  }

  const matches = expectedTokens.some((expected: any) => safeEqual(provided.token, expected));
  if (!matches) {
    return {
      ok: false,
      response: NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
    };
  }

  if (!isSafeMethod(request.method) && provided.source === "cookie") {
    if (!isSameOrigin(request)) {
      return {
        ok: false,
        response: NextResponse.json({ error: "Forbidden" }, { status: 403 }),
      };
    }
  }

  return { ok: true, tokenConfigured: true };
};

export const getAuthCookieName = () => AUTH_COOKIE_NAME;
