import { getDb } from "@/lib/db";

export type LogLevel = "info" | "warn" | "error";

export function jobLog(jobId: number, message: string, level: LogLevel = "info") {
  getDb()
    .prepare(`INSERT INTO job_logs (job_id, level, message) VALUES (?, ?, ?)`)
    .run(jobId, level, message);
}

export function setJobStage(jobId: number, patch: { status?: string; stage?: string; error?: string }) {
  const db = getDb();
  const fields: string[] = [];
  const values: unknown[] = [];
  for (const [k, v] of Object.entries(patch)) {
    fields.push(`${k} = ?`);
    values.push(v);
  }
  fields.push(`updated_at = datetime('now')`);
  db.prepare(`UPDATE jobs SET ${fields.join(", ")} WHERE id = ?`).run(...values, jobId);
}
