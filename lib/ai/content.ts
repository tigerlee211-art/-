import { runClaudeJson } from "@/lib/claude";
import {
  IdeasResponseSchema,
  draftSchema,
  type Draft,
  type Idea,
  type PhotoSource,
} from "@/lib/types";
import type { ScrapedSource } from "@/lib/scrape/trends";
import {
  BASE_WRITING_RULES,
  BRANDING_TEMPLATE,
  EXPERIENCE_TEMPLATE,
  SECTION_FORMAT_INSTRUCTION,
  photoHintFor,
} from "@/lib/ai/templates";

type SourceLike = { title: string; summary: string };

function compressSources(sources: SourceLike[]): string {
  return sources.map((s, i) => `${i + 1}. ${s.title}\n${s.summary.slice(0, 400)}`).join("\n\n");
}

type PhotoOpts = {
  photoSource: PhotoSource;
  photoCount?: number;
  photoDescs?: string[];
};

type DraftResult = { ok: true; draft: Draft; droppedHighlights: number } | { ok: false; error: string };

// ⚠️ 7-24: AI는 본문에 없는 highlight를 지어낸다(실측 5개 중 1개, 20%). 형광펜은
// text.indexOf(highlight)로 자리를 찾으므로 그대로 두면 서식이 엉뚱한 곳에 붙는다.
// 초안 전체를 반려하지 말고(문단 30개짜리 글을 highlight 하나 때문에 버리는 건 나쁜 거래),
// 그 highlight만 떨어뜨리고 몇 개 버렸는지 로그로 남길 수 있게 dropped count를 반환한다.
export function sanitizeDraft(draft: Draft): { draft: Draft; droppedHighlights: number } {
  let dropped = 0;
  const sections = draft.sections.map((s) => {
    if (s.type !== "paragraph" || !s.highlight) return s;
    if (s.text.indexOf(s.highlight) === -1) {
      dropped++;
      const { highlight: _drop, ...rest } = s;
      return rest;
    }
    return s;
  });
  return { draft: { ...draft, sections }, droppedHighlights: dropped };
}

// ===== 자동 발굴 1단계: 글감 5개 =====
export async function generateIdeas(
  keyword: string,
  sources: ScrapedSource[],
  n = 5,
): Promise<{ ok: true; ideas: Idea[] } | { ok: false; error: string }> {
  const prompt = `
키워드: ${keyword}

아래는 이 키워드로 수집한 최신 뉴스·블로그 자료다:
${compressSources(sources)}

위 자료의 트렌드를 읽고, 이 키워드에 관한 블로그 글감 ${n}개를 만들어라.
각 글감은 제목(title), 관점(angle), 이 관점을 고른 근거(rationale)를 가져야 한다.
가장 좋은 글감을 배열의 첫 번째(ideas[0])에 두어라.

응답은 오직 이 JSON 형태로만 반환하라:
{ "ideas": [ { "title": "...", "angle": "...", "rationale": "..." } ] }
`.trim();

  const res = await runClaudeJson(prompt, IdeasResponseSchema, { retries: 2 });
  if (!res.ok) return res;
  return { ok: true, ideas: res.data.ideas.slice(0, n) };
}

// ===== 자동 발굴 2단계: 1등 글감으로 본문 =====
export async function generateAutoDraft(
  keyword: string,
  idea: Idea,
  sources: ScrapedSource[],
  opts: PhotoOpts,
): Promise<DraftResult> {
  const prompt = `
키워드: ${keyword}
선정된 글감 제목: ${idea.title}
관점: ${idea.angle}
근거: ${idea.rationale}

참고 자료:
${compressSources(sources)}

${BASE_WRITING_RULES}

${photoHintFor(opts.photoSource, opts.photoCount ?? 0, opts.photoDescs)}

${SECTION_FORMAT_INSTRUCTION}
`.trim();

  return runModeDraft(prompt, opts);
}

// ===== 체험단 / 브랜딩 모드 본문 =====
export async function generateModeDraft(
  mode: "experience" | "branding",
  input: { topic: string; keyPoints: string },
  opts: PhotoOpts,
): Promise<DraftResult> {
  const template = mode === "experience" ? EXPERIENCE_TEMPLATE : BRANDING_TEMPLATE;
  const prompt = `
주제: ${input.topic}
핵심 내용(사용자가 직접 준 정보 — 숫자를 지어내지 말고 이 안에서만 사용):
${input.keyPoints}

${template}

${BASE_WRITING_RULES}

${photoHintFor(opts.photoSource, opts.photoCount ?? 0, opts.photoDescs)}

${SECTION_FORMAT_INSTRUCTION}
`.trim();

  return runModeDraft(prompt, opts);
}

async function runModeDraft(prompt: string, opts: PhotoOpts): Promise<DraftResult> {
  const schema = draftSchema(opts.photoSource, opts.photoCount);
  const res = await runClaudeJson(prompt, schema, { retries: 2 });
  if (!res.ok) return res;
  const { draft, droppedHighlights } = sanitizeDraft(res.data as unknown as Draft);
  return { ok: true, draft, droppedHighlights };
}
