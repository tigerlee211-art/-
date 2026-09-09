import type { Browser, BrowserContext, FrameLocator, Locator, Page } from "playwright";
import fs from "node:fs";
import path from "node:path";
import { newContext } from "@/lib/playwright";
import { EDITOR } from "@/lib/scrape/selectors";
import { stripMarkdown, splitForTyping } from "@/lib/naver/textFormat";
import { DIRS } from "@/lib/paths";
import type { Section } from "@/lib/types";
import type { Settings } from "@/config";

type VisibilityValue = Settings["visibility"];

// ===== 6-9: 에디터 자동화 — 이 프로젝트의 90% =====
// 여기 순서·셀렉터는 실측값이다. 그대로 쓴다. 각 함정 번호는 7장을 참고.

export type PublishInput = {
  jobId: number;
  blogId: string;
  title: string;
  sections: Section[];
  imagePaths: Map<number, string>; // section index(원본 draft 기준) -> 로컬 이미지 절대경로
  dryRun: boolean;
  visibility: VisibilityValue;
  headless: boolean;
  entryUrl?: string; // 9장 6.5-a: 로컬 하네스 테스트용. 기본은 실제 네이버 글쓰기 URL.
  // 체험단·브랜딩 모드는 소제목(heading)도 인용구 서식으로 입력한다 (6-9).
  headingAsQuote?: boolean;
  onLog?: (msg: string) => void;
};

export type PublishResult =
  | { ok: true; dryRun: true; screenshot: string; droppedImageCount: number }
  | { ok: true; dryRun: false; blogUrl: string; screenshot: string; droppedImageCount: number }
  | { ok: false; error: string; screenshot?: string };

// ⚠️ boundingBox()는 요소가 없으면 Playwright 기본 30초를 기다린다 (7-27).
// 모든 boundingBox 호출에 짧은 타임아웃을 준다.
const BB_TIMEOUT = 800;

async function firstVisible(scope: FrameLocator | Page, candidates: readonly string[]): Promise<Locator | null> {
  for (const sel of candidates) {
    const loc = scope.locator(sel).first();
    try {
      if (await loc.isVisible({ timeout: BB_TIMEOUT })) return loc;
    } catch {
      // 존재하지 않는 셀렉터 — 다음 후보로
    }
  }
  return null;
}

async function clickFirstVisible(scope: FrameLocator | Page, candidates: readonly string[]): Promise<boolean> {
  const loc = await firstVisible(scope, candidates);
  if (!loc) return false;
  await loc.click();
  return true;
}

// ⚠️ 발행 버튼·공개범위 라디오의 위치(iframe 안/밖)는 환경에 따라 다르다.
// iframe 안 → 바깥 문서 순으로 반드시 두 곳 다 뒤진다.
async function clickAnywhere(page: Page, frame: FrameLocator, candidates: readonly string[]): Promise<boolean> {
  if (await clickFirstVisible(frame, candidates)) return true;
  if (await clickFirstVisible(page, candidates)) return true;
  return false;
}

async function firstVisibleAnywhere(page: Page, frame: FrameLocator, candidates: readonly string[]): Promise<Locator | null> {
  const inFrame = await firstVisible(frame, candidates);
  if (inFrame) return inFrame;
  return firstVisible(page, candidates);
}

function log(input: PublishInput, msg: string) {
  input.onLog?.(msg);
}

// ===== 오버레이 닫기 (7-4, 7-21) =====
// 도움말 패널 계열과 우측 사이드바 계열은 환경에 따라 서로 다른 컴포넌트일 수 있다.
// 두 계열을 모두 시도하고, 둘 다 없으면 Escape.
async function closeOverlays(page: Page, frame: FrameLocator) {
  const closedHelp = await clickAnywhere(page, frame, EDITOR.helpClose);
  const closedSidebar = await clickAnywhere(page, frame, EDITOR.sidebarClose);
  if (!closedHelp && !closedSidebar) {
    await page.keyboard.press("Escape");
  }
  await page.waitForTimeout(300);
}

