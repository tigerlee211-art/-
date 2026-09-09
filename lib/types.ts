import { z } from "zod";

export const WritingMode = z.enum(["auto", "experience", "branding"]);
export type WritingMode = z.infer<typeof WritingMode>;

export const PhotoSource = z.enum(["local", "crawl", "ai", "none"]);
export type PhotoSource = z.infer<typeof PhotoSource>;

export const ImageStyle = z.enum(["photo", "illust"]);
export type ImageStyle = z.infer<typeof ImageStyle>;

// ---- 섹션 모델 (6-5) ----
// 글은 문자열이 아니라 섹션 배열이다.
export const HeadingSection = z.object({
  type: z.literal("heading"),
  text: z.string().min(1),
});

export const ParagraphSection = z.object({
  type: z.literal("paragraph"),
  text: z.string().min(1),
  // highlight: text 안에 글자 그대로 있어야 하는 핵심 구절. AI가 지어내는 경우가 있어(7-24)
  // sanitizeDraft()에서 사후 검증한다 — 스키마 단계에서는 강제하지 않는다.
  highlight: z.string().optional(),
});

export const QuoteSection = z.object({
  type: z.literal("quote"),
  text: z.string().min(1),
});

export const DividerSection = z.object({
  type: z.literal("divider"),
});

export const ImageSection = z.object({
  type: z.literal("image"),
  query: z.string().min(1),
  caption: z.string().optional(),
});

export const Section = z.discriminatedUnion("type", [
  HeadingSection,
  ParagraphSection,
  QuoteSection,
  DividerSection,
  ImageSection,
]);
export type Section = z.infer<typeof Section>;

function countImageSections(sections: Section[]) {
  return sections.filter((s) => s.type === "image").length;
}

// 초안 스키마. ⚠️ 6-5: 이미지 개수 강제는 사진 소스별로 분기해야 한다.
// crawl/ai → 6개 이상, local → 정확히 사진 장수, none → 0개.
// 이 refine을 모든 모드에 걸면 local(사진 4장뿐)에서 재시도만 3번 돌다 실패한다.
export function draftSchema(photoSource: PhotoSource, localPhotoCount?: number) {
  return z
    .object({
      title: z.string().min(1),
      sections: z.array(Section).min(1),
    })
    .refine(
      (d) => {
        const n = countImageSections(d.sections);
        if (photoSource === "crawl" || photoSource === "ai") return n >= 6;
        if (photoSource === "local") return n === (localPhotoCount ?? 0);
        return n === 0; // none
      },
      {
        message:
          photoSource === "local"
            ? `이미지 섹션이 정확히 ${localPhotoCount ?? 0}개여야 합니다.`
            : photoSource === "none"
              ? "이미지 섹션이 없어야 합니다."
              : "이미지 섹션이 6개 이상이어야 합니다.",
      },
    );
}
export type Draft = { title: string; sections: Section[] };

export const IdeaSchema = z.object({
  title: z.string().min(1),
  angle: z.string().min(1),
  rationale: z.string().min(1),
});
export type Idea = z.infer<typeof IdeaSchema>;

export const IdeasResponseSchema = z.object({
  ideas: z.array(IdeaSchema).min(1),
});

// ---- 비전 판정 (6-6) ----
export const VisionVerdictSchema = z.object({
  fit: z.boolean(),
  watermark: z.boolean(),
  koreanPerson: z.boolean(),
  reason: z.string(),
});
export type VisionVerdict = z.infer<typeof VisionVerdictSchema>;

// AI 생성물 검증 — 크롤링용 판정과 별개 함수/스키마 (7-13).
export const GenVerdictSchema = z.object({
  ok: z.boolean(),
  mismatch: z.boolean(), // 주제 불일치
  broken: z.boolean(), // 형태 깨짐
  textArtifact: z.boolean(), // 글자 혼입
  lowQuality: z.boolean(), // 저품질
  reason: z.string(),
});
export type GenVerdict = z.infer<typeof GenVerdictSchema>;

export const ImagePromptSchema = z.object({
  prompt: z.string().min(1),
});

export const PhotoDescSchema = z.object({
  descriptions: z.array(z.string()),
});

// ===== 잡 입력 (작성 화면에서 넘어오는 값) =====
export const JobInputSchema = z
  .object({
    mode: WritingMode,
    keyword: z.string().optional(), // auto
    topic: z.string().optional(), // experience / branding
    keyPoints: z.string().optional(), // experience / branding
    photoSource: PhotoSource,
    photoFolder: z.string().optional(), // local
    placeMode: z.enum(["order", "ai"]).default("order"), // local
    imageStyle: ImageStyle.default("photo"), // ai
  })
  .refine((v) => v.mode !== "auto" || (v.keyword && v.keyword.trim().length > 0), {
    message: "자동 발굴 모드는 키워드가 필요합니다.",
  })
  .refine((v) => v.mode === "auto" || (v.topic && v.topic.trim().length > 0), {
    message: "체험단/브랜딩 모드는 주제가 필요합니다.",
  })
  .refine((v) => v.mode === "auto" || (v.keyPoints && v.keyPoints.trim().length > 0), {
    message: "체험단/브랜딩 모드는 핵심 내용이 필요합니다.",
  })
  .refine((v) => v.mode !== "auto" || v.photoSource !== "local", {
    message: "자동 발굴 모드에는 '내 사진'을 쓸 수 없습니다(주제를 미리 모르므로).",
  })
  .refine((v) => v.photoSource !== "local" || (v.photoFolder && v.photoFolder.trim().length > 0), {
    message: "'내 사진'을 선택하면 사진 폴더가 필요합니다.",
  });
export type JobInput = z.infer<typeof JobInputSchema>;
