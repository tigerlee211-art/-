import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { listLocalPhotos, placeLocalPhotos } from "@/lib/localPhotos";
import type { Section } from "@/lib/types";

// ===== 자연순 정렬 확인 =====
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "photos-"));
const names = ["사진10.jpg", "사진2.jpg", "사진1.jpg", "not_a_photo.txt", "readme.md"];
for (const n of names) fs.writeFileSync(path.join(dir, n), "x");

const listed = listLocalPhotos(dir);
const listedNames = listed.map((p) => p.name);
if (listedNames.includes("not_a_photo.txt") || listedNames.includes("readme.md")) {
  throw new Error("확장자 필터 실패: 사진이 아닌 파일이 포함됨: " + JSON.stringify(listedNames));
}
if (JSON.stringify(listedNames) !== JSON.stringify(["사진1.jpg", "사진2.jpg", "사진10.jpg"])) {
  throw new Error(`자연순 정렬 실패: ${JSON.stringify(listedNames)}`);
}
console.log("✅ 파일명 자연순 정렬 확인 (사진1 < 사진2 < 사진10), 비사진 확장자 제외 확인:", listedNames);

// ===== order 배치: 글 흐름 순서대로 순차 배치 =====
const sections: Section[] = [
  { type: "heading", text: "제목" },
  { type: "image", query: "사진1 설명" },
  { type: "paragraph", text: "본문" },
  { type: "image", query: "사진2 설명" },
];
const photos = [
  { path: "/a/1.jpg", name: "1.jpg" },
  { path: "/a/2.jpg", name: "2.jpg" },
];
const ordered = await placeLocalPhotos(photos, ["설명1", "설명2"], sections, "order");
if (JSON.stringify(ordered) !== JSON.stringify(["/a/1.jpg", "/a/2.jpg"])) {
  throw new Error("order 배치 실패: " + JSON.stringify(ordered));
}
console.log("✅ order 배치: 사진이 글 흐름 순서대로 순차 배치됨");

fs.rmSync(dir, { recursive: true, force: true });
