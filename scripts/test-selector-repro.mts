import { chromium } from "playwright";

// 10장 A: "로컬 HTML에 취소/취소선 버튼을 나란히 두고 옛 셀렉터 2개 vs :text-is 1개" (7-1)
// "발행/예약 발행 0건 → has-text 2개 vs 데이터속성 1개" (7-2)
const CHROMIUM = process.env.PW_CHROMIUM ?? "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";

const html = `
<!doctype html><html><body>
  <button class="se-popup-button-cancel">취소</button>
  <button class="se-strike-toolbar-button">취소선</button>
  <button data-click-area="tpb.publish">발행</button>
  <button class="reserve-btn">예약 발행 0건</button>
</body></html>
`;

const browser = await chromium.launch({ executablePath: CHROMIUM });
const page = await browser.newPage();
await page.setContent(html);

// ===== 7-1: has-text('취소') 부분일치 =====
const oldMatches = await page.locator("button:has-text('취소')").count();
const newMatches = await page.locator("button:text-is('취소')").count();
if (oldMatches !== 2) throw new Error(`옛 셀렉터(has-text) 기대 2개, 실제 ${oldMatches}개`);
if (newMatches !== 1) throw new Error(`새 셀렉터(:text-is) 기대 1개, 실제 ${newMatches}개`);
console.log(`✅ 7-1 재현: button:has-text('취소') = ${oldMatches}개(취소+취소선 둘 다 매칭) vs button:text-is('취소') = ${newMatches}개(취소만)`);

// ===== 7-2: has-text('발행') 부분일치 =====
const oldPublishMatches = await page.locator("button:has-text('발행')").count();
const newPublishMatches = await page.locator("button[data-click-area='tpb.publish']").count();
if (oldPublishMatches !== 2) throw new Error(`옛 셀렉터(has-text 발행) 기대 2개, 실제 ${oldPublishMatches}개`);
if (newPublishMatches !== 1) throw new Error(`새 셀렉터(data-click-area) 기대 1개, 실제 ${newPublishMatches}개`);
console.log(`✅ 7-2 재현: button:has-text('발행') = ${oldPublishMatches}개(발행+예약발행 둘 다 매칭) vs data-click-area = ${newPublishMatches}개(발행만)`);

await browser.close();
