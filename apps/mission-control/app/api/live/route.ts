export const dynamic = "force-dynamic";
export const revalidate = 0;

const encoder = new TextEncoder();

export async function GET(request: Request) {
  let interval: ReturnType<typeof setInterval> | null = null;
  let keepAlive: ReturnType<typeof setInterval> | null = null;

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const send = (event: string, data: unknown) => {
        controller.enqueue(encoder.encode(`event: ${event}\n`));
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
      };

      send("ready", { ts: Date.now() });

      interval = setInterval(() => send("tick", { ts: Date.now() }), 2000);
      keepAlive = setInterval(() => {
        controller.enqueue(encoder.encode(`: keepalive ${Date.now()}\n\n`));
      }, 15000);

      request.signal.addEventListener("abort", () => {
        if (interval) clearInterval(interval);
        if (keepAlive) clearInterval(keepAlive);
        controller.close();
      });
    },
    cancel() {
      if (interval) clearInterval(interval);
      if (keepAlive) clearInterval(keepAlive);
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-store, no-cache, must-revalidate, proxy-revalidate",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