// ===== 인용구/구분선/캡션 뒤 탈출 (7-5, 7-6, 7-27) =====
// 컴포넌트 안에서는 어떤 키로도 탈출되지 않는다. 마지막 컴포넌트 아래 빈 영역을 마우스로 클릭한다.
// ⚠️ 하단 글감 검색바(7-6)를 누르지 않도록 y좌표를 그 바 위쪽으로 클램프한다.
async function exitToNewParagraph(page: Page, frame: FrameLocator) {
  const last = frame.locator(EDITOR.contentComponents[0]).last();
  const lbox = await last.boundingBox({ timeout: BB_TIMEOUT });
  const viewport = page.viewportSize();
  const vh = viewport?.height ?? 900;
  const vw = viewport?.width ?? 1366;

  let x = vw / 2;
  let y = (lbox ? lbox.y + lbox.height + 30 : vh - 150);

  const toolbarBox = await frame
    .locator(EDITOR.bottomToolbar[0])
    .first()
    .boundingBox({ timeout: BB_TIMEOUT })
    .catch(() => null);
  const canvasBottom = vh - 10;
  const maxY = Math.min(toolbarBox ? toolbarBox.y - 20 : vh - 150, canvasBottom - 20);
  y = Math.max(140, Math.min(y, maxY));

  if (lbox) x = Math.max(20, Math.min(x, lbox.x + lbox.width - 20));

  // 아래 여백이 없으면 스크롤로 공간을 만든 뒤 다시 계산
  if (y <= 140) {
    await page.mouse.wheel(0, 250);
    await page.waitForTimeout(150);
    return exitToNewParagraphOnce(page, frame);
  }

  await page.mouse.click(x, y);
  await page.waitForTimeout(150);
}

async function exitToNewParagraphOnce(page: Page, frame: FrameLocator) {
  const last = frame.locator(EDITOR.contentComponents[0]).last();
  const lbox = await last.boundingBox({ timeout: BB_TIMEOUT });
  const viewport = page.viewportSize();
  const vh = viewport?.height ?? 900;
  const vw = viewport?.width ?? 1366;
  const x = vw / 2;
  const y = lbox ? lbox.y + lbox.height + 30 : vh - 150;
  await page.mouse.click(x, Math.min(y, vh - 20));
  await page.waitForTimeout(150);
}

// ===== 타이핑 — 마크다운 무력화 + VS16 이모지 처리 (7-8, 7-25) =====
async function typeSafely(page: Page, text: string) {
  const clean = stripMarkdown(text);
  const chunks = splitForTyping(clean);
  for (const chunk of chunks) {
    if (chunk.mode === "insertText") {
      await page.keyboard.insertText(chunk.text);
    } else {
      await page.keyboard.type(chunk.text, { delay: 7 });
    }
  }
}

// ===== 문단 서식 적용 =====
async function applyParagraphFormat(page: Page, frame: FrameLocator, which: "heading" | "body" | "quote") {
  const opened = await clickFirstVisible(frame, EDITOR.textFormatOpen);
  if (!opened) return false;
  await page.waitForTimeout(300); // 드롭다운 애니메이션
  const target = which === "heading" ? EDITOR.optHeading : which === "quote" ? EDITOR.optQuote : EDITOR.optBody;
  const clicked = await clickFirstVisible(frame, target);
  await page.waitForTimeout(300);
  return clicked;
}

async function setHighlight(page: Page, frame: FrameLocator, on: boolean) {
  const boldOn = await clickFirstVisible(frame, EDITOR.bold);
  await page.waitForTimeout(250);
  const opened = await clickFirstVisible(frame, EDITOR.bgColorOpen);
  if (opened) {
    await page.waitForTimeout(300);
    if (on) {
      await clickFirstVisible(frame, EDITOR.bgColorYellow);
    } else {
      await clickFirstVisible(frame, EDITOR.bgColorNone);
    }
    await page.waitForTimeout(250);
  }
  return boldOn;
}

// ===== 파일 선택창 영구 핸들러 (7-7 ★) =====
// 일회성 waitForEvent 리스너가 만료된 뒤 업로드하면 OS 네이티브 대화상자가 뜨고 브라우저가
// 영구히 멈춘다(7분간 CPU 0%). 페이지를 열기 전에 영구 핸들러를 등록해야 한다.
type PendingUpload = { path: string | null; done: boolean };

