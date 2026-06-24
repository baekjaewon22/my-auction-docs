

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

export async function slide05(presentation, ctx) {
  const slide = presentation.slides.add();
  bg(slide, ctx, 5);
  kicker(slide, ctx, "BAD TO BETTER");
  title(slide, ctx, "반려되는 목적은 대개 짧아서가 아니라 판단 정보가 부족합니다.");
  const pairs = [
    ["필요해서 신청합니다.", "고객 상담 일정 증가로 상담 내용을 안정적으로 기록하기 위해 녹취 장비를 신청합니다."],
    ["업무에 사용하려고 합니다.", "담당 사건 자료 정리와 팀 공유를 위해 클라우드 저장공간을 신청합니다."],
    ["외근 다녀오겠습니다.", "2026타경1234 물건 현장 확인 및 주변 시세 조사를 위해 외근을 신청합니다."],
  ];
  pairs.forEach((p, i) => {
    const y = 224 + i * 118;
    shape(slide, ctx, 80, y, 430, 76, "#FFF7F5", "#F0B3A8", 1, "roundRect");
    text(slide, ctx, "부족", 104, y + 14, 60, 18, { size: 11, color: C.red, bold: true });
    text(slide, ctx, p[0], 104, y + 38, 360, 24, { size: 18, color: C.ink, serif: true });
    text(slide, ctx, "→", 548, y + 24, 40, 26, { size: 24, color: C.muted, align: "center" });
    shape(slide, ctx, 620, y, 560, 76, "#F4FBF6", "#A9D8B5", 1, "roundRect");
    text(slide, ctx, "개선", 644, y + 14, 60, 18, { size: 11, color: C.green, bold: true });
    text(slide, ctx, p[1], 644, y + 36, 490, 28, { size: 17, color: C.ink, serif: true });
  });
  return slide;
}
