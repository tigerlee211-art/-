import { getDb } from "@/lib/db";
import { jobLog, setJobStage } from "@/lib/log";
import { getSettings } from "@/lib/settings";
import { collectTrends, type ScrapedSource } from "@/lib/scrape/trends";
import { generateIdeas, generateAutoDraft, generateModeDraft } from "@/lib/ai/content";
import { listLocalPhotos, describeLocalPhotos, placeLocalPhotos, type LocalPhoto } from "@/lib/localPhotos";
import { withImageBrowser, findImageForQuery } from "@/lib/scrape/images";
import { generateAiImage } from "@/lib/ai/imagegen";
import { publishDraft, type PublishInput, type PublishResult } from "@/lib/naver/publish";
import { verifySession } from "@/lib/naver/session";
import { todayPublishedCount, lastPublishedAt } from "@/lib/ai/cfUsage";
import type { Draft, Section, JobInput, ImageStyle, PhotoSource } from "@/lib/types";

// ===== 6-10: 오케스트레이션 =====
//   auto:   수집 → 글감 → 본문 → (크롤링|AI생성|없음) → 발행
//   유형별:  (로컬사진 목록·설명) → 본문 → (로컬|크롤링|AI생성|없음) → 발행

type ImageSectionRef = { section: Extract<Section, { type: "image" }>; index: number };

function imageSectionRefs(sections: Section[]): ImageSectionRef[] {
  return sections
    .map((s, i) => ({ s, i }))
    .filter((x): x is { s: Extract<Section, { type: "image" }>; i: number } => x.s.type === "image")
    .map((x) => ({ section: x.s, index: x.i }));
}

// AI 생성용 맥락: ±3섹션에서 텍스트가 있는 것 2개, 400자.
function surroundingText(sections: Section[], index: number): string[] {
  const texts: string[] = [];
  for (let d = 1; d <= 3 && texts.length < 2; d++) {
    for (const idx of [index - d, index + d]) {
      const s = sections[idx];
      if (s && "text" in s && s.text) {
        texts.push(s.text.slice(0, 400));
        if (texts.length >= 2) break;
      }
    }
  }
  return texts;
}

// ⚠️ photoDescs는 본문 생성 단계에서 이미 만든 값을 인자로 받아야 한다 — 내부에서 다시 만들면
// claude 호출이 배로 든다 (6-8, 6-10).
async function fillImages(
  jobId: number,
  draftId: number,
  draft: Draft,
  opts: {
    photoSource: PhotoSource;
    imageStyle: ImageStyle;
    photos: LocalPhoto[];
    photoDescs: string[];
    placeMode: "order" | "ai";
    imageCandidates: number;
  },
): Promise<Map<number, string>> {
  const imagePaths = new Map<number, string>();
  const refs = imageSectionRefs(draft.sections);
  if (opts.photoSource === "none" || refs.length === 0) return imagePaths;

  if (opts.photoSource === "local") {
    const placed = await placeLocalPhotos(opts.photos, opts.photoDescs, draft.sections, opts.placeMode);
    refs.forEach((ref, ordinal) => {
      const p = placed[ordinal];
      if (p) imagePaths.set(ref.index, p);
    });
    return imagePaths;
  }

  if (opts.photoSource === "crawl") {
    await withImageBrowser(async (page, context) => {
      for (const ref of refs) {
        const res = await findImageForQuery(page, context, jobId, draftId, ref.index, ref.section.query, opts.imageCandidates);
        if (res.ok) imagePaths.set(ref.index, res.localPath);
      }
    });
    return imagePaths;
  }

  // ai
  for (const ref of refs) {
    const res = await generateAiImage({
      jobId,
      draftId,
      sectionIndex: ref.index,
      title: draft.title,
      caption: ref.section.caption,
      contextSnippets: surroundingText(draft.sections, ref.index),
      imageStyle: opts.imageStyle,
    });
    if (res.ok) imagePaths.set(ref.index, res.localPath);
  }
  return imagePaths;
}

function parseUtcTimestamp(sqliteDatetime: string): number {
  // SQLite datetime('now') 포맷("YYYY-MM-DD HH:MM:SS")은 UTC이지만 Z가 없다.
  return new Date(sqliteDatetime.replace(" ", "T") + "Z").getTime();
}

// ⚠️ 6-9 발행 가드: 연습 모드가 아닐 때만 검사한다.
function checkPublishGuard(settings: ReturnType<typeof getSettings>): string | null {
  if (settings.killSwitch) return "전체 중단(kill-switch)이 켜져 있습니다.";
  if (todayPublishedCount() >= settings.dailyPublishLimit) {
    return `오늘 발행 한도(${settings.dailyPublishLimit}편)에 도달했습니다.`;
  }
  const last = lastPublishedAt();
  if (last) {
    const elapsedMin = (Date.now() - parseUtcTimestamp(last)) / 60000;
    if (elapsedMin < settings.minPublishIntervalMin) {
      return `마지막 발행 후 ${Math.max(0, Math.floor(elapsedMin))}분 지났습니다(최소 ${settings.minPublishIntervalMin}분 필요).`;
    }
  }
  return null;
}

