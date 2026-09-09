// 전역 기본값. 이후엔 DB(settings 테이블)가 우선한다 — lib/settings.ts 참고.
export const DEFAULT_SETTINGS = {
  dryRun: true,
  killSwitch: false,
  visibility: "private" as "public" | "neighbor" | "both" | "private",
  dailyPublishLimit: 3,
  minPublishIntervalMin: 30,
  scrapeTopN: 8,
  imageCandidates: 10,
  cfImageSteps: 6,
  showBrowser: false,
  claudeTimeoutSec: 180,
  claudeConcurrency: 2,
};

export type Settings = typeof DEFAULT_SETTINGS;

export const SETTING_LIMITS = {
  dailyPublishLimit: { min: 1, max: 50 },
  minPublishIntervalMin: { min: 0, max: 720 },
  scrapeTopN: { min: 3, max: 30 },
  imageCandidates: { min: 3, max: 20 },
  cfImageSteps: { min: 1, max: 8 },
  claudeTimeoutSec: { min: 30, max: 900 },
  claudeConcurrency: { min: 1, max: 6 },
} as const;

export const VISIBILITY_VALUES = ["public", "neighbor", "both", "private"] as const;

export const PORT = 4123;

export function envOverride(key: keyof Settings, fallback: unknown) {
  const envKey = "NBA_" + key.replace(/([A-Z])/g, "_$1").toUpperCase();
  const raw = process.env[envKey];
  if (raw === undefined) return fallback;
  if (typeof fallback === "boolean") return raw === "true" || raw === "1";
  if (typeof fallback === "number") {
    const n = Number(raw);
    return Number.isFinite(n) ? n : fallback;
  }
  return raw;
}
