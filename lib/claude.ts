import { spawn } from "node:child_process";
import type { z } from "zod";
import { getSettings } from "@/lib/settings";

// ===== 2-1: AI 호출은 반드시 `claude -p` CLI로 =====
// Anthropic API 키(@anthropic-ai/sdk)는 종량 과금이 된다. 이 앱은 사용자의 Claude 구독요금제로
// 동작해야 하므로, 로컬에 설치된 claude CLI를 자식 프로세스로 실행한다.

type ClaudeResult = { ok: true; text: string } | { ok: false; error: string };

// ⚠️ 윈도우: npm 전역 바이너리는 claude.cmd 셸 심(shim)으로 깔리고, Node의 spawn은 .cmd를
// 직접 실행하지 못해 ENOENT로 죽는다. shell: true로 우회한다.
// 이 앱은 shell:true를 써도 안전하다 — 프롬프트를 argv가 아니라 stdin으로 넘기기 때문에
// argv에는 "-p --output-format json" 밖에 없고 셸 인용부호 문제가 생길 여지가 없다.
const isWin = process.platform === "win32";
function claudeBin(): string {
  return process.env.CLAUDE_BIN || "claude";
}

// ===== 동시성 세마포어 =====
// claude 프로세스를 무제한으로 띄우면 머신이 죽는다. 동시성은 호출 시점에 getSettings()로
// 읽는다 — 설정 변경이 즉시 반영되도록.
let active = 0;
const waiters: Array<() => void> = [];

async function acquireSlot(): Promise<() => void> {
  const limit = getSettings().claudeConcurrency;
  if (active >= limit) {
    await new Promise<void>((resolve) => waiters.push(resolve));
  }
  active++;
  return () => {
    active--;
    const next = waiters.shift();
    if (next) next();
  };
}

function buildPrompt(prompt: string, images?: string[], system?: string): string {
  let full = prompt;
  if (images && images.length > 0) {
    // 이미지 첨부: @경로를 프롬프트 끝에 공백 구분으로 붙인다. 프로젝트 밖 절대경로도 동작한다(검증됨).
    full = full + "\n\n" + images.map((p) => `@${p}`).join(" ");
  }
  if (system) {
    full = `${system}\n\n${full}`;
  }
  return full;
}

export async function runClaude(
  prompt: string,
  opts?: { images?: string[]; system?: string },
): Promise<ClaudeResult> {
  const release = await acquireSlot();
  try {
    return await execClaude(buildPrompt(prompt, opts?.images, opts?.system));
  } finally {
    release();
  }
}

function execClaude(fullPrompt: string): Promise<ClaudeResult> {
  const timeoutMs = getSettings().claudeTimeoutSec * 1000;
  return new Promise((resolve) => {
    const p = spawn(claudeBin(), ["-p", "--output-format", "json"], { shell: isWin });

    let stdout = "";
    let stderr = "";
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      p.kill("SIGKILL");
      resolve({ ok: false, error: `claude 실행이 ${timeoutMs / 1000}초를 넘겨 강제 종료했습니다.` });
    }, timeoutMs);

    p.stdout.on("data", (d) => (stdout += d.toString()));
    p.stderr.on("data", (d) => (stderr += d.toString()));

    p.on("error", (err) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ ok: false, error: `claude 프로세스를 실행할 수 없습니다: ${err.message}` });
    });

    p.on("close", (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (code !== 0 && !stdout.trim()) {
        resolve({ ok: false, error: stderr.trim() || `claude가 종료 코드 ${code}로 실패했습니다.` });
        return;
      }
      try {
        const parsed = JSON.parse(stdout);
        if (parsed && typeof parsed.result === "string") {
          if (parsed.is_error) {
            resolve({ ok: false, error: parsed.result });
          } else {
            resolve({ ok: true, text: parsed.result });
          }
          return;
        }
        // 알려진 형태가 아니면 raw stdout을 그대로 반환 (폴백)
        resolve({ ok: true, text: stdout });
      } catch {
        // JSON 파싱 실패 시 raw stdout을 그대로 텍스트로 반환 (폴백)
        resolve({ ok: true, text: stdout });
      }
    });

    // 반드시 stdin. 프롬프트를 argv로 넘기면 긴 한글에서 escaping이 깨진다.
    p.stdin.write(fullPrompt);
    p.stdin.end();
  });
}

// ===== 구조화 출력 =====

const JSON_INSTRUCTION =
  "반드시 유효한 JSON 만 출력하라. 설명/마크다운/코드펜스 없이 JSON 객체 또는 배열만 반환하라.";

function extractJson(text: string): string | null {
  // ① ```json ... ``` 펜스를 먼저 찾는다
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence && fence[1] && fence[1].trim()) return fence[1].trim();

  // ② 없으면 첫 { 또는 [ 부터 마지막 짝 문자까지 잘라낸다
  const startObj = text.indexOf("{");
  const startArr = text.indexOf("[");
  let start = -1;
  let open = "{";
  let close = "}";
  if (startObj === -1 && startArr === -1) return null;
  if (startArr !== -1 && (startObj === -1 || startArr < startObj)) {
    start = startArr;
    open = "[";
    close = "]";
  } else {
    start = startObj;
  }
  const lastClose = text.lastIndexOf(close);
  if (lastClose === -1 || lastClose <= start) return null;
  return text.slice(start, lastClose + 1);
}

export async function runClaudeJson<T>(
  prompt: string,
  schema: z.ZodType<T>,
  opts?: { images?: string[]; system?: string; retries?: number },
): Promise<{ ok: true; data: T } | { ok: false; error: string }> {
  const retries = opts?.retries ?? 2;
  const system = [opts?.system, JSON_INSTRUCTION].filter(Boolean).join("\n\n");

  let lastError = "알 수 없는 오류";
  for (let attempt = 0; attempt <= retries; attempt++) {
    const res = await runClaude(prompt, { images: opts?.images, system });
    if (!res.ok) {
      lastError = res.error;
      continue;
    }
    const jsonText = extractJson(res.text) ?? res.text;
    let parsed: unknown;
    try {
      parsed = JSON.parse(jsonText);
    } catch {
      lastError = "AI 응답에서 JSON을 찾지 못했습니다.";
      continue; // 파싱 실패도 재시도 사유
    }
    const validated = schema.safeParse(parsed);
    if (validated.success) {
      return { ok: true, data: validated.data };
    }
    lastError = `AI 응답이 기대한 형식과 다릅니다: ${validated.error.message}`;
    // Zod 검증 실패도 재시도 사유
  }
  return { ok: false, error: lastError };
}

// ===== 설치·로그인 여부 확인 =====

export async function checkClaude(): Promise<{ installed: boolean; version?: string; error?: string }> {
  return new Promise((resolve) => {
    const p = spawn(claudeBin(), ["--version"], { shell: isWin });
    let stdout = "";
    let stderr = "";
    p.stdout.on("data", (d) => (stdout += d.toString()));
    p.stderr.on("data", (d) => (stderr += d.toString()));
    p.on("error", (err) => resolve({ installed: false, error: err.message }));
    p.on("close", (code) => {
      if (code === 0 && stdout.trim()) {
        resolve({ installed: true, version: stdout.trim() });
      } else {
        resolve({ installed: false, error: stderr.trim() || `종료 코드 ${code}` });
      }
    });
  });
}
