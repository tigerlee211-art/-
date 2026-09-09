import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { publishDraft } from "@/lib/naver/publish";
import type { Section } from "@/lib/types";

const HARNESS_DIR = path.join(process.cwd(), "scripts", "harness");
const TEST_IMAGE = "/tmp/red_pixel.png";
if (!fs.existsSync(TEST_IMAGE)) {
  // 최소 PNG(빨간 1픽셀) — 이미지 업로드 하네스 테스트용
  const buf = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
    "base64",
  );
  fs.writeFileSync(TEST_IMAGE, buf);
}

type Report = {
  clicks: { cancel: number; strike: number; bold: number; imageInsert: number };
  uploadedFileName: string | null;
  bottomSearchValue: string;
  titleText: string;
  components: { cls: string; text: string }[];
};

let lastReport: Report | null = null;

function startServer(): Promise<{ server: http.Server; port: number }> {
  const server = http.createServer((req, res) => {
    if (req.method === "POST" && req.url === "/report") {
      let body = "";
      req.on("data", (c) => (body += c));
      req.on("end", () => {
        try {
          lastReport = JSON.parse(body);
        } catch {
          // 무시
        }
        res.writeHead(204).end();
      });
      return;
    }

    const urlPath = (req.url ?? "/").split("?")[0]!;
    if (urlPath.startsWith("/blog.naver.com/")) {
      // 실제 네이버 발행 성공 시 탭 전체가 게시글 주소로 이동하는 것을 흉내낸다.
      res.writeHead(200, { "Content-Type": "text/html" }).end("<html><body>published</body></html>");
      return;
    }

    const filePath = path.join(HARNESS_DIR, urlPath === "/" ? "outer.html" : urlPath);
    if (!filePath.startsWith(HARNESS_DIR) || !fs.existsSync(filePath)) {
      res.writeHead(404).end("not found");
      return;
    }
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" }).end(fs.readFileSync(filePath));
  });
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const addr = server.address();
      const port = typeof addr === "object" && addr ? addr.port : 0;
      resolve({ server, port });
    });
  });
}

const { server, port } = await startServer();
const base = `http://127.0.0.1:${port}`;

