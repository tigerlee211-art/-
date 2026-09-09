import { NextResponse } from "next/server";
import { spawn } from "node:child_process";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// ⚠️ 7-14: <input webkitdirectory>는 보안상 상대 경로만 줘서 Playwright 업로드에 못 쓴다.
// 로컬 전용 앱이므로 OS 네이티브 폴더 선택 대화상자를 백엔드에서 띄운다.
const TIMEOUT_MS = 2 * 60 * 1000; // 2분 — 사용자가 대화상자를 방치하면 서버 요청이 영원히 안 끝난다

function stripTrailingSep(p: string): string {
  return p.replace(/[/\\]+$/, "");
}

function runDialog(cmd: string, args: string[]): Promise<{ stdout: string; stderr: string; timedOut: boolean }> {
  return new Promise((resolve) => {
    const p = spawn(cmd, args);
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      p.kill();
    }, TIMEOUT_MS);
    p.stdout.on("data", (d) => (stdout += d.toString()));
    p.stderr.on("data", (d) => (stderr += d.toString()));
    p.on("close", () => {
      clearTimeout(timer);
      resolve({ stdout, stderr, timedOut });
    });
    p.on("error", () => {
      clearTimeout(timer);
      resolve({ stdout, stderr: stderr || "실행 실패", timedOut });
    });
  });
}

export async function POST() {
  const platform = process.platform;

  if (platform === "darwin") {
    const { stdout, stderr, timedOut } = await runDialog("osascript", [
      "-e",
      'POSIX path of (choose folder with prompt "사진이 들어있는 폴더를 선택하세요")',
    ]);
    if (timedOut) return NextResponse.json({ error: "시간이 초과됐습니다. 다시 시도해 주세요." }, { status: 408 });
    if (/User canceled/i.test(stderr)) return NextResponse.json({ canceled: true });
    const path = stripTrailingSep(stdout.trim());
    if (!path) return NextResponse.json({ error: "폴더를 확인하지 못했습니다." }, { status: 500 });
    return NextResponse.json({ path });
  }

  if (platform === "win32") {
    // ⚠️ -STA 필수 — WinForms 대화상자는 STA 아파트먼트에서만 뜬다. (윈도우 동작은 미검증)
    const script =
      "Add-Type -AssemblyName System.Windows.Forms; " +
      "$f = New-Object System.Windows.Forms.FolderBrowserDialog; " +
      "if ($f.ShowDialog() -eq 'OK') { $f.SelectedPath }";
    const { stdout, timedOut } = await runDialog("powershell", ["-NoProfile", "-STA", "-Command", script]);
    if (timedOut) return NextResponse.json({ error: "시간이 초과됐습니다. 다시 시도해 주세요." }, { status: 408 });
    // 윈도우는 취소 판정이 다르다: stdout이 비어 있으면 취소.
    const trimmed = stdout.trim();
    if (!trimmed) return NextResponse.json({ canceled: true });
    return NextResponse.json({ path: stripTrailingSep(trimmed) });
  }

  // 대화상자를 띄울 수 없는 플랫폼(Linux 등) — 경로 직접 입력 칸은 항상 제공해야 한다.
  return NextResponse.json({ unsupported: true, message: "이 환경에서는 폴더 선택창을 지원하지 않습니다. 경로를 직접 입력해 주세요." });
}
