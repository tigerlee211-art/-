import fs from "node:fs";
import { newContext } from "@/lib/playwright";
import { SESSION_STATE_PATH } from "@/lib/paths";

export type SessionStatus =
  | { valid: true; blogId: string }
  | { valid: false; reason: "no_session" | "expired" | "write_expired"; blogId?: string };

// ===== 2-4: 네이버 로그인은 자동화하지 않는다 =====
// 보안문자·2차인증 때문에 창을 띄워 사용자가 직접 로그인하게 하고, NID_SES 쿠키가 생기면
// storageState를 저장해 재사용한다.

let loginInFlight = false;

export function isLoginInFlight() {
  return loginInFlight;
}

export async function loginInteractive(opts?: {
  onStatus?: (msg: string) => void;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  if (loginInFlight) {
    return { ok: false, error: "이미 로그인 창이 열려 있습니다." };
  }
  loginInFlight = true;
  const notify = opts?.onStatus ?? (() => {});
  try {
    const { browser, context } = await newContext({ headless: false, useNaverSession: false });
    const page = await context.newPage();
    try {
      await page.goto("https://nid.naver.com/nidlogin.login", { waitUntil: "domcontentloaded" });
      notify("로그인 창이 열렸습니다. 로그인해 주세요.");

      const deadline = Date.now() + 5 * 60 * 1000; // 최대 5분 대기
      let sessionCookieFound = false;
      while (Date.now() < deadline) {
        if (page.isClosed()) {
          return { ok: false, error: "사용자가 로그인 창을 닫았습니다." };
        }
        const cookies = await context.cookies();
        if (cookies.some((c) => c.name === "NID_SES")) {
          sessionCookieFound = true;
          break;
        }
        await new Promise((r) => setTimeout(r, 1000)); // 1초 간격 폴링
      }

      if (!sessionCookieFound) {
        return { ok: false, error: "5분 안에 로그인이 완료되지 않았습니다." };
      }

      // 쿠키 안정화를 위해 naver.com으로 한 번 이동한 뒤 저장
      await page.goto("https://www.naver.com", { waitUntil: "domcontentloaded" });
      await context.storageState({ path: SESSION_STATE_PATH });
      invalidateSessionCache();
      notify("로그인 정보가 저장됐습니다.");
      return { ok: true };
    } finally {
      await context.close();
      await browser.close();
    }
  } finally {
    loginInFlight = false;
  }
}

// ===== 세션 검증 (⚠️ 7-9, 7-10) =====
// 캐시: 검증은 브라우저를 띄우므로 비용이 크다. TTL 5분 캐시를 두고, 로그인 직후엔
// invalidateSessionCache()로 무효화한다.

let cache: { result: SessionStatus; expiresAt: number } | null = null;
const CACHE_TTL_MS = 5 * 60 * 1000;

export function invalidateSessionCache() {
  cache = null;
}

export async function verifySession(force = false): Promise<SessionStatus> {
  if (!force && cache && cache.expiresAt > Date.now()) {
    return cache.result;
  }
  const result = await verifySessionUncached();
  cache = { result, expiresAt: Date.now() + CACHE_TTL_MS };
  return result;
}

async function verifySessionUncached(): Promise<SessionStatus> {
  if (!fs.existsSync(SESSION_STATE_PATH)) {
    return { valid: false, reason: "no_session" };
  }

  const { browser, context } = await newContext({ headless: true, useNaverSession: true });
  try {
    const page = await context.newPage();

    // ⚠️ 7-9: naver.com 메인의 nidlogin 링크는 로그인 상태에서도 남아있어 이걸로 판정하면
    // 항상 "만료"로 나온다. blog.naver.com/MyBlog.naver로 이동해 로그인 페이지로 튕기는지로 판정한다.
    await page.goto("https://blog.naver.com/MyBlog.naver", { waitUntil: "domcontentloaded" });
    if (/nid\.naver\.com/.test(page.url())) {
      return { valid: false, reason: "expired" };
    }
    const blogId = extractBlogId(page.url());
    if (!blogId) {
      return { valid: false, reason: "expired" };
    }

    // ⚠️ 7-10: 읽기는 되는데 글쓰기만 만료된 상태가 실제로 존재한다("로그인 상태 유지" 미체크).
    // 글쓰기 페이지까지 열어봐야 진짜로 검증된다.
    await page.goto(`https://blog.naver.com/${blogId}?Redirect=Write&categoryNo=0`, {
      waitUntil: "domcontentloaded",
    });
    if (/nid\.naver\.com/.test(page.url())) {
      return { valid: false, reason: "write_expired", blogId };
    }

    return { valid: true, blogId };
  } finally {
    await context.close();
    await browser.close();
  }
}

function extractBlogId(url: string): string | null {
  const m = url.match(/blog\.naver\.com\/([^/?#]+)/);
  return m ? m[1]! : null;
}

export function hasSessionFile(): boolean {
  return fs.existsSync(SESSION_STATE_PATH);
}

export async function logout(): Promise<void> {
  if (fs.existsSync(SESSION_STATE_PATH)) {
    fs.rmSync(SESSION_STATE_PATH);
  }
  invalidateSessionCache();
}
