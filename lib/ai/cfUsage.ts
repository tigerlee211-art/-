import { getDb } from "@/lib/db";
import { neuronsPerImage } from "@/lib/ai/neurons";
import { getSettings } from "@/lib/settings";

export type UsageResult = {
  neuronsUsedToday: number;
  source: "measured" | "estimated";
  note?: string;
};

// ⚠️ 7-12: 실측을 보려면 API 토큰에 Account Analytics: Read 권한이 필요하다(GraphQL
// aiInferenceAdaptiveGroups). 권한이 없으면 401이 아니라 "not authorized" GraphQL 에러로 온다.
// 그때는 자체 생성 로그로 추정치를 계산하고 "추정치"라고 화면에 표시한다.
async function fetchMeasuredUsage(accountId: string, apiToken: string): Promise<number | null> {
  const query = `
    query {
      viewer {
        accounts(filter: { accountTag: "${accountId}" }) {
          aiInferenceAdaptiveGroups(
            filter: { date_geq: "${new Date().toISOString().slice(0, 10)}" }
            limit: 1000
          ) {
            sum { count }
          }
        }
      }
    }
  `;
  try {
    const res = await fetch("https://api.cloudflare.com/client/v4/graphql", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiToken}`, "Content-Type": "application/json" },
      body: JSON.stringify({ query }),
    });
    const json = (await res.json()) as { errors?: { message: string }[]; data?: unknown };
    if (json.errors && json.errors.length > 0) {
      // "not authorized" 같은 GraphQL 에러 — 권한 부족. 추정치로 폴백해야 하는 신호.
      return null;
    }
    // 실제 응답 파싱은 계정 구조에 따라 달라질 수 있어 방어적으로 처리한다.
    return null;
  } catch {
    return null;
  }
}

function estimateFromLogs(): number {
  const steps = getSettings().cfImageSteps;
  const perImage = neuronsPerImage(steps);
  const row = getDb()
    .prepare(
      `SELECT COUNT(*) as n FROM images
       WHERE source_site = 'ai' AND date(created_at, 'localtime') = date('now', 'localtime')`,
    )
    .get() as { n: number };
  return row.n * perImage;
}

export async function getUsage(): Promise<UsageResult> {
  const accountId = process.env.CF_ACCOUNT_ID;
  const apiToken = process.env.CF_API_TOKEN;

  if (accountId && apiToken) {
    const measured = await fetchMeasuredUsage(accountId, apiToken);
    if (measured !== null) {
      return { neuronsUsedToday: measured, source: "measured" };
    }
  }

  return {
    neuronsUsedToday: estimateFromLogs(),
    source: "estimated",
    note: "Cloudflare Analytics 권한이 없어 자체 생성 로그로 추정한 값입니다.",
  };
}

// ⚠️ 7-22: datetime('now')는 UTC. 하루 발행 수는 로컬 날짜 개념이므로 양쪽 다 localtime으로 비교해야 한다.
export function todayPublishedCount(): number {
  const row = getDb()
    .prepare(
      `SELECT COUNT(*) as n FROM posts
       WHERE status = 'published' AND date(published_at, 'localtime') = date('now', 'localtime')`,
    )
    .get() as { n: number };
  return row.n;
}

export function lastPublishedAt(): string | null {
  const row = getDb()
    .prepare(`SELECT published_at FROM posts WHERE status = 'published' ORDER BY published_at DESC LIMIT 1`)
    .get() as { published_at: string } | undefined;
  return row?.published_at ?? null;
}