// ⚠️ 발행 단계에 15분 상한을 Promise.race로 건다. 에디터가 멈추면 잡이 영원히
// publishing으로 남는다 (실제 브라우저 프로세스는 계속 돌 수 있지만, DB 상 잡 상태는
// timeout으로 넘어가 사용자에게 결과를 보여줄 수 있게 한다).
const PUBLISH_TIMEOUT_MS = 15 * 60 * 1000;

function withPublishTimeout(promise: Promise<PublishResult>): Promise<PublishResult> {
  return Promise.race([
    promise,
    new Promise<PublishResult>((resolve) =>
      setTimeout(() => resolve({ ok: false, error: "발행이 15분 안에 끝나지 않아 중단했습니다." }), PUBLISH_TIMEOUT_MS),
    ),
  ]);
}

type JobRow = { id: number; inputs: string };

// ⚠️ runJob은 fire-and-forget이다. API 라우트에서 await하지 말고 .catch(console.error)만
// 붙여 즉시 응답한다. 진행 상황은 SSE(job_logs 폴링)로 본다.
export async function runJob(jobId: number): Promise<void> {
  try {
    const row = getDb().prepare(`SELECT id, inputs FROM jobs WHERE id = ?`).get(jobId) as JobRow | undefined;
    if (!row || !row.inputs) throw new Error("잡 입력값을 찾을 수 없습니다.");
    const input = JSON.parse(row.inputs) as JobInput;
    const settings = getSettings();

    // ===== 수집 (auto 모드만) =====
    let sources: ScrapedSource[] = [];
    if (input.mode === "auto") {
      setJobStage(jobId, { status: "scraping", stage: "수집" });
      jobLog(jobId, `키워드 "${input.keyword}"로 뉴스·블로그 수집을 시작합니다.`);
      const collected = await collectTrends(input.keyword!, settings.scrapeTopN);
      sources = collected.combined;
      const insertSource = getDb().prepare(
        `INSERT INTO sources (job_id, type, title, summary, url) VALUES (?, ?, ?, ?, ?)`,
      );
      for (const s of sources) insertSource.run(jobId, s.type, s.title, s.summary, s.url);
      jobLog(jobId, `수집 완료 — 뉴스 ${collected.news.length}건, 블로그 ${collected.blog.length}건 중 ${sources.length}건 채택`);
    }

    setJobStage(jobId, { status: "writing", stage: "글쓰기" });

    // ===== 내 사진 목록·설명 (본문 생성 전에 한 번만) =====
    let photos: LocalPhoto[] = [];
    let photoDescs: string[] = [];
    if (input.photoSource === "local") {
      photos = listLocalPhotos(input.photoFolder!);
      if (photos.length === 0) throw new Error(`사진 폴더에서 사진을 찾지 못했습니다: ${input.photoFolder}`);
      jobLog(jobId, `내 사진 ${photos.length}장을 찾았습니다. 사진 설명을 만드는 중...`);
      photoDescs = await describeLocalPhotos(photos);
    }

    // ===== 글감 + 본문 =====
    let draftRes;
    if (input.mode === "auto") {
      jobLog(jobId, "글감 5개를 만드는 중...");
      const ideasRes = await generateIdeas(input.keyword!, sources, 5);
      if (!ideasRes.ok) throw new Error(`글감 생성 실패: ${ideasRes.error}`);
      const insertIdea = getDb().prepare(
        `INSERT INTO ideas (job_id, title, angle, rationale, chosen) VALUES (?, ?, ?, ?, ?)`,
      );
      ideasRes.ideas.forEach((idea, i) => insertIdea.run(jobId, idea.title, idea.angle, idea.rationale, i === 0 ? 1 : 0));
      jobLog(jobId, `1등 글감: "${ideasRes.ideas[0]!.title}"`);
      draftRes = await generateAutoDraft(input.keyword!, ideasRes.ideas[0]!, sources, {
        photoSource: input.photoSource,
        photoCount: photos.length,
        photoDescs,
      });
    } else {
      draftRes = await generateModeDraft(
        input.mode,
        { topic: input.topic!, keyPoints: input.keyPoints! },
        { photoSource: input.photoSource, photoCount: photos.length, photoDescs },
      );
    }
    if (!draftRes.ok) throw new Error(`본문 생성 실패: ${draftRes.error}`);
    if (draftRes.droppedHighlights > 0) {
      jobLog(jobId, `AI가 본문에 없는 강조 표시 ${draftRes.droppedHighlights}개를 만들어내 제거했습니다.`, "warn");
    }

    const draft = draftRes.draft;
    const draftId = getDb()
      .prepare(`INSERT INTO drafts (job_id, idea_id, title, body_json) VALUES (?, NULL, ?, ?)`)
      .run(jobId, draft.title, JSON.stringify(draft.sections)).lastInsertRowid as number;
    jobLog(jobId, `본문 생성 완료 — 섹션 ${draft.sections.length}개`);

    // ===== 이미지 =====
    let imagePaths = new Map<number, string>();
    if (input.photoSource !== "none") {
      setJobStage(jobId, { status: "imaging", stage: "이미지" });
      jobLog(jobId, "이미지를 준비하는 중...");
      imagePaths = await fillImages(jobId, draftId, draft, {
        photoSource: input.photoSource,
        imageStyle: input.imageStyle,
        photos,
        photoDescs,
        placeMode: input.placeMode,
        imageCandidates: settings.imageCandidates,
      });
      const imgSectionCount = imageSectionRefs(draft.sections).length;
      jobLog(jobId, `이미지 배치 완료 — ${imagePaths.size}/${imgSectionCount} 자리`);
    }

    // ===== 발행 =====
    setJobStage(jobId, { status: "publishing", stage: "발행" });

    const session = await verifySession();
    if (!session.valid) {
      const reasonText =
        session.reason === "no_session"
          ? "네이버 로그인이 필요합니다."
          : session.reason === "write_expired"
            ? "네이버 글쓰기 권한이 만료됐습니다. 다시 로그인해 주세요('로그인 상태 유지' 체크)."
            : "네이버 로그인이 만료됐습니다. 다시 로그인해 주세요.";
      throw new Error(reasonText);
    }

    const publishSettings = getSettings(); // 재조회 — 그 사이 설정이 바뀌었을 수 있다
    if (!publishSettings.dryRun) {
      const blocked = checkPublishGuard(publishSettings);
      if (blocked) {
        getDb()
          .prepare(`INSERT INTO posts (job_id, draft_id, status, note) VALUES (?, ?, 'blocked', ?)`)
          .run(jobId, draftId, blocked);
        jobLog(jobId, `발행이 차단됐습니다: ${blocked}`, "warn");
        setJobStage(jobId, { status: "done", stage: "차단됨" });
        return;
      }
    }

    const headingAsQuote = input.mode !== "auto"; // 체험단·브랜딩은 heading도 인용구로 (6-9)
    const publishInput: PublishInput = {
      jobId,
      blogId: session.blogId,
      title: draft.title,
      sections: draft.sections,
      imagePaths,
      dryRun: publishSettings.dryRun,
      visibility: publishSettings.visibility,
      headless: !publishSettings.showBrowser,
      headingAsQuote,
      onLog: (m) => jobLog(jobId, m),
    };

    const result = await withPublishTimeout(publishDraft(publishInput));

    if (!result.ok) {
      getDb()
        .prepare(`INSERT INTO posts (job_id, draft_id, status, screenshot, note) VALUES (?, ?, 'failed', ?, ?)`)
        .run(jobId, draftId, result.screenshot ?? null, result.error);
      jobLog(jobId, `발행 실패: ${result.error}`, "error");
      setJobStage(jobId, { status: "failed", stage: "발행 실패", error: result.error });
      return;
    }

    const droppedNote = result.droppedImageCount > 0 ? `이미지 ${result.droppedImageCount}개 자리를 채우지 못했습니다.` : null;

    if (result.dryRun) {
      getDb()
        .prepare(`INSERT INTO posts (job_id, draft_id, status, screenshot, note) VALUES (?, ?, 'dry_run', ?, ?)`)
        .run(jobId, draftId, result.screenshot, droppedNote);
      jobLog(jobId, "연습 모드 완료 — 발행하지 않고 완성 화면을 저장했습니다.");
    } else {
      getDb()
        .prepare(
          `INSERT INTO posts (job_id, draft_id, status, blog_url, screenshot, note, published_at)
           VALUES (?, ?, 'published', ?, ?, ?, datetime('now'))`,
        )
        .run(jobId, draftId, result.blogUrl, result.screenshot, droppedNote);
      jobLog(jobId, `발행 완료: ${result.blogUrl}`);
    }

    setJobStage(jobId, { status: "done", stage: "완료" });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    jobLog(jobId, `실패: ${message}`, "error");
    setJobStage(jobId, { status: "failed", error: message });
  }
}

export const __internal = { fillImages, surroundingText, checkPublishGuard, parseUtcTimestamp };
