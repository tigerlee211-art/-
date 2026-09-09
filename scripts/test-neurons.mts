import { neuronsPerImage, displayNeurons, imagesPerDay, articlesPerDay } from "@/lib/ai/neurons";

// 7-12/10장A 표: steps → (장당 반올림, 하루 장수, 5장짜리 글 편수)
const table: [number, number, number, number][] = [
  [2, 96, 104, 20],
  [4, 173, 57, 11],
  [6, 250, 40, 8],
  [8, 326, 30, 6],
];

for (const [steps, perImage, daily, articles5] of table) {
  const p = neuronsPerImage(steps);
  const d = imagesPerDay(steps);
  const a = articlesPerDay(steps, 5);
  if (displayNeurons(p) !== perImage) throw new Error(`steps=${steps} 장당 기대 ${perImage}, 실제 ${displayNeurons(p)}`);
  if (d !== daily) throw new Error(`steps=${steps} 하루 기대 ${daily}, 실제 ${d}`);
  if (a !== articles5) throw new Error(`steps=${steps} 5장글 기대 ${articles5}, 실제 ${a}`);
}
console.log("✅ 뉴런 공식 표 전부 일치 (96/173/250/326, 104/57/40/30장, 20/11/8/6편)");

// 6스텝 = 249.6 정확히 (정수 아님을 확인)
const six = neuronsPerImage(6);
if (Math.abs(six - 249.6) > 1e-9) throw new Error(`6스텝 기대 249.6, 실제 ${six}`);
if (Number.isInteger(six)) throw new Error("6스텝 결과가 정수임 — 소수점이 사라짐");
console.log(`✅ 6스텝 = ${six} (정수 아님, 표시할 때만 반올림)`);

// 실측 7,738 ÷ 31장 = 249.6 (오차 0.4) 검증
const measured = 7738 / 31;
if (Math.abs(measured - six) > 0.5) throw new Error(`실측과 공식 오차가 너무 큼: ${measured} vs ${six}`);
console.log(`✅ 실측 대조: 7738÷31=${measured.toFixed(2)} vs 공식 ${six} (오차 ${Math.abs(measured - six).toFixed(2)})`);
