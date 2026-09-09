import { stripMarkdown, splitForTyping } from "@/lib/naver/textFormat";

// ===== 7-8: 마크다운 무력화 =====
const md = "이건 **중요**하고 ~~취소~~고 `코드`도 있고 ~진짜~ 그렇습니다.\n# 제목\n> 인용\n- 목록";
const cleaned = stripMarkdown(md);
if (/\*\*|`|^#|^>|^-/m.test(cleaned)) throw new Error("마크다운 기호가 남음: " + cleaned);
if (!cleaned.includes("～진짜～")) throw new Error("물결표가 전각으로 안 바뀜: " + cleaned);
console.log("✅ stripMarkdown: 마크다운 기호 전부 제거/무력화 확인:", JSON.stringify(cleaned));

// ===== 7-25: VS16 이모지 분리 =====
const text = "[⚠️]";
const chunks = splitForTyping(text);
const rebuilt = chunks.map((c) => c.text).join("");
if (rebuilt !== text) throw new Error(`분해 후 재조립 불일치: ${rebuilt} !== ${text}`);
const vs16Chunk = chunks.find((c) => c.mode === "insertText");
if (!vs16Chunk || !vs16Chunk.text.includes("⚠")) throw new Error("VS16 클러스터가 insertText 모드로 분리되지 않음: " + JSON.stringify(chunks));
const otherChunks = chunks.filter((c) => c.mode === "type");
if (otherChunks.some((c) => c.text.includes("⚠"))) throw new Error("이모지가 type 모드 조각에도 섞여 있음(중복 위험)");
console.log("✅ splitForTyping: VS16 클러스터만 insertText로 분리, 나머지는 type 유지:", JSON.stringify(chunks));

// 이모지가 없는 일반 텍스트는 전부 type 모드 하나여야 함
const plain = splitForTyping("평범한 한글 문장입니다");
if (plain.length !== 1 || plain[0]!.mode !== "type") throw new Error("일반 텍스트가 불필요하게 쪼개짐: " + JSON.stringify(plain));
console.log("✅ 이모지 없는 텍스트는 쪼개지지 않고 그대로 type");

// 여러 이모지가 섞인 문장
const multi = "오늘 ☀️ 날씨가 좋아서 ❤️ 산책했어요 1️⃣";
const multiChunks = splitForTyping(multi);
if (multiChunks.map((c) => c.text).join("") !== multi) throw new Error("복수 이모지 재조립 실패");
const insertCount = multiChunks.filter((c) => c.mode === "insertText").length;
if (insertCount !== 3) throw new Error(`복수 이모지 클러스터 개수 기대 3, 실제 ${insertCount}: ` + JSON.stringify(multiChunks));
console.log(`✅ 복수 VS16 이모지(☀️❤️1️⃣) 개별 클러스터로 분리 확인 (${insertCount}개)`);
