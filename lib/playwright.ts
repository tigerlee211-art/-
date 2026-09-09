import { chromium, type Browser, type BrowserContext } from "playwright";
import fs from "node:fs";
import { spawn } from "node:child_process";
import { SESSION_STATE_PATH } from "@/lib/paths";

// ⚠️ 2-3: chromium.launch()가 "Executable doesn't exist"로 실패하면
// npx playwright install chromium 을 자동 실행하고 1회 재시도한다.
// 설치 Promise는 모듈 레벨에 캐싱해 중복 설치를 막는다.
let installPromise: Promise<void> | null = null;

const NEEDS_INSTALL = /Executable doesn'?t exist|please run|install/i;

function installChromium(): Promise<void> {
  if (!installPromise) {
    installPromise = new Promise((resolve, reject) => {
      const isWin = process.platform === "win32";
      const p = spawn("npx", ["playwright", "install", "chromium"], { shell: isWin, stdio: "inherit" });
      p.on("error", reject);
      p.on("close", (code) => (code === 0 ? resolve() : reject(new Error(`playwright install 종료 코드 ${code}`))));
    });
  }
  return installPromise;
}

// 개발용 오버라이드: 설치된 playwright npm 버전이 기대하는 브라우저 리비전과 시스템에 이미
// 깔려 있는 chromium 리비전이 다를 때(CI/샌드박스 등) 이 값으로 직접 실행 파일을 지정할 수 있다.
// 일반 사용자는 이 값을 설정할 필요가 없다 — npx playwright install chromium이 알아서 맞춰준다.
const EXECUTABLE_OVERRIDE = process.env.PLAYWRIGHT_CHROMIUM_PATH;

async function launchWithAutoInstall(headless: boolean): Promise<Browser> {
  const launchOpts = EXECUTABLE_OVERRIDE ? { headless, executablePath: EXECUTABLE_OVERRIDE } : { headless };
  try {
    return await chromium.launch(launchOpts);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (!NEEDS_INSTALL.test(message) || EXECUTABLE_OVERRIDE) throw err;
    await installChromium();
    return await chromium.launch(launchOpts); // 1회 재시도
  }
}

export async function newContext(opts: {
  headless: boolean;
  useNaverSession: boolean;
}): Promise<{ browser: Browser; context: BrowserContext }> {
  const browser = await launchWithAutoInstall(opts.headless);
  const hasSession = opts.useNaverSession && fs.existsSync(SESSION_STATE_PATH);
  const context = await browser.newContext({
    viewport: { width: 1366, height: 900 },
    locale: "ko-KR",
    userAgent:
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36",
    storageState: hasSession ? SESSION_STATE_PATH : undefined,
  });
  return { browser, context };
}
