import { DEFAULT_SETTINGS } from "@/config";

if (DEFAULT_SETTINGS.dryRun !== true) throw new Error("기본값이 dryRun=true 여야 함");
console.log("✅ @/* 별칭 해석 확인, dryRun 기본값 true");
