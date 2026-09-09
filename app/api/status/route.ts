import { NextRequest, NextResponse } from "next/server";
import { checkClaude } from "@/lib/claude";
import { verifySession, hasSessionFile } from "@/lib/naver/session";
import { getSettings } from "@/lib/settings";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const refresh = req.nextUrl.searchParams.get("refresh") === "1";

  const [claude, session] = await Promise.all([
    checkClaude(),
    hasSessionFile() ? verifySession(refresh) : Promise.resolve({ valid: false as const, reason: "no_session" as const }),
  ]);

  return NextResponse.json({
    claude,
    naver: session,
    cloudflareConfigured: Boolean(process.env.CF_ACCOUNT_ID && process.env.CF_API_TOKEN),
    settings: getSettings(),
  });
}
