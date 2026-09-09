import fs from "node:fs";
import path from "node:path";
import { z } from "zod";
import { runClaude, runClaudeJson } from "@/lib/claude";
import { expandHome } from "@/lib/paths";
import type { Section } from "@/lib/types";

const PHOTO_EXT = /\.(jpe?g|png|webp|heic)$/i;

export type LocalPhoto = { path: string; name: string };

// 파일명 자연순 정렬. ~는 $HOME으로 확장한다.
export function listLocalPhotos(folder: string): LocalPhoto[] {
  const dir = expandHome(folder);
  const files = fs.readdirSync(dir).filter((f) => PHOTO_EXT.test(f));
  files.sort((a, b) => a.localeCompare(b, "ko", { numeric: true }));
  return files.map((f) => ({ path: path.join(dir, f), name: f }));
}

// ⚠️ 6-8/6-10: 사진 설명은 본문 생성 전에 한 번만 만들고, 그 결과를 프롬프트(photoHintFor)와
// 배치(placeLocalPhotos) 양쪽에 재사용해야 한다. 두 번 만들면 claude 호출이 배로 든다.
export async function describeLocalPhotos(photos: LocalPhoto[]): Promise<string[]> {
  const descs: string[] = [];
  for (const p of photos) {
    const res = await runClaude("이 사진을 블로그 캡션처럼 30자 이내 한 줄로 설명해줘. 다른 말은 하지 마.", {
      images: [p.path],
    });
    descs.push(res.ok ? res.text.trim().slice(0, 60) : "(설명 생성 실패)");
  }
  return descs;
}

const MatchSchema = z.object({ order: z.array(z.number()) });

// order 방식: 글 흐름 순서대로 순차 배치.
// ai 방식: 사진 설명과 각 이미지 자리의 캡션/설명을 매칭. 매칭 실패·누락분은 순서대로 채우는 폴백을 둔다.
export async function placeLocalPhotos(
  photos: LocalPhoto[],
  descs: string[],
  sections: Section[],
  mode: "order" | "ai",
): Promise<string[]> {
  const imageSections = sections.filter((s): s is Extract<Section, { type: "image" }> => s.type === "image");
  const n = imageSections.length;

  if (mode === "order" || photos.length === 0) {
    return imageSections.map((_, idx) => photos[idx]?.path).filter((p): p is string => Boolean(p));
  }

  const result: (string | null)[] = new Array(n).fill(null);
  const used = new Set<number>();

  const prompt = `
아래는 자리(사진이 들어갈 위치)의 설명 목록과, 사용 가능한 사진들의 설명 목록이다.
각 자리에 가장 잘 어울리는 사진의 번호(0부터 시작하는 인덱스)를 순서대로 골라라. 한 사진은 한 자리에만 쓸 수 있다.

자리 목록:
${imageSections.map((s, i) => `${i}. ${s.caption ?? s.query}`).join("\n")}

사진 목록:
${descs.map((d, i) => `${i}. ${d}`).join("\n")}

응답 형식: { "order": [자리0에 쓸 사진번호, 자리1에 쓸 사진번호, ...] } (배열 길이는 자리 개수와 같아야 한다)
`.trim();

  const res = await runClaudeJson(prompt, MatchSchema, { retries: 1 });
  if (res.ok) {
    res.data.order.forEach((photoIdx, sectionIdx) => {
      if (sectionIdx >= n) return;
      if (photoIdx >= 0 && photoIdx < photos.length && !used.has(photoIdx)) {
        result[sectionIdx] = photos[photoIdx]!.path;
        used.add(photoIdx);
      }
    });
  }

  // 매칭 실패·누락분은 순서대로 채우는 폴백
  for (let i = 0; i < n; i++) {
    if (result[i]) continue;
    const nextIdx = photos.findIndex((_, pi) => !used.has(pi));
    if (nextIdx === -1) break;
    result[i] = photos[nextIdx]!.path;
    used.add(nextIdx);
  }

  return result.filter((p): p is string => Boolean(p));
}
