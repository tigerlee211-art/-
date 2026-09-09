import { NextRequest, NextResponse } from "next/server";
import fs from "node:fs";
import path from "node:path";
import { DATA_ROOT, isInsideData, normalizeForCompare } from "@/lib/paths";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const CONTENT_TYPES: Record<string, string> = {
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
  ".gif": "image/gif",
};

// ⚠️ 7-23: macOS의 process.cwd()는 한글을 NFD로 주는데 브라우저 URL 파라미터는 NFC다.
// 경로 비교 전에 양쪽 모두 normalize("NFC")해야 한다(isInsideData/normalizeForCompare가 처리).
export async function GET(req: NextRequest) {
  const raw = req.nextUrl.searchParams.get("path");
  if (!raw) return NextResponse.json({ error: "path 파라미터가 필요합니다." }, { status: 400 });

  const abs = path.isAbsolute(raw) ? raw : path.join(DATA_ROOT, raw);

  if (!isInsideData(abs)) {
    return NextResponse.json({ error: "허용되지 않은 경로입니다." }, { status: 403 });
  }

  const normalizedAbs = normalizeForCompare(abs);
  if (!fs.existsSync(normalizedAbs)) {
    // NFC로 못 찾으면 원본 abs로도 한 번 더 시도 (파일시스템이 NFD로 저장했을 수 있음)
    if (!fs.existsSync(abs)) {
      return NextResponse.json({ error: "파일을 찾을 수 없습니다." }, { status: 404 });
    }
  }
  const finalPath = fs.existsSync(normalizedAbs) ? normalizedAbs : abs;

  const stat = fs.statSync(finalPath);
  if (!stat.isFile()) {
    return NextResponse.json({ error: "파일이 아닙니다." }, { status: 400 });
  }

  const ext = path.extname(finalPath).toLowerCase();
  const contentType = CONTENT_TYPES[ext] ?? "application/octet-stream";
  const buf = fs.readFileSync(finalPath);

  return new NextResponse(new Uint8Array(buf), {
    headers: {
      "Content-Type": contentType,
      "Cache-Control": "private, max-age=3600",
    },
  });
}
