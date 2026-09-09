// 서버·클라이언트 공용 순수 함수. 외부 의존성 없음 (config/settings 마저도 참조하지 않는다).

// ⚠️ 7-12: 문서만 보면 "타일 × 4.8 + 스텝 × 9.6"처럼 읽히지만 틀린 공식이다.
// 스텝 요금은 이미지 1장이 아니라 타일마다 붙는다.
// 잘못: tiles*4.8 + steps*9.6   → 4×4.8 + 6×9.6 = 76.8/장 (실측의 3.4배 과소평가)
// 맞음: tiles*(4.8 + steps*9.6) → 4×(4.8 + 6×9.6) = 249.6/장 (실측 7,738÷31장=249.6, 오차 0.4)
export function neuronsPerImage(steps: number, size = 1024): number {
  const tiles = Math.max(1, Math.round((size / 512) * (size / 512)));
  const clampedSteps = Math.min(Math.max(steps, 1), 8);
  return tiles * (4.8 + clampedSteps * 9.6);
}

// ⚠️ 반환값은 정수가 아니다(6스텝 = 249.6). 계산은 실수로 하고, 화면 표시할 때만 Math.round().
export function displayNeurons(n: number): number {
  return Math.round(n);
}

export const FREE_DAILY_NEURONS = 10_000;

export function imagesPerDay(steps: number, size = 1024, budget = FREE_DAILY_NEURONS): number {
  const perImage = neuronsPerImage(steps, size);
  return Math.floor(budget / perImage);
}

export function articlesPerDay(steps: number, imagesPerArticle: number, size = 1024, budget = FREE_DAILY_NEURONS) {
  return Math.floor(imagesPerDay(steps, size, budget) / imagesPerArticle);
}