try {
  // ================= 테스트 A: 연습 모드, 전체 섹션 유형 =================
  lastReport = null;
  const sectionsA: Section[] = [
    { type: "heading", text: "테스트 소제목" },
    { type: "paragraph", text: "이것은 예쁜 것보다 빠른 게 훨씬 중요하다는 본문입니다.", highlight: "예쁜 것보다" },
    { type: "quote", text: "짧은 인용구 테스트입니다" },
    { type: "divider" },
    { type: "paragraph", text: "인용구 다음에 오는 문단입니다." },
    { type: "image", query: "테스트 사진", caption: "사진 설명입니다 ⚠️ 완료" },
    { type: "paragraph", text: "마지막 문단입니다." },
  ];
  const logsA: string[] = [];
  const resultA = await publishDraft({
    jobId: 90001,
    blogId: "unused",
    title: "테스트 제목입니다",
    sections: sectionsA,
    imagePaths: new Map([[5, TEST_IMAGE]]),
    dryRun: true,
    visibility: "private",
    headless: true,
    entryUrl: `${base}/outer.html`,
    onLog: (m) => logsA.push(m),
  });

  console.log("--- 테스트 A 로그 ---");
  for (const l of logsA) console.log("  " + l);

  if (!resultA.ok) throw new Error("테스트 A 실패해야 하는데 실패함: " + resultA.error);
  if (!resultA.dryRun) throw new Error("dryRun 결과가 아님");
  if (!fs.existsSync(resultA.screenshot)) throw new Error("스크린샷 파일이 생성되지 않음: " + resultA.screenshot);
  console.log(`✅ 연습 모드 전체 플로우 성공, 스크린샷 저장됨: ${resultA.screenshot}`);

  await new Promise((r) => setTimeout(r, 300)); // 마지막 /report POST가 도착할 시간 여유
  if (!lastReport) throw new Error("하네스에서 리포트를 받지 못함");
  const report = lastReport;

  // 7-1: 취소선 버튼이 0회 눌렸는가
  if (report.clicks.strike !== 0) throw new Error(`7-1 회귀: 취소선 버튼이 ${report.clicks.strike}회 눌림(0이어야 함)`);
  console.log("✅ 7-1: 취소선 버튼 0회 클릭 확인");

  if (report.clicks.cancel !== 0) {
    // 이번 테스트는 복원 팝업 없이 시작(?restore=1 미부여)했으므로 취소 버튼도 안 눌려야 정상
  }

  // 7-6: 하단 글감 검색바에 타이핑이 안 샜는가
  if (report.bottomSearchValue !== "") {
    throw new Error(`7-6 회귀: 글감 검색바에 텍스트가 샘: "${report.bottomSearchValue}"`);
  }
  console.log("✅ 7-6: 하단 글감 검색바에 타이핑이 새지 않음 확인");

  // 7-7: 이미지가 업로드 처리됐는가
  if (report.clicks.imageInsert !== 1) throw new Error(`7-7 회귀: 이미지 업로드 처리 횟수 ${report.clicks.imageInsert} (1이어야 함)`);
  if (report.uploadedFileName !== "red_pixel.png") throw new Error("7-7 회귀: 업로드된 파일명이 기대와 다름: " + report.uploadedFileName);
  console.log("✅ 7-7: 파일 선택창이 영구 핸들러로 정상 처리됨 (업로드 파일: " + report.uploadedFileName + ")");

  // 7-5: 인용구 다음 문단이 인용구 밖에 있는가
  const quoteComp = report.components.find((c) => c.cls.includes("se-quote"));
  if (!quoteComp) throw new Error("인용구 컴포넌트를 찾지 못함: " + JSON.stringify(report.components));
  if (!quoteComp.text.includes("짧은 인용구 테스트입니다")) throw new Error("인용구 컴포넌트에 인용구 텍스트가 없음: " + quoteComp.text);
  if (quoteComp.text.includes("인용구 다음에 오는 문단입니다")) {
    throw new Error("7-5 회귀: 다음 문단이 인용구 컴포넌트 안에 삼켜짐: " + quoteComp.text);
  }
  const nextParaComp = report.components.find((c) => c.text.includes("인용구 다음에 오는 문단입니다"));
  if (!nextParaComp) throw new Error("인용구 다음 문단을 찾지 못함(어딘가로 사라짐)");
  if (nextParaComp === quoteComp) throw new Error("7-5 회귀: 다음 문단이 별도 컴포넌트가 아님");
  console.log("✅ 7-5: 인용구 다음 문단이 인용구 컴포넌트 밖의 별도 컴포넌트에 있음 확인");

  // 7-18 / 7-25: 캡션이 사진 설명 칸(se-is-on)에 정상 입력되고, 이모지가 중복되지 않았는가
  const imageComp = report.components.find((c) => c.cls.includes("se-image"));
  if (!imageComp) throw new Error("이미지 컴포넌트를 찾지 못함");
  if (!imageComp.text.includes("사진 설명입니다")) throw new Error("캡션 텍스트가 이미지 컴포넌트에 없음: " + imageComp.text);
  if (imageComp.text.includes("⚠⚠")) throw new Error("7-25 회귀: 캡션에 이모지가 중복 입력됨: " + imageComp.text);
  if (!imageComp.text.includes("⚠️완료") && !imageComp.text.includes("⚠️ 완료")) {
    throw new Error("7-25 확인 실패: 캡션에 이모지가 정확히 1개 들어있지 않음: " + imageComp.text);
  }
  console.log("✅ 7-18/7-25: 캡션이 이미지 컴포넌트 안에 정상 입력되고 이모지가 중복되지 않음 확인: " + JSON.stringify(imageComp.text));

  // 7-8: 본문에 마크다운 기호가 남아있지 않은가 (원본 섹션에는 마크다운이 없었으므로, 이 검증은
  // stripMarkdown이 부작용을 일으키지 않았는지 + 물결표 등이 섞였을 때도 안전한지는 test-textformat.mts에서 이미 확인)
  const allText = report.components.map((c) => c.text).join(" ") + " " + report.titleText;
  if (/\*\*|~~/.test(allText)) throw new Error("마크다운 기호가 그대로 남아있음: " + allText);
  console.log("✅ 7-8: 최종 DOM 텍스트에 마크다운 기호가 남아있지 않음 확인");

  // ================= 테스트 B: 실제 발행 경로 — 공개범위 확인 + URL 검증(7-11, 7-19) =================
  lastReport = null;
  const resultB = await publishDraft({
    jobId: 90002,
    blogId: "unused",
    title: "발행 테스트",
    sections: [{ type: "paragraph", text: "발행 경로 테스트용 문단입니다." }],
    imagePaths: new Map(),
    dryRun: false,
    visibility: "private",
    headless: true,
    entryUrl: `${base}/outer.html`,
  });

  if (!resultB.ok) throw new Error("테스트 B(실제 발행 경로) 실패: " + resultB.error);
  if (resultB.dryRun) throw new Error("테스트 B는 dryRun:false로 요청했는데 dryRun 결과가 옴");
  if (!/blog\.naver\.com\/[^/]+\/\d{6,}/.test(resultB.blogUrl)) {
    throw new Error("7-11 회귀: 발행 후 URL이 게시글 주소 패턴이 아님: " + resultB.blogUrl);
  }
  if (!resultB.blogUrl.includes("vis=open_private")) {
    throw new Error(`7-19 회귀: 공개 범위가 private로 반영되지 않음: ${resultB.blogUrl}`);
  }
  console.log(`✅ 7-11/7-19: 공개범위(private) 확인 후 발행, 게시글 주소로 이동 확인: ${resultB.blogUrl}`);

  // ================= 테스트 C: 본문 영역을 못 찾으면 실패 처리 (7-26) =================
  const resultC = await publishDraft({
    jobId: 90003,
    blogId: "unused",
    title: "제목만 있음",
    sections: [{ type: "paragraph", text: "이 텍스트는 절대 제목 칸에 들어가면 안 됩니다." }],
    imagePaths: new Map(),
    dryRun: true,
    visibility: "private",
    headless: true,
    entryUrl: `${base}/outer-nobody.html`,
  });

  if (resultC.ok) throw new Error("7-26 회귀: 본문을 못 찾았는데도 성공으로 처리됨");
  if (!resultC.error.includes("본문")) throw new Error("7-26: 에러 메시지가 본문 관련이 아님: " + resultC.error);
  console.log(`✅ 7-26: 본문 영역을 못 찾으면 조용히 진행하지 않고 명확히 실패 처리됨: "${resultC.error}"`);

  // ================= 테스트 D: 복원 팝업이 뜬 상태로 시작 (7-3) =================
  lastReport = null;
  const resultD = await publishDraft({
    jobId: 90004,
    blogId: "unused",
    title: "복원 팝업 테스트",
    sections: [{ type: "paragraph", text: "팝업을 닫은 뒤에도 정상 진행되는지 확인하는 문단입니다." }],
    imagePaths: new Map(),
    dryRun: true,
    visibility: "private",
    headless: true,
    entryUrl: `${base}/outer.html?restore=1`,
  });
  if (!resultD.ok) throw new Error("테스트 D(복원 팝업) 실패: " + resultD.error);
  await new Promise((r) => setTimeout(r, 300));
  if (!lastReport) throw new Error("테스트 D: 리포트를 받지 못함");
  if (lastReport.clicks.cancel !== 1) throw new Error(`7-3: 팝업 취소 버튼이 ${lastReport.clicks.cancel}회 눌림(1이어야 함)`);
  if (lastReport.clicks.strike !== 0) throw new Error("7-3/7-1: 팝업이 있는 상태에서도 취소선이 눌리면 안 됨");
  const bodyText = lastReport.components.map((c) => c.text).join(" ");
  if (!bodyText.includes("팝업을 닫은 뒤에도 정상 진행되는지")) throw new Error("7-3: 팝업 닫은 뒤 본문 입력이 이어지지 않음");
  console.log("✅ 7-3: 복원 팝업+차단막이 있는 상태로 시작해도 팝업을 닫고(1회) 정상 진행됨, 취소선 오클릭 없음");

  console.log("\n전체 하네스 테스트 통과 (6.5-a)");
} finally {
  server.close();
}
