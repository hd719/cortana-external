declare module "@prisma/client" {
  type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };

  type JsonNullValue = { readonly $type: "JsonNull" };
  type DbNullValue = { readonly $type: "DbNull" };
  type AnyNullValue = { readonly $type: "AnyNull" };

  type PrismaPromise<T> = Promise<T>;

  type PrismaDelegate<T = any> = {
    findMany: (args?: unknown) => PrismaPromise<T[]>;
    findFirst: (args?: unknown) => PrismaPromise<T | null>;
    findUnique: (args?: unknown) => PrismaPromise<T | null>;
    findUniqueOrThrow: (args?: unknown) => PrismaPromise<T>;
    create: (args?: unknown) => PrismaPromise<T>;
    update: (args?: unknown) => PrismaPromise<T>;
    updateMany: (args?: unknown) => PrismaPromise<{ count: number }>;
    upsert: (args?: unknown) => PrismaPromise<T>;
    deleteMany: (args?: unknown) => PrismaPromise<{ count: number }>;
    count: (args?: unknown) => PrismaPromise<number>;
  };

  export const Prisma: {
    JsonNull: JsonNullValue;
    DbNull: DbNullValue;
    AnyNull: AnyNullValue;
  };

  export namespace Prisma {
    type JsonValue = JsonValue;
    type InputJsonValue = JsonValue;
    type JsonNullValue = JsonNullValue;
    type DbNullValue = DbNullValue;
    type AnyNullValue = AnyNullValue;
    type JsonNull = JsonNullValue;
  }

  export class PrismaClient {
    [key: string]: PrismaDelegate;
    $queryRawUnsafe: <T = any>(query: string, ...args: unknown[]) => PrismaPromise<T>;
    $executeRawUnsafe: <T = any>(query: string, ...args: unknown[]) => PrismaPromise<T>;
    $queryRaw: <T = any>(query: TemplateStringsArray | string, ...args: unknown[]) => PrismaPromise<T>;
    $transaction: <T>(
      input: PrismaPromise<unknown>[] | ((tx: PrismaClient) => PrismaPromise<T>)
    ) => PrismaPromise<T>;
    $disconnect: () => PrismaPromise<void>;
    constructor(options?: unknown);
  }

  export type AgentStatus = "active" | "idle" | "degraded" | "offline";
  export type RunStatus = "queued" | "running" | "completed" | "failed" | "cancelled";
  export type Severity = "info" | "warning" | "critical";

  export const AgentStatus: {
    active: AgentStatus;
    idle: AgentStatus;
    degraded: AgentStatus;
    offline: AgentStatus;
  };

  export const RunStatus: {
    queued: RunStatus;
    running: RunStatus;
    completed: RunStatus;
    failed: RunStatus;
    cancelled: RunStatus;
  };

  export const Severity: {
    info: Severity;
    warning: Severity;
    critical: Severity;
  };

  export type Run = {
    externalStatus: string | null;
    completedAt: Date | null;
    payload: Prisma.JsonValue | null;
    summary: string | null;
  };
}
