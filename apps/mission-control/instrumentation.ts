export async function register() {
  if (process.env.NEXT_RUNTIME && process.env.NEXT_RUNTIME !== "nodejs") {
    return;
  }

  const { startTaskListener } = await import("@/lib/task-listener");
  await startTaskListener();
}
