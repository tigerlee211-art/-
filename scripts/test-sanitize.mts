import { sanitizeDraft } from "@/lib/ai/content";
import type { Draft } from "@/lib/types";

const draft: Draft = {
  title: "테스트",
  sections: [
    { type: "paragraph", text: "옆 사이트는 한 시간째 폴대와 씨름 중이더라고요.", highlight: "예쁜 것보다 빨리 펴지는 게 훨씬 중요합니다" },
    { type: "paragraph", text: "그래서 저희는 이 텐트를 골랐습니다.", highlight: "이 텐트를 골랐습니다" },
  ],
};

const { draft: cleaned, droppedHighlights } = sanitizeDraft(draft);
if (droppedHighlights !== 1) throw new Error(`기대 1개 드랍, 실제 ${droppedHighlights}`);
const p0 = cleaned.sections[0];
if (p0!.type === "paragraph" && "highlight" in p0! && p0.highlight) {
  throw new Error("본문에 없는 highlight가 제거되지 않음");
}
const p1 = cleaned.sections[1];
if (!(p1!.type === "paragraph" && p1.highlight === "이 텐트를 골랐습니다")) {
  throw new Error("본문에 있는 정상 highlight가 잘못 제거됨");
}
console.log("✅ sanitizeDraft: 본문에 없는 highlight만 제거, 정상 highlight는 유지 (7-24)");