function registerFileChooserHandler(page: Page): PendingUpload {
  const pendingUpload: PendingUpload = { path: null, done: false };
  page.on("filechooser", async (chooser) => {
    try {
      if (pendingUpload.path) await chooser.setFiles(pendingUpload.path);
    } finally {
      pendingUpload.done = true;
    }
  });
  return pendingUpload;
}

async function uploadImage(page: Page, frame: FrameLocator, pendingUpload: PendingUpload, imagePath: string): Promise<boolean> {
  pendingUpload.path = imagePath;
  pendingUpload.done = false;
  const clicked = await clickFirstVisible(frame, EDITOR.imageButton);
  if (!clicked) return false;

  const deadline = Date.now() + 20_000; // 완료 폴링 최대 20초
  while (!pendingUpload.done && Date.now() < deadline) {
    await page.waitForTimeout(200);
  }
  if (!pendingUpload.done) return false;
  await page.waitForTimeout(2600); // ⚠️ 업로드 반영 대기
  return true;
}

// ===== 이미지 + 캡션 절차 (7-18) =====
async function insertImageWithCaption(page: Page, frame: FrameLocator, pendingUpload: PendingUpload, imagePath: string, caption?: string) {
  const uploaded = await uploadImage(page, frame, pendingUpload, imagePath);
  if (!uploaded) return { ok: false as const, reason: "이미지 업로드가 완료되지 않았습니다." };

  // 방금 넣은(마지막) 이미지 컴포넌트를 클릭 — 캡션 칸은 업로드 직후 0×0이라 클릭해야 펼쳐진다.
  const imgComponent = frame.locator(EDITOR.imageComponent[0]).last();
  const box = await imgComponent.boundingBox({ timeout: BB_TIMEOUT });
  if (!box) return { ok: false as const, reason: "이미지 컴포넌트를 찾지 못했습니다." };
  await imgComponent.click();
  await page.waitForTimeout(300);

  if (!caption) return { ok: true as const };

  // ⚠️ 크기 숫자(640×24 vs 64×63)를 판정 기준으로 쓰지 않는다. se-is-on 클래스로 판정한다.
  const captionLoc = imgComponent.locator(EDITOR.caption[0]!);
  let expanded = false;
  try {
    await captionLoc.first().waitFor({ state: "visible", timeout: 3000 });
    const cls = (await captionLoc.first().getAttribute("class")) ?? "";
    expanded = cls.includes("se-is-on") || (await captionLoc.first().isVisible());
  } catch {
    expanded = false;
  }

  if (!expanded) {
    // 폴백 사다리 ②: 캡션을 포기하고 경고만 남긴다. 이미지는 이미 들어갔으므로 발행은 계속 진행.
    return { ok: true as const, captionSkipped: true, reason: "캡션 칸(.se-caption)이 펼쳐지지 않아 건너뜀" };
  }

  await captionLoc.first().click();
  await page.waitForTimeout(150);
  await typeSafely(page, caption);

  // 캡션도 컴포넌트 안이므로 7-5의 마우스 탈출이 여기서도 필요하다.
  await exitToNewParagraph(page, frame);

  return { ok: true as const };
}

// ===== 발행 직전 스크린샷 (7-20) =====
async function captureFullScreenshot(page: Page, frame: FrameLocator, outPath: string) {
  const original = page.viewportSize() ?? { width: 1366, height: 900 };
  const content = frame.locator(".se-content").first();

  // ⚠️ boundingBox().height로 계산하지 않는다 — 761 vs 3637, 5배 차이 나는 사례가 있었다.
  const scrollHeight = await content.evaluate((el) => el.scrollHeight).catch(() => null);
  const box = await content.boundingBox({ timeout: BB_TIMEOUT });

  if (scrollHeight && box) {
    const newHeight = Math.min(9000, Math.round(box.y + scrollHeight + 160));
    await page.setViewportSize({ width: original.width, height: newHeight });
    await page.waitForTimeout(1200);
    await page.screenshot({ path: outPath, fullPage: true });
  } else {
    // 폴백: 보이는 화면이라도 저장
    await page.screenshot({ path: outPath, fullPage: true });
  }

  await page.setViewportSize(original);
}

