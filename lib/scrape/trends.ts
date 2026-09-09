import type { Page } from "playwright";
import { newContext } from "@/lib/playwright";

export type ScrapedSource = {
  type: "news" | "blog";
  title: string;
  summary: string;
  url: string;
};

type RawAnchor = { href: string; text: string; containerText: string };

// ⚠️ 6-4: 네이버 검색 DOM은 자주 바뀐다. 셀렉터에 의존하지 말고 page.evaluate 안에서
// 모든 a[href]를 훑는 일반 추출로 구현한다.
async function extractAnchors(page: Page): Promise<RawAnchor[]> {
  return page.evaluate(() => {
    const anchors = [...document.querySelectorAll("a[href]")];
    return anchors.map((a) => {
      const el = a as HTMLAnchorElement;
      const container = el.closest("li, div");
      return {
        href: el.href,
        text: el.textContent ?? "",
        containerText: container?.textContent ?? "",
      };
    });
  });
}

const NOISE_TEXT = /광고|로그인|더보기|바로가기|언론사 선정|구독/;
// ⚠️ 7-1과 같은 부분일치 계열 함정: /news/ 조건에 네이버 고객센터(help.naver.com/alias/news/...)가
// 걸린다. help.naver.com / /alias/ 를 제외 목록에 넣는다.
const HELP_DOMAIN = /help\.naver\.com|\/alias\//;
const NEWS_PATTERN = /news\.naver\.com|\/news\/|n\.news/;
const BLOG_POST_PATTERN = /blog\.naver\.com\/[^/]+\/\d{6,}/;
// 스크린리더용 보조 텍스트. 길이 필터(8자)를 그냥 통과하므로 노이즈 필터보다 먼저 제거해야 한다.
const A11Y_NOISE = /새\s*창\s*열림/g;

function cleanText(raw: string): string {
  return raw.replace(A11Y_NOISE, "").trim();
}

function toSources(anchors: RawAnchor[], type: "news" | "blog"): ScrapedSource[] {
  const pattern = type === "news" ? NEWS_PATTERN : BLOG_POST_PATTERN;
  const candidates: ScrapedSource[] = [];

  for (const a of anchors) {
    if (HELP_DOMAIN.test(a.href)) continue;
    if (!pattern.test(a.href)) continue;

    const title = cleanText(a.text);
    if (title.length < 8) continue;
    if (NOISE_TEXT.test(title)) continue;

    const containerText = cleanText(a.containerText);
    const summary = containerText.startsWith(title) ? containerText.slice(title.length) : containerText;

    candidates.push({ type, title, summary: summary.trim().slice(0, 260), url: a.href });
  }

  // 같은 기사가 [제목 링크] + [본문 스니펫 링크]로 두 번 잡힌다.
  // URL당 하나만 남기되 제목이 더 짧은 쪽을 고른다(스니펫은 길고 문장형).
  const byUrl = new Map<string, ScrapedSource>();
  for (const c of candidates) {
    const existing = byUrl.get(c.url);
    if (!existing || c.title.length < existing.title.length) {
      byUrl.set(c.url, c);
    }
  }

  // 제목 앞 40자를 키로 중복 제거
  const byTitlePrefix = new Map<string, ScrapedSource>();
  for (const c of byUrl.values()) {
    const key = c.title.slice(0, 40);
    if (!byTitlePrefix.has(key)) byTitlePrefix.set(key, c);
  }

  return [...byTitlePrefix.values()];
}

async function scrapeSearch(page: Page, keyword: string, where: "news" | "blog"): Promise<ScrapedSource[]> {
  const params = new URLSearchParams({ where, query: keyword });
  if (where === "news") params.set("sort", "1");
  const url = `https://search.naver.com/search.naver?${params.toString()}`;
  await page.goto(url, { waitUntil: "domcontentloaded" });
  const anchors = await extractAnchors(page);
  return toSources(anchors, where);
}

export async function collectTrends(
  keyword: string,
  scrapeTopN: number,
): Promise<{ news: ScrapedSource[]; blog: ScrapedSource[]; combined: ScrapedSource[] }> {
  const { browser, context } = await newContext({ headless: true, useNaverSession: false });
  try {
    const page = await context.newPage();
    const news = await scrapeSearch(page, keyword, "news");
    const blog = await scrapeSearch(page, keyword, "blog");
    const combined = [...news, ...blog].slice(0, scrapeTopN);
    return { news, blog, combined };
  } finally {
    await context.close();
    await browser.close();
  }
}

// 순수 함수로 분리 — 실제 페이지 없이도(테스트에서) 앵커 배열만으로 필터링 로직을 검증할 수 있게 한다.
export const __internal = { toSources, cleanText, NOISE_TEXT, HELP_DOMAIN, NEWS_PATTERN, BLOG_POST_PATTERN };
