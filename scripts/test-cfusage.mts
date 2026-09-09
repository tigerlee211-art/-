process.env.TZ = "Asia/Seoul";

import { getDb } from "@/lib/db";
import { todayPublishedCount } from "@/lib/ai/cfUsage";

const db = getDb();

const now = new Date();
const kstDateStr = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Seoul" }).format(now); // YYYY-MM-DD

// ⚠️ 7-22 재현: 한국시간 오늘 새벽 2시 발행 → UTC로는 전날 17시로 저장된다.
function kstEarlyMorningAsUtcString(kstDate: string): string {
  const d = new Date(`${kstDate}T02:00:00+09:00`);
  return d.toISOString().slice(0, 19).replace("T", " ");
}
const publishedAtUtc = kstEarlyMorningAsUtcString(kstDateStr);

const jobId = db.prepare(`INSERT INTO jobs (keyword) VALUES ('utc-test-7-22')`).run().lastInsertRowid as number;
db.prepare(`INSERT INTO posts (job_id, status, published_at) VALUES (?, 'published', ?)`).run(jobId, publishedAtUtc);

const count = todayPublishedCount();
if (count < 1) {
  throw new Error(
    `7-22 회귀: published_at=${publishedAtUtc}(UTC) 이 KST 오늘(${kstDateStr}) 집계에서 누락됨 (count=${count})`,
  );
}
console.log(`✅ 7-22 확인: KST 새벽 2시 발행(UTC 저장값 "${publishedAtUtc}")이 로컬 날짜 기준 오늘 집계에 포함됨 (count=${count})`);

// 대조군: localtime 없이 그대로 비교하면 어떻게 되는지 보여준다 (틀린 버전 재현)
const naive = db
  .prepare(`SELECT (date(published_at) = date('now')) as same FROM posts WHERE id = last_insert_rowid()`)
  .get() as { same: number };
if (naive.same === 1 && kstDateStr !== new Intl.DateTimeFormat("en-CA", { timeZone: "UTC" }).format(now)) {
  console.log("   (참고: 이번 실행에서는 UTC 날짜와 KST 날짜가 우연히 같아 대조군 차이가 드러나지 않음)");
} else {
  console.log(`✅ 대조군: localtime 없이 비교(date(published_at)=date('now'))하면 same=${naive.same} — 로컬 변환 없이는 어긋남을 확인`);
}
