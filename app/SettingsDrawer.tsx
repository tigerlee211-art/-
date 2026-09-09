"use client";

import { useEffect, useState } from "react";
import type { Settings } from "@/config";
import { SETTING_LIMITS, VISIBILITY_VALUES } from "@/config";
import { displayNeurons, neuronsPerImage, FREE_DAILY_NEURONS } from "@/lib/ai/neurons";

const VISIBILITY_LABEL: Record<(typeof VISIBILITY_VALUES)[number], string> = {
  public: "전체공개",
  neighbor: "이웃공개",
  both: "서로이웃공개",
  private: "비공개(기본값)",
};

function Switch({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      className="switch"
      onClick={() => onChange(!checked)}
    />
  );
}

function RangeField({
  label,
  value,
  min,
  max,
  onChange,
  suffix,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  onChange: (v: number) => void;
  suffix?: string;
}) {
  return (
    <div className="range-row">
      <div className="range-label">
        <span>{label}</span>
        <span className="tabular">
          {value}
          {suffix ?? ""}
        </span>
      </div>
      <input type="range" min={min} max={max} value={value} onChange={(e) => onChange(Number(e.target.value))} />
    </div>
  );
}

export function SettingsDrawer({
  open,
  onClose,
  settings,
  onChange,
}: {
  open: boolean;
  onClose: () => void;
  settings: Settings;
  onChange: (patch: Partial<Settings>) => void;
}) {
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [open, onClose]);

  const [resetting, setResetting] = useState(false);

  if (!open) return null;

  async function resetDefaults() {
    setResetting(true);
    try {
      const res = await fetch("/api/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reset: true }),
      });
      const data = await res.json();
      if (data.settings) onChange(data.settings);
    } finally {
      setResetting(false);
    }
  }

  const perImage = displayNeurons(neuronsPerImage(settings.cfImageSteps));
  const dailyImages = Math.floor(FREE_DAILY_NEURONS / neuronsPerImage(settings.cfImageSteps));

  return (
    <>
      <div className="drawer-backdrop" onClick={onClose} />
      <div className="drawer" role="dialog" aria-label="설정">
        <h2>설정</h2>

        <div className="drawer-group">
          <h3>발행 안전장치</h3>

          <div className="switch-row">
            <div>
              <div>연습 모드</div>
              <div style={{ fontSize: 12, color: "var(--text-dim)" }}>켜져 있으면 실제로 올라가지 않습니다</div>
            </div>
            <Switch checked={settings.dryRun} onChange={(v) => onChange({ dryRun: v })} label="연습 모드" />
          </div>

          <div className="switch-row">
            <div>
              <div>전체 중단</div>
              <div style={{ fontSize: 12, color: "var(--text-dim)" }}>켜면 어떤 작업도 발행되지 않습니다</div>
            </div>
            <Switch checked={settings.killSwitch} onChange={(v) => onChange({ killSwitch: v })} label="전체 중단" />
          </div>

          <div className="field" style={{ marginTop: 12 }}>
            <label>공개 범위</label>
            <div className="pill-row">
              {VISIBILITY_VALUES.map((v) => (
                <button
                  key={v}
                  type="button"
                  className="pill"
                  aria-pressed={settings.visibility === v}
                  onClick={() => onChange({ visibility: v })}
                >
                  {VISIBILITY_LABEL[v]}
                </button>
              ))}
            </div>
          </div>

          <RangeField
            label="하루 발행 수"
            value={settings.dailyPublishLimit}
            min={SETTING_LIMITS.dailyPublishLimit.min}
            max={SETTING_LIMITS.dailyPublishLimit.max}
            suffix="편"
            onChange={(v) => onChange({ dailyPublishLimit: v })}
          />
          <RangeField
            label="최소 발행 간격"
            value={settings.minPublishIntervalMin}
            min={SETTING_LIMITS.minPublishIntervalMin.min}
            max={SETTING_LIMITS.minPublishIntervalMin.max}
            suffix="분"
            onChange={(v) => onChange({ minPublishIntervalMin: v })}
          />
        </div>

        <div className="drawer-group">
          <h3>글감과 사진</h3>
          <RangeField
            label="검색 수집량"
            value={settings.scrapeTopN}
            min={SETTING_LIMITS.scrapeTopN.min}
            max={SETTING_LIMITS.scrapeTopN.max}
            suffix="건"
            onChange={(v) => onChange({ scrapeTopN: v })}
          />
          <RangeField
            label="이미지 후보 수"
            value={settings.imageCandidates}
            min={SETTING_LIMITS.imageCandidates.min}
            max={SETTING_LIMITS.imageCandidates.max}
            suffix="개"
            onChange={(v) => onChange({ imageCandidates: v })}
          />
          <RangeField
            label="생성 품질(스텝)"
            value={settings.cfImageSteps}
            min={SETTING_LIMITS.cfImageSteps.min}
            max={SETTING_LIMITS.cfImageSteps.max}
            onChange={(v) => onChange({ cfImageSteps: v })}
          />
          <div style={{ fontSize: 12, color: "var(--text-dim)" }}>
            지금은 장당 <span className="tabular">{perImage}</span> 뉴런 — 무료 한도로 하루{" "}
            <span className="tabular">{dailyImages}</span>장
          </div>
        </div>

        <div className="drawer-group">
          <h3>실행 방식</h3>
          <div className="switch-row">
            <div>브라우저 보기</div>
            <Switch checked={settings.showBrowser} onChange={(v) => onChange({ showBrowser: v })} label="브라우저 보기" />
          </div>
          <RangeField
            label="AI 동시 실행"
            value={settings.claudeConcurrency}
            min={SETTING_LIMITS.claudeConcurrency.min}
            max={SETTING_LIMITS.claudeConcurrency.max}
            onChange={(v) => onChange({ claudeConcurrency: v })}
          />
          <RangeField
            label="AI 응답 대기(초)"
            value={settings.claudeTimeoutSec}
            min={SETTING_LIMITS.claudeTimeoutSec.min}
            max={SETTING_LIMITS.claudeTimeoutSec.max}
            onChange={(v) => onChange({ claudeTimeoutSec: v })}
          />
        </div>

        <button type="button" className="btn" onClick={resetDefaults} disabled={resetting}>
          기본값으로 되돌리기
        </button>
      </div>
    </>
  );
}
