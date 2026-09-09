import type { PhotoSource } from "@/lib/types";

// ===== 6-5: photoHintFor — 사진 소스별로 AI에게 다른 지시를 준다 =====
export function photoHintFor(photoSource: PhotoSource, count: number, descs?: string[]): string {
  switch (photoSource) {
    case "none":
      return "사진 소스가 없습니다. image 섹션을 절대 만들지 마라 (0개).";
    case "local": {
      const list =
        descs && descs.length > 0
          ? descs.map((d, i) => `${i + 1}. ${d}`).join("\n")
          : "(사진 설명 없음 — 순서대로만 배치)";
      return [
        `사용자가 직접 준비한 사진이 정확히 ${count}장 있다. image 섹션을 정확히 ${count}개 만들어라(더 많거나 적으면 안 된다).`,
        `image 섹션의 query에는 검색어가 아니라, 그 자리에 어떤 사진이 와야 하는지 설명을 써라.`,
        `사용 가능한 사진 목록(순서·설명):`,
        list,
      ].join("\n");
    }
    case "ai":
      return "image 섹션의 query에는 검색어가 아니라, 어떤 장면을 그려야 하는지 한국어로 구체적으로 묘사하라. 이미지 자리를 6~8개 배치하라.";
    case "crawl":
    default:
      return "image 섹션의 query에는 이미지 검색에 쓸 검색어를 써라. 이미지 자리를 6~8개 배치하라(일부는 적합한 사진을 못 찾을 수 있으므로 넉넉히). 검색어는 사람 얼굴이 주인공이 아닌 사물·풍경·클로즈업·손동작 위주로.";
  }
}

// ===== 6-5: 공통 작성 규칙 =====
export const BASE_WRITING_RULES = `
- 수집 자료를 참고하되 문장을 그대로 베끼지 말 것.
- 사람이 쓴 듯한 자연스러운 구어체로 쓸 것. AI 티 나는 상투적 표현(따라서, 결론적으로, ~라고 할 수 있습니다 등) 금지.
- 도입(공감/후킹) → 본문(소제목 2~4구획) → 마무리(요약/행동유도) 구조.
- highlight는 문단당 최대 1개, 전체 문단의 30% 정도만 지정할 것. highlight는 반드시 그 문단 text 안에 등장하는 문구 그대로여야 한다. 본문에 없는 문구를 지어내지 말 것.
- 마크다운 기호(**, ~~, ~, #, >, 백틱 \`, 줄머리 - 목록)를 절대 쓰지 말 것. 순수 텍스트로만 작성.
`.trim();

export const SECTION_FORMAT_INSTRUCTION = `
응답은 오직 아래 JSON 형태로만 반환하라:
{
  "title": "글 제목",
  "sections": [
    { "type": "heading", "text": "소제목" },
    { "type": "paragraph", "text": "본문 문단", "highlight": "text 안에 글자 그대로 있는 핵심 구절(선택)" },
    { "type": "quote", "text": "인용구 한 줄" },
    { "type": "divider" },
    { "type": "image", "query": "이미지 자리 설명 또는 검색어", "caption": "사진 아래 짧은 설명(선택)" }
  ]
}
`.trim();

// ===== 6-5: 체험단 · 브랜딩 공통 =====
// 소제목을 heading이 아니라 quote로 만든다 — 실제 상위 노출 블로그들의 문법.
// quote는 짧은 한 줄(15~30자). 문단은 2~4줄로 짧게.
export const MODE_COMMON_RULES = `
- 소제목에 해당하는 자리는 "heading" 타입이 아니라 "quote" 타입으로 만들어라. quote의 text는 15~30자의 짧은 한 줄이어야 한다.
- 문단(paragraph)은 2~4줄 정도로 짧게 끊어 써라.
`.trim();

export const EXPERIENCE_TEMPLATE = `
1인칭 체험단 후기체로 써라.
- 철저히 1인칭("저희는", "~했어요", "~더라구요") 문체를 유지하라.
- "ㅎㅎ", "진짜" 같은 구어체 표현을 자연스럽게 섞어라.
- 도입부에서 결론(총평)을 살짝 흘려라.
- 실용정보를 구획별로 나눠 써라: 가는 법 / 웨이팅 / 가격 / 언제 갈지 / 주의점.
- 문단 1~2개마다 사진 1장이 나오는 리듬으로 image 섹션을 배치하라.
- 마무리는 총평 + 다시 간다면의 팁으로 끝내라.
${MODE_COMMON_RULES}
`.trim();

export const BRANDING_TEMPLATE = `
전문가 관점의 브랜딩·전문성 글을 "~입니다" 전문가체로 써라.
구조를 반드시 이 순서로 고정하라:
① 권위 선점(사용자가 제공한 실적 숫자로) ② 독자의 문제/오해 짚기 ③ 왜 기존 방법이 안 통하는지
④ 이름을 붙인 자체 프레임워크 제시 ⑤ 예상되는 반박에 대한 Q&A ⑥ 정리 + 행동 유도(CTA)
- 구획 전환마다 divider를 1~2회 넣어라.
- 숫자를 지어내지 마라 — 사용자가 준 핵심 내용 안에 있는 숫자만 사용하라.
${MODE_COMMON_RULES}
`.trim();
