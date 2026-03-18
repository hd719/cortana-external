import { Context } from "hono";

export function jsonError(context: Context, status: number, error: string, extras?: Record<string, unknown>): Response {
  return context.json({ error, ...extras }, status as never);
}
