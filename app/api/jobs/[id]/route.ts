import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const jobId = Number(id);
  const db = getDb();

  const job = db.prepare(`SELECT * FROM jobs WHERE id = ?`).get(jobId);
  if (!job) return NextResponse.json({ error: "잡을 찾을 수 없습니다." }, { status: 404 });

  const ideas = db.prepare(`SELECT * FROM ideas WHERE job_id = ? ORDER BY id`).all(jobId);
  const drafts = db.prepare(`SELECT * FROM drafts WHERE job_id = ? ORDER BY id`).all(jobId);
  const images = db.prepare(`SELECT * FROM images WHERE job_id = ? ORDER BY id`).all(jobId);
  const posts = db.prepare(`SELECT * FROM posts WHERE job_id = ? ORDER BY id`).all(jobId);
  const logs = db.prepare(`SELECT * FROM job_logs WHERE job_id = ? ORDER BY id`).all(jobId);

  return NextResponse.json({ job, ideas, drafts, images, posts, logs });
}
