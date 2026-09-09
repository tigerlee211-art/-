import path from "node:path";
import fs from "node:fs";
import crypto from "node:crypto";
import type { BrowserContext, Page } from "playwright";
import { newContext } from "@/lib/playwright";
import { judgeCrawledImage } from "@/lib/ai/vision";
import { getDb } from "@/lib/db";
import { DIRS } from "@/lib/paths";
import type { VisionVerdict } from "@/lib/types";

const MIN_BYTES = 3000; // 3000바이트 미만이면 버림(아이콘/깨진 이미지)
const BAD_SRC = /sprite|logo|icon|blank|\.svg/i;
const MIN_WIDTH = 120;

type RawImg = { src: string; w: number };

async function collectFromPage(page: Page, url: string, maxCount: number): Promise<string[]> {
  await page.goto(url, { waitUntil: "domcontentloaded" });
  // lazy 로딩 유도를 위해 한 번 스크롤
  await page.mouse.wheel(0, 2200);
  await page.waitForTimeout(600);

  const raw: RawImg[] = await page.evaluate(() =>
    [...document.querySelectorAll("img")].map((img) => ({
      src: (img as HTMLImageElement).currentSrc || (img as HTMLImageElement).src,
      w: (img as HTMLImageElement).naturalWidth,
    })),
  );

  const seen = new Set<string>();
  const out: string[] = [];
  for (const r of raw) {
    if (!r.src || r.w < MIN_WIDTH || BAD_SRC.test(r.src) || seen.has(r.src)) continue;
    seen.add(r.src);
    out.push(r.src);
    if (out.length >= maxCount) break;
  }
  return out;
}

async function collectCandidates(page: Page, query: string, maxCount: number): Promise<{ url: string; site: "naver" | "google" }[]> {
  const naverUrl = `https://search.naver.com/search.naver?where=image&query=${encodeURIComponent(query)}`;
  const naverUrls = await collectFromPage(page, naverUrl, maxCount);
  if (naverUrls.length > 0) {
    return naverUrls.map((url) => ({ url, site: "naver" as const }));
  }
  // 실패 시 구글로 폴백
  const googleUrl = `https://www.google.com/search?tbm=isch&q=${encodeURIComponent(query)}`;
  const googleUrls = await collectFromPage(page, googleUrl, maxCount);
  return googleUrls.map((url) => ({ url, site: "google" as const }));
}

async function download(context: BrowserContext, url: string): Promise<Buffer | null> {
  try {
    const res = await context.request.get(url, { timeout: 15000 });
    if (!res.ok()) return null;
    const buf = await res.body();
    if (buf.length < MIN_BYTES) return null;
    return buf;
  } catch {
    return null;
  }
}

function extFromUrl(url: string): string {
  const m = url.match(/\.(jpg|jpeg|png|webp|gif)(\?|$)/i);
  return m ? m[1]!.toLowerCase() : "jpg";
}

// 탈락 사유를 사람이 읽을 사유 문자열로 변환 — DB에 남겨 사용자가 필터가 실제로 동작하는지
// 확인할 수 있는 유일한 통로 (6-6).
function reasonLabel(v: VisionVerdict): string {
  if (v.reason.startsWith("판정 실패")) return v.reason;
  if (v.watermark) return "워터마크";
  if (v.koreanPerson) return "국내 인물(초상권)";
  if (!v.fit) return "주제 불일치";
  return v.reason;
}

function recordImage(row: {
  jobId: number;
  draftId: number | null;
  query: string;
  srcUrl: string;
  localPath: string | null;
  sourceSite: "naver" | "google";
  verdictOk: boolean;
  verdictReason: string;
  sectionIndex: number;
}) {
  getDb()
    .prepare(
      `INSERT INTO images (job_id, draft_id, query, src_url, local_path, source_site, verdict_ok, verdict_reason, section_index)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      row.jobId,
      row.draftId,
      row.query,
      row.srcUrl,
      row.localPath,
      row.sourceSite,
      row.verdictOk ? 1 : 0,
      row.verdictReason,
      row.sectionIndex,
    );
}

export type FindImageResult = { ok: true; localPath: string } | { ok: false; reason: string };

// 한 자리(query)당: 네이버 이미지 검색 → 실패 시 구글 → 후보를 하나씩 다운로드 →
// AI가 직접 보고 판정 → 첫 통과 이미지 채택.
export async function findImageForQuery(
  page: Page,
  context: BrowserContext,
  jobId: number,
  draftId: number | null,
  sectionIndex: number,
  query: string,
  imageCandidates: number,
): Promise<FindImageResult> {
  const candidates = await collectCandidates(page, query, imageCandidates);

  for (const c of candidates) {
    const buf = await download(context, c.url);
    if (!buf) {
      recordImage({
        jobId,
        draftId,
        query,
        srcUrl: c.url,
        localPath: null,
        sourceSite: c.site,
        verdictOk: false,
        verdictReason: "다운로드 실패(3000바이트 미만 또는 오류)",
        sectionIndex,
      });
      continue;
    }

    const ext = extFromUrl(c.url);
    const fileName = `${jobId}_${sectionIndex}_${crypto.randomBytes(4).toString("hex")}.${ext}`;
    const localPath = path.join(DIRS.images, fileName);
    fs.writeFileSync(localPath, buf);

    const verdict = await judgeCrawledImage(localPath, query);
    if (verdict.fit) {
      recordImage({
        jobId,
        draftId,
        query,
        srcUrl: c.url,
        localPath,
        sourceSite: c.site,
        verdictOk: true,
        verdictReason: verdict.reason,
        sectionIndex,
      });
      return { ok: true, localPath };
    }

    // 탈락 — 파일은 지우고 사유만 DB에 남긴다
    fs.rmSync(localPath, { force: true });
    recordImage({
      jobId,
      draftId,
      query,
      srcUrl: c.url,
      localPath: null,
      sourceSite: c.site,
      verdictOk: false,
      verdictReason: reasonLabel(verdict),
      sectionIndex,
    });
  }

  return { ok: false, reason: `후보 ${candidates.length}개 전부 탈락(워터마크/초상권/주제불일치/다운로드 실패)` };
}

export async function withImageBrowser<T>(fn: (page: Page, context: BrowserContext) => Promise<T>): Promise<T> {
  const { browser, context } = await newContext({ headless: true, useNaverSession: false });
  try {
    const page = await context.newPage();
    return await fn(page, context);
  } finally {
    await context.close();
    await browser.close();
  }
}
