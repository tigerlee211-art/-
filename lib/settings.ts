import { getDb } from "@/lib/db";
import { DEFAULT_SETTINGS, SETTING_LIMITS, VISIBILITY_VALUES, type Settings, envOverride } from "@/config";

type LimitKey = keyof typeof SETTING_LIMITS;

// 범위를 벗어난 값은 저장 시 서버가 잘라낸다(클램프). UI에서 막지 않고 여기서 보정한다.
function clamp(key: string, value: number): number {
  const limit = SETTING_LIMITS[key as LimitKey];
  if (!limit) return value;
  return Math.min(limit.max, Math.max(limit.min, value));
}

function readAll(): Record<string, string> {
  const rows = getDb().prepare(`SELECT key, value FROM settings`).all() as { key: string; value: string }[];
  const out: Record<string, string> = {};
  for (const r of rows) out[r.key] = r.value;
  return out;
}

export function getSettings(): Settings {
  const stored = readAll();
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(DEFAULT_SETTINGS) as (keyof Settings)[]) {
    const fallback = envOverride(key, DEFAULT_SETTINGS[key]);
    if (Object.prototype.hasOwnProperty.call(stored, key)) {
      out[key] = JSON.parse(stored[key]!);
    } else {
      out[key] = fallback;
    }
  }
  return out as Settings;
}

export function updateSettings(patch: Partial<Settings>): Settings {
  const db = getDb();
  const upsert = db.prepare(
    `INSERT INTO settings (key, value) VALUES (?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
  );
  const tx = db.transaction((entries: [string, unknown][]) => {
    for (const [key, rawValue] of entries) {
      if (!(key in DEFAULT_SETTINGS)) {
        throw new Error(`알 수 없는 설정 키: ${key}`);
      }
      let value = rawValue;
      if (key === "visibility") {
        if (!VISIBILITY_VALUES.includes(value as (typeof VISIBILITY_VALUES)[number])) {
          throw new Error(`잘못된 공개 범위 값: ${String(value)}`);
        }
      } else if (typeof value === "number") {
        value = clamp(key, value);
      }
      upsert.run(key, JSON.stringify(value));
    }
  });
  tx(Object.entries(patch));
  return getSettings();
}

export function resetSettings(): Settings {
  getDb().exec(`DELETE FROM settings`);
  return getSettings();
}

export { SETTING_LIMITS as LIMITS };
