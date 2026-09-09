import fs from "node:fs";
import path from "node:path";

// data 디렉토리 전부 여기서 관리한다. 앱은 완전 로컬이어야 한다 (2-2).
export const DATA_ROOT = path.resolve(process.cwd(), "data");

function ensureDir(p: string) {
  fs.mkdirSync(p, { recursive: true });
  return p;
}

export const DIRS = {
  root: DATA_ROOT,
  db: ensureDir(DATA_ROOT),
  session: ensureDir(path.join(DATA_ROOT, "session")),
  images: ensureDir(path.join(DATA_ROOT, "images")),
  screenshots: ensureDir(path.join(DATA_ROOT, "screenshots")),
};

export const DB_PATH = path.join(DIRS.db, "app.db");
export const SESSION_STATE_PATH = path.join(DIRS.session, "storageState.json");

export function expandHome(p: string): string {
  if (p === "~") return process.env.HOME ?? p;
  if (p.startsWith("~/")) return path.join(process.env.HOME ?? "", p.slice(2));
  return p;
}

// ⚠️ 7-23: macOS의 process.cwd()/파일시스템 경로는 한글을 NFD(자모 분해)로 주는데
// 브라우저가 보내는 URL 파라미터는 NFC(완성형)다. 비교 전에 반드시 양쪽 다 정규화하라.
export function normalizeForCompare(p: string): string {
  const n = path.resolve(p).normalize("NFC");
  return process.platform === "win32" ? n.toLowerCase() : n;
}

// data 디렉토리 내부인지 검사 (경로 탈출 방지). resolve 후 접두사 검사 + NFC 정규화.
export function isInsideData(absPath: string): boolean {
  const target = normalizeForCompare(absPath);
  const root = normalizeForCompare(DATA_ROOT);
  return target === root || target.startsWith(root + path.sep);
}
