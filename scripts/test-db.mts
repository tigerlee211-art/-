import { getDb } from "@/lib/db";
import { getSettings, updateSettings, resetSettings } from "@/lib/settings";

const db = getDb();
const tables = db
  .prepare(`SELECT name FROM sqlite_master WHERE type='table'`)
  .all()
  .map((r: any) => r.name)
  .sort();
const expected = ["drafts", "ideas", "images", "job_logs", "jobs", "posts", "settings", "sources"].sort();
for (const t of expected) {
  if (!tables.includes(t)) throw new Error(`테이블 누락: ${t}`);
}
console.log("✅ 테이블 전부 존재:", tables.join(", "));

const s0 = getSettings();
if (s0.visibility !== "private") throw new Error("visibility 기본값은 private 이어야 함");
if (s0.dryRun !== true) throw new Error("dryRun 기본값은 true 여야 함");
console.log("✅ 기본 설정값 확인 (visibility=private, dryRun=true)");

// 클램프 테스트: 범위를 벗어난 값을 넣으면 서버가 잘라내야 한다
updateSettings({ dailyPublishLimit: 9999 });
const s1 = getSettings();
if (s1.dailyPublishLimit !== 50) throw new Error(`클램프 실패: ${s1.dailyPublishLimit}`);
console.log("✅ 범위 클램프 확인 (9999 → 50)");

updateSettings({ imageCandidates: -5 });
const s2 = getSettings();
if (s2.imageCandidates !== 3) throw new Error(`클램프 실패(하한): ${s2.imageCandidates}`);
console.log("✅ 범위 클램프 확인(하한) (-5 → 3)");

let threw = false;
try {
  updateSettings({ visibility: "invalid" as any });
} catch {
  threw = true;
}
if (!threw) throw new Error("잘못된 visibility 값이 거부되지 않음");
console.log("✅ 잘못된 visibility 값 거부 확인");

resetSettings();
const s3 = getSettings();
if (s3.dailyPublishLimit !== 3) throw new Error("resetSettings 후 기본값 복원 실패");
console.log("✅ resetSettings 후 기본값 복원 확인");
