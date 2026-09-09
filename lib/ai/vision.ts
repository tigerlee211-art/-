import { runClaudeJson } from "@/lib/claude";
import { VisionVerdictSchema, GenVerdictSchema, type VisionVerdict, type GenVerdict } from "@/lib/types";

// ===== 6-6: 크롤링 사진 판정 =====
// 세 축을 따로 묻는다: fit / watermark / koreanPerson.
export async function judgeCrawledImage(imagePath: string, sectionQuery: string): Promise<VisionVerdict> {
  const prompt = `
이 사진이 블로그 글의 "${sectionQuery}" 자리에 들어갈 사진 후보다. 아래 세 가지를 각각 판단해 JSON으로 답하라.

- watermark: 워터마크·사이트 로고·저작권 표기·서명·스톡 출처표시가 조금이라도 보이면 true. 의심스러우면 true.
- koreanPerson: 한국인 얼굴이 식별 가능하면 true(초상권 위험). 얼굴이 안 보이거나(뒷모습·손·실루엣) 명백한 외국인 스톡이면 false. 애매하면 true(안전한 쪽으로).
- fit: watermark와 koreanPerson이 모두 문제없다는 전제에서, 이 사진이 "${sectionQuery}" 주제·위치에 어울리는지.
- reason: 판단 근거를 한 문장으로.

응답 형식: { "fit": boolean, "watermark": boolean, "koreanPerson": boolean, "reason": "..." }
`.trim();

  const res = await runClaudeJson(prompt, VisionVerdictSchema, { images: [imagePath], retries: 1 });

  // ⚠️ 판정 호출이 실패했을 때 그 이미지를 채택하면 안 된다. claude 한도 초과가
  // "검증 안 된 이미지 통과"로 이어지지 않도록 fit:false로 처리한다.
  if (!res.ok) {
    return { fit: false, watermark: false, koreanPerson: false, reason: `판정 실패: ${res.error}` };
  }

  const verdict = res.data;
  // watermark || koreanPerson 이면 fit을 강제로 false로 덮어쓴다. AI가 fit=true로 답해도 무시한다.
  if (verdict.watermark || verdict.koreanPerson) {
    return { ...verdict, fit: false };
  }
  return verdict;
}

// ===== 6-7 / 7-13: AI 생성물 검증 =====
// 생성물에는 워터마크도 초상권도 없다. 크롤링용 판정함수(koreanPerson 필터 포함)를
// 재사용하면 멀쩡한 생성 이미지가 탈락한다. 별도 함수로 "주제 불일치/형태 깨짐/글자 혼입/저품질"
// 네 가지만 본다.
export async function judgeGeneratedImage(imagePath: string, sectionQuery: string): Promise<GenVerdict> {
  const prompt = `
이 이미지는 블로그 글의 "${sectionQuery}" 자리에 쓰려고 AI로 생성한 것이다. 아래 네 가지 문제만 확인해 JSON으로 답하라.
(워터마크나 초상권은 생성물이라 해당 없음 — 판단하지 마라.)

- mismatch: 주제("${sectionQuery}")와 이미지 내용이 명백히 안 맞으면 true.
- broken: 형태가 깨졌거나(기형적인 손가락, 뒤틀린 사물, 비현실적 왜곡) 부자연스러우면 true.
- textArtifact: 이미지 안에 깨지거나 의미 없는 글자/문자가 보이면 true.
- lowQuality: 흐릿하거나 노이즈가 심해 저품질이면 true.
- ok: 위 네 가지가 전부 false일 때만 true.
- reason: 판단 근거 한 문장.

응답 형식: { "ok": boolean, "mismatch": boolean, "broken": boolean, "textArtifact": boolean, "lowQuality": boolean, "reason": "..." }
`.trim();

  const res = await runClaudeJson(prompt, GenVerdictSchema, { images: [imagePath], retries: 1 });
  if (!res.ok) {
    return { ok: false, mismatch: false, broken: false, textArtifact: false, lowQuality: false, reason: `판정 실패: ${res.error}` };
  }
  return res.data;
}
