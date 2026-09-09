// 검증 스크립트 진입점. scripts/test-*.mts 를 전부 순서대로 실행한다.
// tsx는 tsconfig의 @/* 별칭을 그대로 인식하므로 lib/*.ts를 바로 import할 수 있다.
import fs from "node:fs";
import path from "node:path";

const dir = path.resolve(process.cwd(), "scripts");
const files = fs
  .readdirSync(dir)
  .filter((f) => f.startsWith("test-") && (f.endsWith(".mts") || f.endsWith(".ts")))
  .sort();

let failed = 0;
for (const f of files) {
  const full = path.join(dir, f);
  console.log(`\n=== ${f} ===`);
  try {
    await import(full);
  } catch (e) {
    failed++;
    console.error(`❌ ${f} 실패:`, e);
  }
}

if (failed > 0) {
  console.error(`\n${failed}개 스크립트 실패`);
  process.exit(1);
} else {
  console.log(`\n전체 통과 (${files.length}개)`);
}
