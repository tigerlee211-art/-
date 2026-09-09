import { getDb } from "@/lib/db";
import { getSettings, updateSettings, resetSettings } from "@/lib/settings";
import { __internal } from "@/lib/pipeline";

resetSettings();
const db = getDb();

// ===== kill-switch =====
updateSettings({ killSwitch: true });
let reason = __internal.checkPublishGuard(getSettings());
if (!reason || !reason.includes("전체 중단")) throw new Error("kill-switch 가드 실패: " + reason);
console.log("✅ kill-switch 가드: blocked 확인");
updateSettings({ killSwitch: false });

// ===== 하루 발행 한도 =====
updateSettings({ dailyPublishLimit: 1 });
const jobId = db.prepare(`INSERT INTO jobs (keyword) VALUES ('guard-test')`).run().lastInsertRowid as number;
db.prepare(`INSERT INTO posts (job_id, status, published_at) VALUES (?, 'published', datetime('now'))`).run(jobId);
reason = __internal.checkPublishGuard(getSettings());
if (!reason || !reason.includes("한도")) throw new Error("일일 한도 가드 실패: " + reason);
console.log("✅ 하루 발행 한도 가드: blocked 확인");

// ===== 최소 발행 간격 =====
updateSettings({ dailyPublishLimit: 50, minPublishIntervalMin: 30 });
reason = __internal.checkPublishGuard(getSettings());
if (!reason || !reason.includes("분 지났습니다")) throw new Error("발행 간격 가드 실패: " + reason);
console.log("✅ 최소 발행 간격 가드: blocked 확인 (방금 발행했으므로)");

// 간격을 0으로 낮추면 통과해야 함
updateSettings({ minPublishIntervalMin: 0 });
reason = __internal.checkPublishGuard(getSettings());
if (reason) throw new Error("간격 0인데도 차단됨: " + reason);
console.log("✅ 간격 0으로 설정 시 통과 확인");

resetSettings();
console.log("✅ 안전장치 전부 원복(resetSettings)");