// ===== 공개 범위 선택 (7-19) =====
async function setVisibility(page: Page, frame: FrameLocator, visibility: VisibilityValue): Promise<boolean> {
  const target = EDITOR.visibility[visibility];
  const clicked = await clickAnywhere(page, frame, [target.label]);
  if (!clicked) return false;
  await page.waitForTimeout(200);

  const input = await firstVisibleAnywhere(page, frame, [target.input]).catch(() => null);
  // input이 hidden(opacity:0)이라 isVisible이 false일 수 있으므로 count로도 확인
  const inputLoc = input ?? (await countExists(page, frame, target.input));
  if (!inputLoc) return false;

  const checked = await inputLoc.isChecked().catch(() => false);
  return checked;
}

async function countExists(page: Page, frame: FrameLocator, selector: string): Promise<Locator | null> {
  const inFrame = frame.locator(selector).first();
  if ((await inFrame.count()) > 0) return inFrame;
  const inPage = page.locator(selector).first();
  if ((await inPage.count()) > 0) return inPage;
  return null;
}

// ===== 섹션 타입별 입력 =====
async function typeSection(
  page: Page,
  frame: FrameLocator,
  section: Section,
  index: number,
  imagePaths: Map<number, string>,
  pendingUpload: PendingUpload,
  headingAsQuote: boolean,
  onLog?: (msg: string) => void,
): Promise<{ ok: true; captionSkipped?: boolean } | { ok: false; reason: string }> {
  switch (section.type) {
    case "heading": {
      await applyParagraphFormat(page, frame, headingAsQuote ? "quote" : "heading");
      await typeSafely(page, section.text);
      await page.keyboard.press("Enter");
      await applyParagraphFormat(page, frame, "body"); // 본문으로 복귀
      return { ok: true };
    }
    case "paragraph": {
      if (section.highlight) {
        const idx = section.text.indexOf(section.highlight);
        if (idx === -1) {
          // 이중 방어: 타이핑 직전에도 한 번 더 확인하고, 못 찾으면 형광펜을 생략한다.
          await typeSafely(page, section.text);
        } else {
          const before = section.text.slice(0, idx);
          const mid = section.text.slice(idx, idx + section.highlight.length);
          const after = section.text.slice(idx + section.highlight.length);
          if (before) await typeSafely(page, before);
          await setHighlight(page, frame, true);
          await typeSafely(page, mid);
          await setHighlight(page, frame, false);
          if (after) await typeSafely(page, after);
        }
      } else {
        await typeSafely(page, section.text);
      }
      await page.keyboard.press("Enter");
      await page.keyboard.press("Enter");
      return { ok: true };
    }
    case "quote": {
      await typeSafely(page, section.text);
      await page.keyboard.press("Shift+Home");
      await applyParagraphFormat(page, frame, "quote");
      await exitToNewParagraph(page, frame);
      return { ok: true };
    }
    case "divider": {
      const inserted = await clickFirstVisible(frame, EDITOR.dividerInsert);
      if (!inserted) return { ok: false, reason: "구분선 버튼을 찾지 못함" };
      await exitToNewParagraph(page, frame);
      return { ok: true };
    }
    case "image": {
      const imgPath = imagePaths.get(index);
      if (!imgPath) return { ok: false, reason: `이 자리(${index})에 배정된 이미지 파일이 없음` };
      const res = await insertImageWithCaption(page, frame, pendingUpload, imgPath, section.caption);
      if (!res.ok) {
        onLog?.(`⚠️ 이미지 삽입 실패(자리 ${index}): ${res.reason}`);
        return { ok: false, reason: res.reason };
      }
      if (res.captionSkipped) {
        onLog?.(`⚠️ 캡션 생략(자리 ${index}): ${res.reason}`);
      }
      return { ok: true, captionSkipped: res.captionSkipped };
    }
  }
}

// ===== 실제 발행 검증 (7-11) =====
function isPublishedUrl(url: string): boolean {
  return /blog\.naver\.com\/[^/]+\/\d{6,}/.test(url);
}

