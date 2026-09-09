import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { JobInputSchema } from "@/lib/types";
import { runJob } from "@/lib/pipeline";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const IN_PROGRESS_STATUSES = ["pending", "scraping", "writing", "imaging", "publishing"];

export async function GET() {
  const rows = getDb()
    .prepare(`SELECT id, keyword, status, stage, mode, error, created_at, updated_at FROM jobs ORDER BY id DESC LIMIT 30`)
    .all();
  return NextResponse.json({ jobs: rows });
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  const parsed = JobInputSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues.map((i) => i.message).join(" / ") }, { status: 400 });
  }
  const input = parsed.data;

  // ⚠️ 7-16: 잡 중복 생성 방지 — 진행 중 잡이 있으면 409로 거절한다.
  const placeholders = IN_PROGRESS_STATUSES.map(() => "?").join(",");
  const inProgress = getDb()
    .prepare(`SELECT id FROM jobs WHERE status IN (${placeholders}) LIMIT 1`)
    .get(...IN_PROGRESS_STATUSES);
  if (inProgress) {
    return NextResponse.json({ error: "이미 진행 중인 작업이 있습니다." }, { status: 409 });
  }

  const label = input.mode === "auto" ? input.keyword! : input.topic!;
  const jobId = getDb()
    .prepare(`INSERT INTO jobs (keyword, status, mode, inputs) VALUES (?, 'pending', ?, ?)`)
    .run(label, input.mode, JSON.stringify(input)).lastInsertRowid as number;

  // ⚠️ 6-10: runJob은 fire-and-forget이다. await하지 않고 즉시 응답한다.
  runJob(jobId).catch((err) => console.error(`[job ${jobId}]`, err));

  return NextResponse.json({ jobId }, { status: 201 });
}
