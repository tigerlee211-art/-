"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { Settings } from "@/config";
import { SettingsDrawer } from "@/app/SettingsDrawer";

type StatusResp = {
  claude: { installed: boolean; version?: string };
  naver: { valid: boolean; reason?: string; blogId?: string };
  cloudflareConfigured: boolean;
  settings: Settings;
};

type UsageResp = {
  neurons: { usedToday: number; budget: number; source: string; note?: string; perImage: number };
  publish: { todayCount: number; dailyLimit: number };
};

type JobRow = {
  id: number;
  keyword: string;
  status: string;
  stage: string | null;
  mode: string;
  error: string | null;
  created_at: string;
};

type Section =
  | { type: "heading"; text: string }
  | { type: "paragraph"; text: string; highlight?: string }
  | { type: "quote"; text: string }
  | { type: "divider" }
  | { type: "image"; query: string; caption?: string };

type JobDetail = {
  job: JobRow & { inputs: string };
  ideas: { id: number; title: string; angle: string; rationale: string; chosen: number }[];
  drafts: { id: number; title: string; body_json: string }[];
  images: { id: number; section_index: number; local_path: string | null; verdict_ok: number; verdict_reason: string }[];
  posts: { id: number; status: string; blog_url: string | null; screenshot: string | null; note: string | null }[];
  logs: { id: number; level: string; message: string; created_at: string }[];
};

const MODE_INFO = {
  auto: { name: "자동 발굴", desc: "관심 키워드만 넣으면 AI가 글감을 찾아 글을 씁니다." },
  experience: { name: "체험단", desc: "방문/사용 후기를 1인칭으로 씁니다." },
  branding: { name: "브랜딩·전문성", desc: "전문가 관점의 신뢰도 있는 글을 씁니다." },
} as const;

const PHOTO_INFO: Record<string, string> = {
  local: "내 사진",
  crawl: "검색해서 가져오기",
  ai: "AI가 그리기",
  none: "사진 없음",
};

const STATUS_LABEL: Record<string, string> = {
  pending: "대기 중",
  scraping: "자료 모으는 중",
  writing: "글 쓰는 중",
  imaging: "사진 준비 중",
  publishing: "발행하는 중",
  done: "완료",
  failed: "실패",
  canceled: "취소됨",
};

function statusChipClass(status: string) {
  if (status === "done") return "status-chip status-done";
  if (status === "failed") return "status-chip status-failed";
  return "status-chip status-progress";
}

function gaugeLevel(ratio: number): "" | "warn" | "danger" {
  if (ratio >= 0.9) return "danger";
  if (ratio >= 0.7) return "warn";
  return "";
}

