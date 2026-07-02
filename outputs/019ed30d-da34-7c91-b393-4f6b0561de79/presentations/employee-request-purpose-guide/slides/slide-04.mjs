

const C = {
  bg: "#F7F4EC",
  ink: "#1F2933",
  muted: "#68717D",
  line: "#D8D0C2",
  blue: "#1A73E8",
  orange: "#F57C00",
  green: "#188038",
  red: "#D93025",
  dark: "#18202A",
  white: "#FFFFFF",
  soft: "#EFE8DA",
};

function shape(slide, ctx, x, y, w, h, fill = C.white, line = C.line, width = 1, radius = "roundRect") {
  return ctx.addShape(slide, { left: x, top: y, width: w, height: h, geometry: radius, fill, line: ctx.line(line, width) });
}

function text(slide, ctx, value, x, y, w, h, opt = {}) {
  return ctx.addText(slide, {
    text: value,
    left: x,
    top: y,
    width: w,
    height: h,
    fontSize: opt.size || 22,
    color: opt.color || C.ink,
    bold: !!opt.bold,
    face: opt.face || (opt.serif ? "Georgia" : "Aptos"),
    align: opt.align || "left",
    valign: opt.valign || "top",
    fill: opt.fill || "#00000000",
    line: ctx.line("#00000000", 0),
    insets: opt.insets || { left: 0, right: 0, top: 0, bottom: 0 },
  });
}

function bg(slide, ctx, n) {
  ctx.addShape(slide, { left: 0, top: 0, width: 1280, height: 720, fill: C.bg, line: ctx.line("#00000000", 0) });
  text(slide, ctx, "사원용 신청 목적 작성 가이드", 54, 34, 420, 22, { size: 10, color: C.muted, bold: true });
  text(slide, ctx, String(n).padStart(2, "0"), 1184, 34, 42, 22, { size: 10, color: C.muted, bold: true, align: "right" });
  ctx.addShape(slide, { left: 54, top: 66, width: 1172, height: 1, fill: C.line, line: ctx.line("#00000000", 0) });
}

function kicker(slide, ctx, label, x = 54, y = 92) {
  ctx.addShape(slide, { left: x, top: y + 4, width: 28, height: 3, fill: C.orange, line: ctx.line("#00000000", 0), name: "kicker-marker" });
  text(slide, ctx, label, x + 42, y - 2, 360, 18, { size: 10, color: C.muted, bold: true, name: "kicker-label" });
}

function title(slide, ctx, value, y = 126, size = 36) {
  text(slide, ctx, value, 54, y, 780, 94, { size, color: C.ink, bold: true, serif: true });
}

function pill(slide, ctx, value, x, y, w, color = C.blue) {
  shape(slide, ctx, x, y, w, 34, "#FFFFFF", color, 1.2, "roundRect");
  text(slide, ctx, value, x + 14, y + 8, w - 28, 16, { size: 10.5, color, bold: true, align: "center" });
}

function bullet(slide, ctx, value, x, y, w, color = C.ink) {
  ctx.addShape(slide, { left: x, top: y + 8, width: 5, height: 5, fill: C.orange, line: ctx.line("#00000000", 0), geometry: "ellipse" });
  text(slide, ctx, value, x + 18, y, w, 38, { size: 15, color });
}

function sectionBox(slide, ctx, label, value, x, y, w, h, accent = C.blue) {
  shape(slide, ctx, x, y, w, h, "#FFFFFF", C.line, 1, "roundRect");
  ctx.addShape(slide, { left: x, top: y, width: 5, height: h, fill: accent, line: ctx.line("#00000000", 0) });
  text(slide, ctx, label, x + 22, y + 18, w - 44, 20, { size: 11, color: accent, bold: true });
  text(slide, ctx, value, x + 22, y + 48, w - 44, h - 64, { size: 17, color: C.ink, bold: true, serif: true });
}

function smallNote(slide, ctx, value, x, y, w) {
  text(slide, ctx, value, x, y, w, 44, { size: 11, color: C.muted });
}

export async function slide04(presentation, ctx) {
  const slide = presentation.slides.add();
  bg(slide, ctx, 4);
  kicker(slide, ctx, "GOOD EXAMPLES");
  title(slide, ctx, "유형별 목적은 ‘업무 대상’과 ‘결과’를 함께 적습니다.");
  const rows = [
    ["비품·장비", "고객 상담 녹취 품질 개선을 위해 마이크를 구매하여 상담 기록 정확도를 높이고자 합니다."],
    ["교육·세미나", "경매 실무 상담 역량 강화를 위해 관련 교육을 수강하고, 팀 내 사례 공유 자료로 활용하고자 합니다."],
    ["외근·출장", "의뢰 물건 현장 확인과 주변 시세 조사를 위해 외근을 신청하며, 조사 결과를 물건 검토에 반영하고자 합니다."],
    ["자료·권한", "담당 사건 진행 현황 확인을 위해 시스템 접근 권한을 신청하며, 업무 처리 지연을 방지하고자 합니다."],
  ];
  rows.forEach((r, i) => {
    const y = 230 + i * 84;
    text(slide, ctx, r[0], 76, y + 8, 150, 24, { size: 15, color: [C.blue, C.orange, C.green, C.red][i], bold: true });
    ctx.addShape(slide, { left: 236, top: y + 18, width: 1, height: 44, fill: C.line, line: ctx.line("#00000000", 0) });
    text(slide, ctx, r[1], 268, y, 840, 54, { size: 19, color: C.ink, serif: true });
  });
  smallNote(slide, ctx, "문장 끝은 ‘하고자 합니다’, ‘활용하고자 합니다’, ‘방지하고자 합니다’처럼 처리 목적이 보이게 마무리합니다.", 76, 610, 960);
  return slide;
}
