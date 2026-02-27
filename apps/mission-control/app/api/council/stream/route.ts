import { getCouncilSessionById, getCouncilSessions } from "@/lib/council";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const encoder = new TextEncoder();

const encode = (event: string, data: unknown) =>
  encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const sessionId = searchParams.get("sessionId");

  let interval: ReturnType<typeof setInterval> | null = null;
  let keepAlive: ReturnType<typeof setInterval> | null = null;
  let lastPayload = "";

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const emitSnapshot = async () => {
        const data = sessionId
          ? await getCouncilSessionById(sessionId)
          : await getCouncilSessions({ rangeHours: 24 * 7, limit: 120 });

        const payload = JSON.stringify(data ?? null);
        if (payload === lastPayload) return;
        lastPayload = payload;

        controller.enqueue(encode("update", {
          ts: Date.now(),
          sessionId,
          data,
        }));
      };

      controller.enqueue(encode("ready", { ts: Date.now(), sessionId }));
      await emitSnapshot();

      interval = setInterval(async () => {
        try {
          await emitSnapshot();
        } catch {
          controller.enqueue(encode("error", { ts: Date.now(), sessionId }));
        }
      }, 2000);

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
