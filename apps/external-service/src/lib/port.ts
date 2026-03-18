import net from "node:net";
import { execSync } from "node:child_process";

export async function ensurePortAvailable(port: number): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const server = net.createServer();

    server.once("error", (error) => {
      server.close();
      reject(error);
    });

    server.listen({ host: "127.0.0.1", port }, () => {
      server.close(() => resolve());
    });
  }).catch((error: unknown) => {
    const code = typeof error === "object" && error && "code" in error ? String((error as { code: unknown }).code) : "";
    if (code !== "EADDRINUSE") {
      throw error;
    }

    try {
      const owner = execSync(`lsof -nP -iTCP:${port} -sTCP:LISTEN`, { encoding: "utf-8" }).trim();
      throw new Error(`port ${port} is already in use. Conflicting process:\n${owner || "(no process details returned by lsof)"}`);
    } catch (inspectError) {
      if (inspectError instanceof Error && inspectError.message.startsWith("port ")) {
        throw inspectError;
      }

      throw new Error(`port ${port} is already in use (could not inspect owner)`);
    }
  });
}
