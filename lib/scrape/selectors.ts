// ★ 네이버 셀렉터 중앙 관리 (13장: "이 파일 한 곳만 고치면 되도록 설계를 유지하라").
//
// 아래 값들은 살아 있는 네이버 스마트에디터 ONE에서 실제로 클릭까지 확인한 실측값이다.
// 리팩터링·정리·통합의 대상이 아니다. 더 우아해 보이는 대안으로 바꾸지 마라.
//
// 각 항목은 "후보 배열"이다 — 위에서부터 isVisible인 첫 번째를 쓴다.
// 네이버 DOM이 계정·시점·A/B에 따라 달라 새 값이 필요해지면, 기존 값은 지우지 말고
// 배열 "앞"에 새 값을 추가한다 (8-5, 9장 6.5-b).

export const EDITOR = {
  frame: "iframe#mainFrame",

  // ⚠️ 7-3: 복원 팝업이 뜰 때 반투명 차단막이 함께 깔린다. 남아있으면 클릭이 조용히 무시된다.
  restorePopup: [".se-popup-container", ".se-popup-dialog", ".se-popup", "[class*='popup_container']"],

  // ⚠️ 7-1 ★최악: `:has-text('취소')`는 '취소선' 버튼에도 부분일치해 전역 취소선을 켜버린다.
  //   틀린 추측: 물결표(~~)가 마크다운 취소선으로 변환됐다 — DB 초안에 물결표가 0개였으므로 기각.
  //   진짜 원인: has-text의 부분일치. 클래스 기반을 먼저 쓰고, 텍스트는 팝업 안으로 스코프 +
  //   :text-is('취소') 정확일치만 쓴다 (':text-is'는 '취소선'에 매칭되지 않는다).
  restoreCancel: [
    "button.se-popup-button-cancel",
    ".se-popup-button-cancel",
    ".se-popup-container button:text-is('취소')",
    ".se-popup-dialog button:text-is('취소')",
  ],

  title: [".se-section-documentTitle .se-text-paragraph", ".se-documentTitle .se-text-paragraph", ".se-title-text"],

  // ⚠️ 7-26: 본문을 못 찾으면 Enter로 한 번 더 시도하고, 그래도 못 찾으면 즉시 실패 처리해야 한다.
  // 조용히 진행하면 글 전체가 제목 칸에 들어간다.
  body: [".se-section-text .se-text-paragraph", ".se-component-content .se-text-paragraph", ".se-main-container"],

  imageButton: [
    "button.se-image-toolbar-button",
    "button[data-name='image']",
    "button[data-log='sti.image']",
    "button.se-toolbar-item-image",
  ],

  helpPanel: [".se-help-container", ".se-help-panel"],
  helpClose: [".se-help-panel-close-button", ".se-help-header button"],
  popupDim: [".se-popup-dim"],

  textFormatOpen: [".se-text-format-toolbar-button"],
  optHeading: [".se-toolbar-option-text-format-sectionTitle-button"],
  optBody: [".se-toolbar-option-text-format-text-button"],
  optQuote: [".se-toolbar-option-text-format-quotation-button"],
  dividerInsert: [".se-insert-horizontal-line-default-toolbar-button"],
  bold: [".se-bold-toolbar-button"],
  bgColorOpen: [".se-background-color-toolbar-button"],
  bgColorYellow: ["button[title='#fff8b2']", ".se-color-palette[title='#fff8b2']"],
  bgColorNone: [".se-color-palette-no-color"],
  contentComponents: [".se-content .se-component"],

  // ⚠️ 7-2: `:has-text('발행')`이 '예약 발행 0건'을 누른다. data-click-area 속성을 쓴다.
  // 최종 확인 버튼은 `tpb*i.publish` — `*`가 들어간 값이 맞다(오타 아님).
  publishOpen: ["button[data-click-area='tpb.publish']", "button.publish_btn__m9KHH"],
  publishConfirm: ["button[data-click-area='tpb*i.publish']", "button.confirm_btn__WEaBq"],

  // ⚠️ 7-19: radio input은 opacity:0이라 클릭되지 않는다. label을 눌러야 한다.
  // 네이버 기본값은 전체공개(open_public, value=2)다.
  visibility: {
    public: { label: 'label[for="open_public"]', input: "#open_public" },
    neighbor: { label: 'label[for="open_neighbor"]', input: "#open_neighbor" },
    both: { label: 'label[for="open_both_neighbor"]', input: "#open_both_neighbor" },
    private: { label: 'label[for="open_private"]', input: "#open_private" },
  },

  caption: [".se-caption"], // 펼쳐지면 se-is-on 클래스가 붙는다 (7-18)
  imageComponent: [".se-content .se-component.se-image"],

  // ⚠️ 7-21: 우측 도크의 클래스는 환경에 따라 다르다. 두 계열을 모두 닫아야 한다.
  sidebarClose: [".se-help-panel-close-button", ".se-sidebar-close-button"],
  sidebar: [".se-sidebar", ".se-sidebar-container-library"],

  // ⚠️ 7-6: 하단 글감 검색바 — 여기로 타이핑이 샌다. 탈출 클릭 y좌표를 이 바 위쪽으로 클램프해야 한다.
  bottomToolbar: [".se-flayer-unified-toolbar-wrapper"],
  bottomSearchInput: [".se-flayer-unified-search-input"],
} as const;

export type SelectorList = readonly string[];