export default function Page() {
  const [status, setStatus] = useState<StatusResp | null>(null);
  const [usage, setUsage] = useState<UsageResp | null>(null);
  const [jobs, setJobs] = useState<JobRow[]>([]);
  const [selectedJobId, setSelectedJobId] = useState<number | null>(null);
  const [detail, setDetail] = useState<JobDetail | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [loggingIn, setLoggingIn] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  // 작성 폼 상태
  const [mode, setMode] = useState<"auto" | "experience" | "branding">("auto");
  const [keyword, setKeyword] = useState("");
  const [topic, setTopic] = useState("");
  const [keyPoints, setKeyPoints] = useState("");
  const [photoSource, setPhotoSource] = useState<"local" | "crawl" | "ai" | "none">("crawl");
  const [photoFolder, setPhotoFolder] = useState("");
  const [imageStyle, setImageStyle] = useState<"photo" | "illust">("photo");

  const refreshStatus = useCallback(async () => {
    const res = await fetch("/api/status");
    if (res.ok) setStatus(await res.json());
  }, []);

  const refreshUsage = useCallback(async () => {
    const res = await fetch("/api/usage");
    if (res.ok) setUsage(await res.json());
  }, []);

  const refreshJobs = useCallback(async () => {
    const res = await fetch("/api/jobs");
    if (res.ok) setJobs((await res.json()).jobs);
  }, []);

  useEffect(() => {
    refreshStatus();
    refreshUsage();
    refreshJobs();
    const t = setInterval(() => {
      refreshStatus();
      refreshUsage();
      refreshJobs();
    }, 4000);
    return () => clearInterval(t);
  }, [refreshStatus, refreshUsage, refreshJobs]);

  const fetchDetail = useCallback(async (id: number) => {
    const res = await fetch(`/api/jobs/${id}`);
    if (res.ok) setDetail(await res.json());
  }, []);

  useEffect(() => {
    if (selectedJobId == null) return;
    fetchDetail(selectedJobId);
  }, [selectedJobId, fetchDetail]);

  // SSE 로그 스트림
  const esRef = useRef<EventSource | null>(null);
  useEffect(() => {
    esRef.current?.close();
    if (selectedJobId == null) return;
    const es = new EventSource(`/api/jobs/${selectedJobId}/stream`);
    esRef.current = es;
    es.addEventListener("log", () => {
      fetchDetail(selectedJobId);
    });
    es.addEventListener("end", () => {
      fetchDetail(selectedJobId);
      refreshJobs();
      es.close();
    });
    return () => es.close();
  }, [selectedJobId, fetchDetail, refreshJobs]);

  async function handleSettingsChange(patch: Partial<Settings>) {
    if (!status) return;
    const optimistic = { ...status, settings: { ...status.settings, ...patch } };
    setStatus(optimistic);
    const res = await fetch("/api/settings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch),
    });
    if (res.ok) {
      const data = await res.json();
      setStatus((prev) => (prev ? { ...prev, settings: data.settings } : prev));
    } else {
      refreshStatus();
    }
  }

  async function handleLogin() {
    setLoggingIn(true);
    try {
      const res = await fetch("/api/naver/login", { method: "POST" });
      await res.json().catch(() => null);
      await refreshStatus();
    } finally {
      setLoggingIn(false);
    }
  }

  async function pickFolder() {
    const res = await fetch("/api/pick-folder", { method: "POST" });
    const data = await res.json();
    if (data.path) setPhotoFolder(data.path);
  }

  const settings = status?.settings;
  const dryRun = settings?.dryRun ?? true;
  const killSwitch = settings?.killSwitch ?? false;

  const railClass = killSwitch ? "rail-armed" : dryRun ? "rail-safe" : "rail-armed";
  const railTitle = killSwitch ? "전체 중단" : dryRun ? "연습 모드" : "실제 발행";
  const railSub = killSwitch
    ? "어떤 작업도 발행되지 않습니다"
    : dryRun
      ? "발행하지 않고 완성 화면만 저장합니다"
      : "완성되는 글이 블로그에 그대로 올라갑니다";
  const submitLabel = dryRun ? "연습으로 만들기" : "글 만들고 발행하기";

  const hasInProgressJob = jobs.some((j) => !["done", "failed", "canceled"].includes(j.status));

  const aiDisabled = photoSource === "ai" && status ? !status.cloudflareConfigured : false;

  function canSubmit(): string | null {
    if (killSwitch) return null; // 제출은 가능하지만 서버에서 어차피 발행 자체는 막힘 — 연습은 진행 가능
    if (hasInProgressJob) return "이미 진행 중인 작업이 있습니다.";
    if (mode === "auto" && !keyword.trim()) return "관심 키워드를 입력해 주세요.";
    if (mode !== "auto" && !topic.trim()) return "주제를 입력해 주세요.";
    if (mode !== "auto" && !keyPoints.trim()) return "핵심 내용을 입력해 주세요.";
    if (photoSource === "local" && !photoFolder.trim()) return "사진 폴더를 선택해 주세요.";
    if (aiDisabled) return "Cloudflare 키가 없어 AI 사진 생성을 쓸 수 없습니다.";
    return null;
  }

  async function handleSubmit() {
    const problem = canSubmit();
    if (problem) {
      setSubmitError(problem);
      return;
    }
    setSubmitError(null);
    setCreating(true);
    try {
      const body = {
        mode,
        keyword: mode === "auto" ? keyword.trim() : undefined,
        topic: mode !== "auto" ? topic.trim() : undefined,
        keyPoints: mode !== "auto" ? keyPoints.trim() : undefined,
        photoSource,
        photoFolder: photoSource === "local" ? photoFolder.trim() : undefined,
        imageStyle,
      };
      const res = await fetch("/api/jobs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) {
        setSubmitError(data.error ?? "작업을 시작하지 못했습니다.");
        return;
      }
      setSelectedJobId(data.jobId);
      refreshJobs();
    } finally {
      setCreating(false);
    }
  }

  const neuronRatio = usage ? usage.neurons.usedToday / usage.neurons.budget : 0;
  const publishRatio = usage ? usage.publish.todayCount / usage.publish.dailyLimit : 0;

  return (
    <div className="app-shell">
      <div className={`status-rail ${railClass}`}>
        <div className="container" style={{ display: "flex", alignItems: "center", gap: 16 }}>
          <div className="msg">
            <div className="title">{railTitle}</div>
            <div className="sub">{railSub}</div>
          </div>
          <div className="dot-row">
            <span>
              <span className={`dot ${status?.claude.installed ? "dot-on" : "dot-off"}`} />
              AI
            </span>
            <span>
              <span className={`dot ${status?.naver.valid ? "dot-on" : "dot-off"}`} />
              네이버
            </span>
            <span>
              <span className={`dot ${status?.cloudflareConfigured ? "dot-on" : "dot-off"}`} />
              이미지 생성
            </span>
          </div>
          {!status?.naver.valid && (
            <button className="btn" onClick={handleLogin} disabled={loggingIn}>
              {loggingIn ? "로그인 창 여는 중..." : "네이버 로그인"}
            </button>
          )}
          <button className="btn" onClick={() => setSettingsOpen(true)} aria-haspopup="dialog">
            설정
          </button>
        </div>
      </div>

      <div className="container">
        <div className="gauges">
          <div className="gauge">
            <div className="label">오늘 발행</div>
            <div className={`value tabular ${gaugeLevel(publishRatio)}`}>
              {usage?.publish.todayCount ?? 0} / {usage?.publish.dailyLimit ?? 3}편
            </div>
            <div className="sub">
              발행 간격 {settings?.minPublishIntervalMin ?? 30}분
              {publishRatio >= 1 ? " · 설정에서 늘릴 수 있습니다" : ""}
            </div>
            <div className="gauge-bar">
              <div className={gaugeLevel(publishRatio)} style={{ width: `${Math.min(100, publishRatio * 100)}%` }} />
            </div>
          </div>
          <div className="gauge">
            <div className="label">이미지 생성량</div>
            <div className={`value tabular ${gaugeLevel(neuronRatio)}`}>
              {usage?.neurons.usedToday ?? 0} / {usage?.neurons.budget ?? 10000} 뉴런
            </div>
            <div className="sub">
              {usage?.neurons.source === "estimated" ? "추정치" : "실측"} · 장당 {usage?.neurons.perImage ?? 0}뉴런
            </div>
            <div className="gauge-bar">
              <div className={gaugeLevel(neuronRatio)} style={{ width: `${Math.min(100, neuronRatio * 100)}%` }} />
            </div>
          </div>
        </div>

        <div className="section-title">새 글 만들기</div>
        <div className="mode-cards">
          {(Object.keys(MODE_INFO) as (keyof typeof MODE_INFO)[]).map((m) => (
            <button
              key={m}
              type="button"
              className="mode-card"
              aria-pressed={mode === m}
              onClick={() => setMode(m)}
            >
              <div className="name">{MODE_INFO[m].name}</div>
              <div className="desc">{MODE_INFO[m].desc}</div>
            </button>
          ))}
        </div>

        <div className="form-panel">
          {mode === "auto" ? (
            <div className="field">
              <label htmlFor="keyword">관심 키워드</label>
              <input id="keyword" type="text" value={keyword} onChange={(e) => setKeyword(e.target.value)} placeholder="예: 제주도 여행, 홈카페" />
            </div>
          ) : (
            <>
              <div className="field">
                <label htmlFor="topic">주제</label>
                <input id="topic" type="text" value={topic} onChange={(e) => setTopic(e.target.value)} />
              </div>
              <div className="field">
                <label htmlFor="keyPoints">핵심 내용</label>
                <textarea id="keyPoints" rows={4} value={keyPoints} onChange={(e) => setKeyPoints(e.target.value)} />
              </div>
            </>
          )}

          <div className="field">
            <label>사진</label>
            <div className="pill-row">
              {(["local", "crawl", "ai", "none"] as const)
                .filter((p) => !(mode === "auto" && p === "local"))
                .map((p) => (
                  <button
                    key={p}
                    type="button"
                    className="pill"
                    aria-pressed={photoSource === p}
                    onClick={() => setPhotoSource(p)}
                  >
                    {PHOTO_INFO[p]}
                  </button>
                ))}
            </div>
          </div>

          {photoSource === "local" && (
            <div className="field">
              <label htmlFor="photoFolder">사진 폴더</label>
              <div style={{ display: "flex", gap: 8 }}>
                <input id="photoFolder" type="text" value={photoFolder} onChange={(e) => setPhotoFolder(e.target.value)} placeholder="폴더 경로를 직접 입력하거나 폴더 선택을 눌러주세요" />
                <button type="button" className="btn" onClick={pickFolder}>
                  폴더 선택
                </button>
              </div>
            </div>
          )}

          {photoSource === "ai" && (
            <div className="field">
              <label>그림체</label>
              <div className="pill-row">
                <button type="button" className="pill" aria-pressed={imageStyle === "photo"} onClick={() => setImageStyle("photo")}>
                  사진처럼
                </button>
                <button type="button" className="pill" aria-pressed={imageStyle === "illust"} onClick={() => setImageStyle("illust")}>
                  일러스트
                </button>
              </div>
              {aiDisabled && <div className="warn-badge" style={{ marginTop: 8 }}>Cloudflare 키가 없어 AI 사진 생성을 쓸 수 없습니다</div>}
            </div>
          )}

          {submitError && <div className="warn-badge">{submitError}</div>}

          <button className="btn btn-primary" onClick={handleSubmit} disabled={creating || hasInProgressJob || aiDisabled}>
            {creating ? "시작하는 중..." : submitLabel}
          </button>
        </div>

        <div className="section-title">최근 작업</div>
        <div className="job-list">
          {jobs.length === 0 && <div className="empty-state">아직 만든 글이 없습니다.</div>}
          {jobs.map((j) => (
            <button key={j.id} className="job-row" onClick={() => setSelectedJobId(j.id)}>
              <div>
                <div className="kw">{j.keyword}</div>
                <div className="status">
                  {STATUS_LABEL[j.status] ?? j.status}
                  {j.stage ? ` · ${j.stage}` : ""}
                </div>
              </div>
              <span className={statusChipClass(j.status)}>{STATUS_LABEL[j.status] ?? j.status}</span>
            </button>
          ))}
        </div>

        {selectedJobId != null && detail && <JobDetailPanel detail={detail} />}
      </div>

      {settings && (
        <SettingsDrawer open={settingsOpen} onClose={() => setSettingsOpen(false)} settings={settings} onChange={handleSettingsChange} />
      )}
    </div>
  );
}

