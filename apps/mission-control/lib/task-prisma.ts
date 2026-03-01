import { PrismaClient } from "@prisma/client";

const globalForTaskPrisma: typeof globalThis & {
  taskPrisma?: PrismaClient;
  taskPrismaSourceUrl?: string;
} = globalThis;

const deriveCortanaUrl = () => {
  const explicit = process.env.CORTANA_DATABASE_URL?.trim();
  if (explicit) return explicit;

  const base = process.env.DATABASE_URL?.trim();
  if (!base) return null;

  try {
    const parsed = new URL(base);
    if (parsed.pathname === "/mission_control") {
      parsed.pathname = "/cortana";
      return parsed.toString();
    }
  } catch {
    return null;
  }

  return null;
};

export const getTaskPrisma = () => {
  const url = deriveCortanaUrl();
  if (!url || url === process.env.DATABASE_URL) return null;

  if (!globalForTaskPrisma.taskPrisma || globalForTaskPrisma.taskPrismaSourceUrl !== url) {
    globalForTaskPrisma.taskPrisma = new PrismaClient({
      datasources: { db: { url } },
      log: process.env.NODE_ENV === "development" ? ["warn", "error"] : ["error"],
    });
    globalForTaskPrisma.taskPrismaSourceUrl = url;
  }

  return globalForTaskPrisma.taskPrisma;
};
