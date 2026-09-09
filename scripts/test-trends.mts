import { __internal } from "@/lib/scrape/trends";

// ⚠️ 7-1과 같은 부분일치 계열: help.naver.com/alias/news/news_21.naver 가 /news/ 에 걸린다.
const anchors = [
  {
    href: "https://help.naver.com/alias/news/news_21.naver",
    text: "네이버뉴스 고객센터 이용안내",
    containerText: "네이버뉴스 고객센터 이용안내 자세히 보기",
  },
  {
    href: "https://n.news.naver.com/article/001/0001234567",
    text: "제주도 가볼 만한 곳 10선새 창 열림",
    containerText: "제주도 가볼 만한 곳 10선새 창 열림 이번 주말 제주도 여행지를 소개합니다. 날씨도 좋고...",
  },
  {
    // 같은 기사의 스니펫 링크 (제목이 더 길게 들어옴)
    href: "https://n.news.naver.com/article/001/0001234567",
    text: "제주도 가볼 만한 곳 10선 이번 주말 제주도 여행지를 소개합니다 전체 문장형 스니펫",
    containerText: "제주도 가볼 만한 곳 10선 이번 주말 제주도 여행지를 소개합니다 전체 문장형 스니펫",
  },
  {
    href: "https://n.news.naver.com/article/001/0009999999",
    text: "네이버뉴스새 창 열림", // 새 창 열림 제거 전 11자라 길이필터를 통과하는 노이즈
    containerText: "네이버뉴스새 창 열림",
  },
  {
    href: "https://n.news.naver.com/article/001/0001111111",
    text: "짧음", // 8자 미만 → 제외
    containerText: "짧음",
  },
  {
    href: "https://n.news.naver.com/article/001/0002222222",
    text: "이 기사는 광고입니다 자세히 보기", // 노이즈 텍스트 → 제외
    containerText: "이 기사는 광고입니다 자세히 보기",
  },
];

const news = __internal.toSources(anchors, "news");
console.log(
  "news 결과:",
  news.map((n) => n.title),
);

if (news.some((n) => n.url.includes("help.naver.com"))) {
  throw new Error("7-1 회귀: help.naver.com 링크가 걸러지지 않음");
}
if (news.length !== 1) {
  throw new Error(`중복/노이즈 제거 실패: 기대 1개, 실제 ${news.length}개 -> ${JSON.stringify(news)}`);
}
if (news[0]!.title !== "제주도 가볼 만한 곳 10선") {
  throw new Error(`짧은 제목 우선 선택 실패: ${news[0]!.title}`);
}
console.log("✅ help.naver.com/alias 제외 확인 (7-1 계열)");
console.log("✅ '새 창 열림' 노이즈 제거 후 8자 미만으로 걸러짐 확인");
console.log("✅ 같은 URL 중복 중 더 짧은 제목 채택 확인");
console.log("✅ 8자 미만/노이즈 텍스트 제외 확인");

// 블로그 홈 링크는 제외되고 게시글 패턴만 남는지
const blogAnchors = [
  { href: "https://blog.naver.com/somebloggername", text: "블로거의 홈 화면 링크입니다", containerText: "" },
  { href: "https://blog.naver.com/somebloggername/223123456", text: "홈카페 원두 추천 후기입니다", containerText: "홈카페 원두 추천 후기입니다 직접 내려마셔봤어요" },
];
const blog = __internal.toSources(blogAnchors, "blog");
if (blog.length !== 1 || !blog[0]!.url.includes("223123456")) {
  throw new Error("블로그 홈 링크가 걸러지지 않음: " + JSON.stringify(blog));
}
console.log("✅ 블로그 홈 링크 제외, 게시글 패턴만 채택 확인");
