// 타이핑 직전 텍스트 가공 — 순수 함수. Playwright 의존이 없어 브라우저 없이도 테스트할 수 있다.

// ===== 7-8: 스마트에디터가 마크다운을 자동 변환한다 =====
// ~~취소선~~, **굵게**, 줄머리 #·>·- 를 입력 중에 서식으로 바꾼다. 한국어 구어체의 물결표(~)가
// 특히 위험하다. AI에게 마크다운을 쓰지 말라고 지시하는 것만으로는 부족하므로 타이핑 직전에
// 코드로 무력화한다.
export function stripMarkdown(text: string): string {
  return text
    .replace(/~+/g, "～") // 전각 물결표로 (어감은 보존)
    .replace(/\*\*(.+?)\*\*/g, "$1")
    .replace(/__(.+?)__/g, "$1")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/^[ \t]*#{1,6}[ \t]+/gm, "")
    .replace(/^[ \t]*>[ \t]+/gm, "")
    .replace(/^[ \t]*[-*+][ \t]+/gm, "");
}

// ===== 7-25: VS16 이모지가 중복 입력된다 =====
// keyboard.type()으로 보내면 변이 선택자(VS16, U+FE0F)가 붙은 글자만 base 문자가 하나 더 남는다
// (⚠️ → ⚠⚠️). keyboard.insertText()로 문단 전체를 넣으면 이번엔 이모지 하나만 남고 나머지 글이
// 통째로 사라진다(실측). 정답은 VS16 클러스터만 잘라서 그 조각만 insertText, 나머지는 type.
// ⚠️ 실측 정규식 그대로 사용 — 눈에 안 보이는 유니코드 리터럴 대신 \u 이스케이프로 명시한다.
const HAS_VS16 = /️/;
const VS16_CLUSTER = /([\s\S]️⃣?)/; // ⚠️ ❤️ ✔️ ☀️ 1️⃣

export type TypeChunk = { text: string; mode: "type" | "insertText" };

export function splitForTyping(text: string): TypeChunk[] {
  const parts = text.split(VS16_CLUSTER).filter((p) => p.length > 0);
  return parts.map((part) => ({ text: part, mode: HAS_VS16.test(part) ? "insertText" : "type" }));
}