function JobDetailPanel({ detail }: { detail: JobDetail }) {
  const draft = detail.drafts[detail.drafts.length - 1];
  const post = detail.posts[detail.posts.length - 1];
  const sections: Section[] = draft ? JSON.parse(draft.body_json) : [];
  const imagesBySection = new Map<number, string>();
  for (const img of detail.images) {
    if (img.verdict_ok && img.local_path) imagesBySection.set(img.section_index, img.local_path);
  }

  return (
    <div className="detail-panel">
      <div className="section-title" style={{ marginTop: 0 }}>
        진행 상황
      </div>
      <div className="log-console">
        {detail.logs.length === 0 && "로그가 아직 없습니다."}
        {detail.logs.map((l) => (
          <div key={l.id} style={{ color: l.level === "error" ? "var(--armed)" : l.level === "warn" ? "var(--live)" : undefined }}>
            [{l.created_at}] {l.message}
          </div>
        ))}
      </div>

      {post && (
        <div style={{ marginTop: 12 }}>
          {post.status === "published" && post.blog_url && (
            <a className="btn btn-primary" href={post.blog_url} target="_blank" rel="noreferrer">
              발행된 글 열기
            </a>
          )}
          {post.status === "blocked" && <div className="warn-badge">발행이 차단됐습니다: {post.note}</div>}
          {post.status === "failed" && <div className="warn-badge">발행 실패: {post.note}</div>}
          {post.note && post.status !== "blocked" && post.status !== "failed" && (
            <div className="warn-badge" style={{ marginTop: 8 }}>
              {post.note}
            </div>
          )}
          {post.screenshot && (
            <div style={{ marginTop: 12 }}>
              <div className="section-title">완성 화면 (연습 모드 스크린샷)</div>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={`/api/file?path=${encodeURIComponent(post.screenshot)}`} alt="완성 화면 스크린샷" style={{ maxWidth: "100%", borderRadius: 8 }} />
            </div>
          )}
        </div>
      )}

      {draft && (
        <>
          <div className="section-title">초안 미리보기</div>
          <article className="draft-preview">
            <h2>{draft.title}</h2>
            {sections.map((s, i) => (
              <SectionView key={i} section={s} imagePath={imagesBySection.get(i)} />
            ))}
          </article>
        </>
      )}
    </div>
  );
}

function SectionView({ section, imagePath }: { section: Section; imagePath?: string }) {
  switch (section.type) {
    case "heading":
      return <h3>{section.text}</h3>;
    case "paragraph": {
      if (section.highlight && section.text.includes(section.highlight)) {
        const idx = section.text.indexOf(section.highlight);
        const before = section.text.slice(0, idx);
        const mark = section.text.slice(idx, idx + section.highlight.length);
        const after = section.text.slice(idx + section.highlight.length);
        return (
          <p>
            {before}
            <mark>{mark}</mark>
            {after}
          </p>
        );
      }
      return <p>{section.text}</p>;
    }
    case "quote":
      return <blockquote>{section.text}</blockquote>;
    case "divider":
      return <hr />;
    case "image":
      return (
        <figure>
          {imagePath ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={`/api/file?path=${encodeURIComponent(imagePath)}`} alt={section.caption ?? section.query} />
          ) : (
            <div className="warn-badge">이 자리에 넣을 사진을 찾지 못했습니다 ({section.query})</div>
          )}
          {section.caption && <figcaption>{section.caption}</figcaption>}
        </figure>
      );
  }
}