export async function publishDraft(input: PublishInput): Promise<PublishResult> {
  const entryUrl = input.entryUrl ?? `https://blog.naver.com/${input.blogId}?Redirect=Write&categoryNo=0`;
  const { browser, context } = await newContext({ headless: input.headless, useNaverSession: !input.entryUrl });

  let page: Page | null = null;
  try {
    page = await context.newPage();

    // ① 페이지를 열기 전에 영구 파일선택창 핸들러를 등록한다 (7-7 ★)
    const pendingUpload = registerFileChooserHandler(page);

    // ② 에디터 진입
    await page.goto(entryUrl, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(2500);

    const realFrame = await resolveFrame(page);
    if (!realFrame) {
      const shot = await saveFailureShot(page, input.jobId, "frame-not-found");
      return { ok: false, error: "에디터 iframe(#mainFrame)을 찾지 못했습니다.", screenshot: shot };
    }

    // ③ '작성 중인 글이 있습니다' 복원 팝업 처리 — 있으면 취소로 닫는다.
    const popup = await firstVisible(realFrame, EDITOR.restorePopup);
    if (popup) {
      log(input, "복원 팝업을 닫는 중...");
      const cancelled = await clickFirstVisible(realFrame, EDITOR.restoreCancel);
      if (!cancelled) {
        const shot = await saveFailureShot(page, input.jobId, "restore-popup-stuck");
        return { ok: false, error: "복원 팝업을 닫지 못했습니다(취소 버튼 없음).", screenshot: shot };
      }
      // ⚠️ 7-3: 팝업 차단막이 남아있으면 이후 클릭이 조용히 무시된다.
      await page.waitForTimeout(400);
      await clickFirstVisible(realFrame, EDITOR.popupDim).catch(() => {});
    }

    // ④ 도움말/온보딩 패널 닫기
    await closeOverlays(page, realFrame);

    // ⑤ 제목 입력 → 본문 클릭 → 섹션 순차 입력
    const titleLoc = await firstVisible(realFrame, EDITOR.title);
    if (!titleLoc) {
      const shot = await saveFailureShot(page, input.jobId, "title-not-found");
      return { ok: false, error: "제목 입력 칸을 찾지 못했습니다.", screenshot: shot };
    }
    await titleLoc.click();
    await typeSafely(page, input.title);

    // ⚠️ 7-26: 본문을 못 찾으면 Enter로 한 번 더 시도하고, 그래도 안 되면 즉시 실패 처리한다.
    // 조용히 진행하면 글 전체가 제목 칸에 들어간다.
    let bodyLoc = await firstVisible(realFrame, EDITOR.body);
    if (!bodyLoc) {
      await page.keyboard.press("Enter");
      await page.waitForTimeout(300);
      bodyLoc = await firstVisible(realFrame, EDITOR.body);
    }
    if (!bodyLoc) {
      const shot = await saveFailureShot(page, input.jobId, "body-not-found");
      return { ok: false, error: "본문 입력 영역을 찾지 못했습니다. (조용히 진행하면 글 전체가 제목 칸에 들어갑니다 — 7-26)", screenshot: shot };
    }
    await bodyLoc.click();
    await page.waitForTimeout(200);

    const headingAsQuote = input.headingAsQuote ?? false;
    const droppedImages: number[] = [];
    for (let i = 0; i < input.sections.length; i++) {
      const section = input.sections[i]!;
      const res = await typeSection(page, realFrame, section, i, input.imagePaths, pendingUpload, headingAsQuote, (m) => log(input, m));
      if (!res.ok) {
        if (section.type === "image") {
          droppedImages.push(i);
          log(input, `이미지 자리 ${i}를 건너뜁니다: ${res.reason}`);
          continue;
        }
        const shot = await saveFailureShot(page, input.jobId, `section-${i}-failed`);
        return { ok: false, error: `섹션 ${i}(${section.type}) 입력 실패: ${res.reason}`, screenshot: shot };
      }
    }

    // ⑥ 도움말 패널 + 오버레이 도크 닫기 (스크린샷 앞) — 7-21: 사진 넣으면 우측 도크가 열림
    await closeOverlays(page, realFrame);

    // ⑦ 발행 직전 전체 스크린샷
    const screenshotPath = path.join(DIRS.screenshots, `job-${input.jobId}-preview.png`);
    await captureFullScreenshot(page, realFrame, screenshotPath);

    // ⑧ 연습 모드면 여기서 종료
    if (input.dryRun) {
      log(input, "연습 모드 — 발행하지 않고 완성 화면만 저장했습니다.");
      return { ok: true, dryRun: true, screenshot: screenshotPath, droppedImageCount: droppedImages.length };
    }

    // ⑨ 다시 한 번 닫기 — 스크린샷 이후 재차 열렸을 수 있다
    await closeOverlays(page, realFrame);

    // ⑩ 발행 버튼 클릭
    const openedPublish = await clickAnywhere(page, realFrame, EDITOR.publishOpen);
    if (!openedPublish) {
      const shot = await saveFailureShot(page, input.jobId, "publish-button-not-found");
      return { ok: false, error: "발행 버튼을 찾지 못했습니다.", screenshot: shot };
    }
    await page.waitForTimeout(500);

    // ⑪ 공개 범위 선택 + input.checked로 확인. 확인되지 않으면 발행하지 말고 중단한다.
    // (네이버 발행 레이어의 기본값은 전체공개다.)
    const visibilityConfirmed = await setVisibility(page, realFrame, input.visibility);
    if (!visibilityConfirmed) {
      const shot = await saveFailureShot(page, input.jobId, "visibility-not-confirmed");
      return {
        ok: false,
        error: `공개 범위(${input.visibility})를 선택했는지 확인할 수 없어 발행을 중단했습니다. (네이버 기본값은 전체공개입니다 — 7-19)`,
        screenshot: shot,
      };
    }
    log(input, `공개 범위 "${input.visibility}" 확인됨 — 발행을 계속합니다.`);

    // ⑫ 최종 확인 버튼
    const confirmed = await clickAnywhere(page, realFrame, EDITOR.publishConfirm);
    if (!confirmed) {
      const shot = await saveFailureShot(page, input.jobId, "publish-confirm-not-found");
      return { ok: false, error: "발행 최종 확인 버튼을 찾지 못했습니다.", screenshot: shot };
    }

    // ⑬ 실제 발행 검증 — URL이 게시글 주소로 바뀌는지 20초 폴링 (7-11)
    const deadline = Date.now() + 20_000;
    let publishedUrl: string | null = null;
    while (Date.now() < deadline) {
      const url = page.url();
      if (isPublishedUrl(url)) {
        publishedUrl = url;
        break;
      }
      await page.waitForTimeout(500);
    }

    if (!publishedUrl) {
      const shot = await saveFailureShot(page, input.jobId, "publish-not-confirmed");
      return {
        ok: false,
        error: "발행 버튼을 눌렀지만 게시글 주소로 이동하지 않았습니다. 글은 임시저장 상태로 남아 있을 수 있습니다.",
        screenshot: shot,
      };
    }

    return { ok: true, dryRun: false, blogUrl: publishedUrl, screenshot: screenshotPath, droppedImageCount: droppedImages.length };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const shot = page ? await saveFailureShot(page, input.jobId, "unexpected-error").catch(() => undefined) : undefined;
    return { ok: false, error: `예상치 못한 오류: ${message}`, screenshot: shot };
  } finally {
    await context.close();
    await browser.close();
  }
}

// 에디터는 iframe#mainFrame 안에 있다. page.frameLocator(EDITOR.frame)로 접근한다.
async function resolveFrame(page: Page): Promise<FrameLocator | null> {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    if ((await page.locator(EDITOR.frame).count()) > 0) {
      return page.frameLocator(EDITOR.frame);
    }
    await page.waitForTimeout(300);
  }
  return null;
}

async function saveFailureShot(page: Page, jobId: number, tag: string): Promise<string> {
  const p = path.join(DIRS.screenshots, `job-${jobId}-fail-${tag}.png`);
  try {
    await page.screenshot({ path: p, fullPage: true });
  } catch {
    // 스크린샷조차 실패하면 무시 — 에러 메시지가 우선
  }
  return p;
}

export const __internal = { firstVisible, clickFirstVisible, clickAnywhere, isPublishedUrl };
