import { NextResponse, type NextRequest } from "next/server";
import { getAuthCookieName, requireApiAuth } from "@/lib/api-auth";

const WEBHOOK_PATHS = new Set([
  "/api/openclaw/subagent-events",
  "/api/github/post-merge-task-autoclose",
  "/api/council/jobs/deliberate",
]);

const resolveWebhookTokens = (pathname: string) => {
  if (pathname === "/api/openclaw/subagent-events") {
    return [process.env.OPENCLAW_EVENT_TOKEN];
  }
  if (pathname === "/api/github/post-merge-task-autoclose") {
    return [process.env.GITHUB_MERGE_HOOK_TOKEN];
  }
  if (pathname === "/api/council/jobs/deliberate") {
    return [process.env.MISSION_CONTROL_CRON_TOKEN];
  }
  return [];
};

const shouldSetAuthCookie = (request: NextRequest) => {
  if (request.nextUrl.pathname.startsWith("/api")) return false;
  return Boolean(process.env.MISSION_CONTROL_API_TOKEN?.trim());
};

const isSecureRequest = (request: NextRequest) => {
  const forwardedProto = request.headers.get("x-forwarded-proto")?.toLowerCase();
  if (forwardedProto) return forwardedProto === "https";
  return request.nextUrl.protocol === "https:";
};

export function middleware(request: NextRequest) {
  const pathname = request.nextUrl.pathname;

  if (pathname.startsWith("/api")) {
    // NOTE: If MISSION_CONTROL_API_TOKEN is unset, API auth is intentionally disabled
    // (expected to be protected by network ACLs like Tailscale or a reverse proxy).
    const additionalTokens = resolveWebhookTokens(pathname);
    const auth = requireApiAuth(request, { additionalTokens });
    if (!auth.ok) {
      return auth.response;
    }

    return NextResponse.next();
  }

  if (!shouldSetAuthCookie(request)) {
    return NextResponse.next();
  }

  const token = process.env.MISSION_CONTROL_API_TOKEN?.trim();
  const cookieName = getAuthCookieName();

  if (!token) {
    return NextResponse.next();
  }

  const current = request.cookies.get(cookieName)?.value;
  if (current === token) {
    return NextResponse.next();
  }

  const response = NextResponse.next();
  response.cookies.set(cookieName, token, {
    httpOnly: true,
    sameSite: "strict",
    secure: isSecureRequest(request),
    path: "/",
  });
  return response;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
