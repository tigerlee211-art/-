import { z } from "zod";
import { checkClaude, runClaude, runClaudeJson } from "@/lib/claude";

const check = await checkClaude();
if (!check.installed) {
  console.log("⚠️ claude CLI 미설치 — 이 스크립트를 건너뜁니다:", check.error);
  process.exit(0);
}
console.log("✅ checkClaude():", check.version);

const r1 = await runClaude("숫자 42 를 그대로만 출력해. 다른 말은 하지 마.");
if (!r1.ok) throw new Error("runClaude 실패: " + r1.error);
if (!r1.text.includes("42")) throw new Error("runClaude 응답에 42가 없음: " + r1.text);
console.log("✅ runClaude 기본 호출 확인:", r1.text.trim().slice(0, 50));

// 긴 한글 프롬프트 (2000자 이상)가 stdin으로 안전하게 전달되는지 (argv였다면 escaping이 깨짐)
const longPrompt =
  "다음 문장 끝에 있는 단어 하나만 정확히 출력해. 다른 말은 절대 하지 마.\n" +
  "이건 " + "가나다라마바사아자차카타파하 ".repeat(220) + " 끝단어입니다.";
if (longPrompt.length < 2000) throw new Error("테스트 프롬프트가 2000자 미만");
const r2 = await runClaude(longPrompt);
if (!r2.ok) throw new Error("긴 프롬프트 실패: " + r2.error);
console.log(`✅ 긴 한글 프롬프트(${longPrompt.length}자) 처리 확인:`, r2.text.trim().slice(0, 50));

const Schema = z.object({ answer: z.number() });
const r3 = await runClaudeJson(
  "1+1은 몇이야? {\"answer\": 숫자} 형태의 JSON으로만 답해.",
  Schema,
);
if (!r3.ok) throw new Error("runClaudeJson 실패: " + r3.error);
if (r3.data.answer !== 2) throw new Error("runClaudeJson 답이 틀림: " + r3.data.answer);
console.log("✅ runClaudeJson 기본 구조화 출력 확인:", r3.data);

// AI가 코드펜스를 붙여도 파싱되는지
const r4 = await runClaudeJson(
  "1+2는 몇이야? 답을 ```json 코드펜스로 감싸서 {\"answer\": 숫자} 형태로 줘. 설명도 위아래에 덧붙여도 돼.",
  Schema,
);
if (!r4.ok) throw new Error("코드펜스 포함 응답 파싱 실패: " + r4.error);
if (r4.data.answer !== 3) throw new Error("코드펜스 파싱 답이 틀림: " + r4.data.answer);
console.log("✅ 코드펜스 포함 JSON 파싱 확인:", r4.data);

console.log("\n(이미지 첨부 테스트는 실제 이미지 파일이 있어야 하므로 test-vision-optional.mts 에서 별도 확인)");
