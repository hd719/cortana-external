import { startTaskListener } from "@/lib/task-listener";

export async function register() {
  if (process.env.NEXT_RUNTIME && process.env.NEXT_RUNTIME !== "nodejs") {
    return;
  }

  await startTaskListener();
}
