import { checkClaude } from "@/lib/claude";
import { generateIdeas, generateAutoDraft, generateModeDraft } from "@/lib/ai/content";
import type { ScrapedSource } from "@/lib/scrape/trends";

const check = await checkClaude();
if (!check.installed) {
  console.log("⚠️ claude CLI 미설치 — 건너뜁니다");
  process.exit(0);
}

const MD_CHARS = /(\*\*|~~|(?<![0-9:])~(?![0-9])|^#{1,6}\s|^>\s|`|^[-*+]\s)/m;

const sources: ScrapedSource[] = [
  {
    type: "news",
    title: "홈카페 원두 소비 급증, 20대 중심으로 확산",
    summary: "최근 집에서 커피를 내려마시는 홈카페族가 늘면서 원두 소비량이 전년 대비 30% 증가했다는 조사 결과가 나왔다.",
    url: "https://n.news.naver.com/article/000/0000000001",
  },
  {
    type: "blog",
    title: "홈카페 입문 3개월 후기, 드리퍼 고르는 법",
    summary: "처음엔 뭘 사야할지 몰라 헤맸는데 드리퍼 종류부터 정리해봤다. 하리오, 칼리타, 오리가미까지 비교.",
    url: "https://blog.naver.com/someone/223456789",
  },
];

// ===== 자동 발굴: 글감 5개 =====
const ideasRes = await generateIdeas("홈카페", sources, 5);
if (!ideasRes.ok) throw new Error("generateIdeas 실패: " + ideasRes.error);
if (ideasRes.ideas.length < 1) throw new Error("글감이 비어있음");
for (const idea of ideasRes.ideas) {
  if (!idea.title || !idea.angle || !idea.rationale) throw new Error("글감 필드 누락: " + JSON.stringify(idea));
}
console.log(`✅ generateIdeas: ${ideasRes.ideas.length}개 글감 생성, 1등: "${ideasRes.ideas[0]!.title}"`);

// ===== 자동 발굴 본문 (사진 없음 → image 섹션 0개여야 함) =====
const draftRes = await generateAutoDraft("홈카페", ideasRes.ideas[0]!, sources, { photoSource: "none" });
if (!draftRes.ok) throw new Error("generateAutoDraft 실패: " + draftRes.error);
const imgCount = draftRes.draft.sections.filter((s) => s.type === "image").length;
if (imgCount !== 0) throw new Error(`photoSource=none인데 이미지 섹션이 ${imgCount}개`);
const fullText = draftRes.draft.sections.map((s) => ("text" in s ? s.text : "")).join("\n");
if (MD_CHARS.test(fullText)) throw new Error("본문에 마크다운 기호가 섞임: " + fullText.slice(0, 200));
console.log(`✅ generateAutoDraft(none): 섹션 ${draftRes.draft.sections.length}개, 이미지 0개, 마크다운 없음, highlight 드랍 ${draftRes.droppedHighlights}개`);

// ===== 체험단 모드 (crawl → 이미지 6개 이상) =====
const expRes = await generateModeDraft(
  "experience",
  { topic: "강남 브런치 카페 방문 후기", keyPoints: "평일 오전 방문, 웨이팅 없음, 브런치 세트 18000원, 창가 자리 뷰가 좋음, 주차 불가" },
  { photoSource: "crawl" },
);
if (!expRes.ok) throw new Error("generateModeDraft(experience) 실패: " + expRes.error);
const expImgCount = expRes.draft.sections.filter((s) => s.type === "image").length;
if (expImgCount < 6) throw new Error(`crawl인데 이미지 섹션이 ${expImgCount}개 (6개 이상이어야 함)`);
console.log(`✅ generateModeDraft(experience, crawl): 섹션 ${expRes.draft.sections.length}개, 이미지 ${expImgCount}개(6+ 확인)`);

// ===== local 사진 3장 → 정확히 3개 =====
const localRes = await generateModeDraft(
  "branding",
  { topic: "1인 마케팅 컨설턴트 브랜딩", keyPoints: "3년간 42개 브랜드 컨설팅, 평균 매출 22% 증가, 저서 1권 출간" },
  { photoSource: "local", photoCount: 3, photoDescs: ["사무실에서 노트북으로 작업하는 모습", "고객사 미팅 화이트보드 사진", "출간한 책 표지 사진"] },
);
if (!localRes.ok) throw new Error("generateModeDraft(branding, local) 실패: " + localRes.error);
const localImgCount = localRes.draft.sections.filter((s) => s.type === "image").length;
if (localImgCount !== 3) throw new Error(`local 사진 3장인데 이미지 섹션이 ${localImgCount}개 (정확히 3개여야 함)`);
console.log(`✅ generateModeDraft(branding, local=3): 이미지 섹션 정확히 3개 확인`);
