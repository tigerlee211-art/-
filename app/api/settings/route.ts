import { NextRequest, NextResponse } from "next/server";
import { DEFAULT_SETTINGS, SETTING_LIMITS } from "@/config";
import { getSettings, updateSettings, resetSettings } from "@/lib/settings";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json({ settings: getSettings(), limits: SETTING_LIMITS });
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  if (!body || typeof body !== "object") {
    return NextResponse.json({ error: "잘못된 요청 본문입니다." }, { status: 400 });
  }

  if ((body as { reset?: boolean }).reset) {
    return NextResponse.json({ settings: resetSettings() });
  }

  const unknown = Object.keys(body).filter((k) => !(k in DEFAULT_SETTINGS));
  if (unknown.length > 0) {
    return NextResponse.json({ error: `알 수 없는 설정 키: ${unknown.join(", ")}` }, { status: 400 });
  }

  try {
    const settings = updateSettings(body);
    return NextResponse.json({ settings });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
