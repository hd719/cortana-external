import { PrismaClient } from "@prisma/client";

const globalForTaskPrisma: typeof globalThis & {
  cortanaPrisma?: PrismaClient;
  cortanaPrismaSourceUrl?: string;
} = globalThis;

export const isPrimaryDatabaseCortana = () => {
  const base = process.env.DATABASE_URL?.trim();
  if (!base) return false;

  try {
    const parsed = new URL(base);
    return parsed.pathname === "/cortana";
  } catch {
    return false;
  }
};

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

export const getCortanaPrisma = () => {
  const url = deriveCortanaUrl();
  if (!url || url === process.env.DATABASE_URL) return null;

  if (!globalForTaskPrisma.cortanaPrisma || globalForTaskPrisma.cortanaPrismaSourceUrl !== url) {
    globalForTaskPrisma.cortanaPrisma = new PrismaClient({
      datasources: { db: { url } },
      log: process.env.NODE_ENV === "development" ? ["warn", "error"] : ["error"],
    });
    globalForTaskPrisma.cortanaPrismaSourceUrl = url;
  }

  return globalForTaskPrisma.cortanaPrisma;
};
