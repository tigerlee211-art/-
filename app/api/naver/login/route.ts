import { NextResponse } from "next/server";
import { loginInteractive, isLoginInFlight } from "@/lib/naver/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 600; // 로그인 창은 최대 5분까지 기다린다

export async function POST() {
  if (isLoginInFlight()) {
    return NextResponse.json({ error: "이미 로그인 창이 열려 있습니다." }, { status: 409 });
  }
  const result = await loginInteractive();
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: 400 });
  }
  return NextResponse.json({ ok: true });
}
