import path from "node:path";
import fs from "node:fs";
import crypto from "node:crypto";
import { runClaudeJson } from "@/lib/claude";
import { ImagePromptSchema, type ImageStyle } from "@/lib/types";
import { judgeGeneratedImage } from "@/lib/ai/vision";
import { getDb } from "@/lib/db";
import { DIRS } from "@/lib/paths";
import { getSettings } from "@/lib/settings";

const MIN_BYTES = 2000; // 2000바이트 미만이면 생성 실패
const GEN_TIMEOUT_MS = 90_000;

const STYLE_TOKEN: Record<ImageStyle, string> = {
  photo: "photorealistic photograph, natural lighting, shallow depth of field, 50mm lens, high detail",
  illust: "clean flat vector illustration, simple shapes, soft muted color palette, minimal, lots of white space",
};

const REQUIRED_SUFFIX = "no text, no letters, no words, no watermark, no logo";

// ===== ① claude -p 가 영문 프롬프트를 설계 =====
async function designPrompt(input: {
  title: string;
  caption?: string;
  contextSnippets: string[]; // ±3섹션에서 2개, 400자
  imageStyle: ImageStyle;
  feedback?: string; // 재생성 시 이전 실패 사유를 되먹임
}): Promise<{ ok: true; prompt: string } | { ok: false; error: string }> {
  const prompt = `
글 제목: ${input.title}
이 자리의 캡션(있다면): ${input.caption ?? "(없음)"}
앞뒤 문단 맥락:
${input.contextSnippets.map((s, i) => `${i + 1}. ${s.slice(0, 400)}`).join("\n")}

위 내용에 어울리는 이미지를 생성하기 위한 FLUX용 영문 프롬프트를 설계하라.

규칙(고정):
- 영어, 한 문단, 40단어 이내.
- 피사체 / 구도 / 조명 / 배경 / 질감을 명시할 것.
- 다음 스타일 토큰을 반드시 포함할 것: "${STYLE_TOKEN[input.imageStyle]}"
- 끝에 반드시 다음을 포함할 것: "${REQUIRED_SUFFIX}"
- 실존 인물·유명인·브랜드 로고를 절대 넣지 말 것.
- 사람이 필요하면 얼굴이 크게 안 나오는 구도(손·뒷모습·실루엣)로 할 것.
- 한국적 맥락은 반영하되 한글 간판·글자는 절대 넣지 말 것(생성 모델이 한글을 깨뜨림).
${input.feedback ? `- 이전 시도가 다음 이유로 실패했다. 이 문제를 피하도록 다시 설계하라: ${input.feedback}` : ""}

응답 형식: { "prompt": "..." }
`.trim();

  const res = await runClaudeJson(prompt, ImagePromptSchema, { retries: 2 });
  if (!res.ok) return res;

  let text = res.data.prompt.trim();
  if (!text.toLowerCase().includes("no watermark")) {
    text = `${text}, ${REQUIRED_SUFFIX}`;
  }
  return { ok: true, prompt: text };
}

// ===== ② Cloudflare Workers AI로 생성 =====
async function callCloudflare(prompt: string, steps: number): Promise<{ ok: true; buf: Buffer } | { ok: false; error: string }> {
  const accountId = process.env.CF_ACCOUNT_ID;
  const apiToken = process.env.CF_API_TOKEN;
  if (!accountId || !apiToken) {
    return { ok: false, error: "Cloudflare 키가 설정되지 않았습니다 (CF_ACCOUNT_ID / CF_API_TOKEN)." };
  }

  const url = `https://api.cloudflare.com/client/v4/accounts/${accountId}/ai/run/@cf/black-forest-labs/flux-1-schnell`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), GEN_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiToken}`, "Content-Type": "application/json" },
      body: JSON.stringify({ prompt, steps: Math.min(Math.max(steps, 1), 8) }),
      signal: controller.signal,
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      return { ok: false, error: `Cloudflare API 오류 (${res.status}): ${text.slice(0, 200)}` };
    }
    const json = (await res.json()) as { result?: { image?: string } };
    const b64 = json.result?.image;
    if (!b64) return { ok: false, error: "Cloudflare 응답에 이미지가 없습니다." };
    // ⚠️ 응답은 바이너리가 아니라 base64 JSON이다.
    const buf = Buffer.from(b64, "base64");
    if (buf.length < MIN_BYTES) return { ok: false, error: "생성된 이미지가 너무 작습니다(생성 실패)." };
    return { ok: true, buf };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, error: `Cloudflare 요청 실패: ${msg}` };
  } finally {
    clearTimeout(timer);
  }
}

function recordImage(row: {
  jobId: number;
  draftId: number | null;
  query: string;
  localPath: string;
  sectionIndex: number;
  genPrompt: string;
}) {
  getDb()
    .prepare(
      `INSERT INTO images (job_id, draft_id, query, local_path, source_site, verdict_ok, verdict_reason, section_index, gen_prompt)
       VALUES (?, ?, ?, ?, 'ai', 1, 'AI 생성 검증 통과', ?, ?)`,
    )
    .run(row.jobId, row.draftId, row.query, row.localPath, row.sectionIndex, row.genPrompt);
}

export type GenImageResult = { ok: true; localPath: string; prompt: string } | { ok: false; reason: string };

// ===== ③ 검증 — 크롤링용 판정함수를 재사용하지 않는다 (7-13) =====
// 부적합하면 그 이유를 프롬프트 설계에 되먹여 1회만 재생성하고, 그래도 실패하면 건너뛴다.
export async function generateAiImage(opts: {
  jobId: number;
  draftId: number | null;
  sectionIndex: number;
  title: string;
  caption?: string;
  contextSnippets: string[];
  imageStyle: ImageStyle;
}): Promise<GenImageResult> {
  const steps = getSettings().cfImageSteps;
  let feedback: string | undefined;

  for (let attempt = 0; attempt < 2; attempt++) {
    // 무한 루프 금지: 최대 2회(최초 1회 + 재생성 1회)만 시도한다.
    const designed = await designPrompt({
      title: opts.title,
      caption: opts.caption,
      contextSnippets: opts.contextSnippets,
      imageStyle: opts.imageStyle,
      feedback,
    });
    if (!designed.ok) return { ok: false, reason: designed.error };

    const gen = await callCloudflare(designed.prompt, steps);
    if (!gen.ok) return { ok: false, reason: gen.error };

    const fileName = `${opts.jobId}_${opts.sectionIndex}_ai_${crypto.randomBytes(4).toString("hex")}.png`;
    const localPath = path.join(DIRS.images, fileName);
    fs.writeFileSync(localPath, gen.buf);

    const verdict = await judgeGeneratedImage(localPath, opts.title + (opts.caption ? ` - ${opts.caption}` : ""));
    if (verdict.ok) {
      recordImage({ jobId: opts.jobId, draftId: opts.draftId, query: opts.title, localPath, sectionIndex: opts.sectionIndex, genPrompt: designed.prompt });
      return { ok: true, localPath, prompt: designed.prompt };
    }

    fs.rmSync(localPath, { force: true });
    feedback = verdict.reason;
  }

  return { ok: false, reason: `2회 시도 후에도 부적합: ${feedback ?? "알 수 없는 사유"}` };
}
