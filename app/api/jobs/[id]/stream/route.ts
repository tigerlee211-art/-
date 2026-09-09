import { getDb } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const DONE_STATUSES = new Set(["done", "failed", "canceled"]);
const POLL_MS = 1000;

type LogRow = { id: number; level: string; message: string; created_at: string };
type JobRow = { status: string };

// GET /api/jobs/[id]/stream — SSE. job_logs를 1초 폴링해 새 줄만 전송하고, 잡이 끝나면 end를 보낸다.
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const jobId = Number(id);
  const db = getDb();

  let lastId = 0;
  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    start(controller) {
      const send = (event: string, data: unknown) => {
        controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
      };

      const tick = () => {
        const rows = db
          .prepare(`SELECT id, level, message, created_at FROM job_logs WHERE job_id = ? AND id > ? ORDER BY id`)
          .all(jobId, lastId) as LogRow[];
        for (const row of rows) {
          send("log", row);
          lastId = row.id;
        }

        const job = db.prepare(`SELECT status FROM jobs WHERE id = ?`).get(jobId) as JobRow | undefined;
        if (!job) {
          send("end", { reason: "not_found" });
          clearInterval(timer);
          controller.close();
          return;
        }
        if (DONE_STATUSES.has(job.status)) {
          send("end", { status: job.status });
          clearInterval(timer);
          controller.close();
        }
      };

      tick();
      const timer = setInterval(tick, POLL_MS);

      req.signal.addEventListener("abort", () => {
        clearInterval(timer);
        try {
          controller.close();
        } catch {
          // 이미 닫혔으면 무시
        }
      });
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}
