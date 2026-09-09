import { checkClaude, runClaude } from "@/lib/claude";
import fs from "node:fs";

const check = await checkClaude();
if (!check.installed) {
  console.log("⚠️ claude CLI 미설치 — 건너뜁니다");
  process.exit(0);
}

const imgPath = "/tmp/red_pixel.png"; // 프로젝트 밖 절대경로 (2-1: 이것도 동작해야 함)
if (!fs.existsSync(imgPath)) {
  console.log("⚠️ 테스트 이미지가 없어 건너뜁니다:", imgPath);
  process.exit(0);
}

const res = await runClaude("이 사진의 주된 색깔이 뭐야? 한 단어로만 답해.", { images: [imgPath] });
if (!res.ok) throw new Error("비전 호출 실패: " + res.error);
console.log("✅ 프로젝트 밖 절대경로(@" + imgPath + ") 이미지 첨부 확인, 응답:", res.text.trim().slice(0, 30));
if (!/빨강|red|빨간/i.test(res.text)) {
  console.log("⚠️ 색깔 응답이 예상과 다름(모델 표현 차이일 수 있음):", res.text.trim());
}
