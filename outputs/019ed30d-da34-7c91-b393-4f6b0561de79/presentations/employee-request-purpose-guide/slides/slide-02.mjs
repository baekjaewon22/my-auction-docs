

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

export async function slide02(presentation, ctx) {
  const slide = presentation.slides.add();
  bg(slide, ctx, 2);
  kicker(slide, ctx, "WHY IT MATTERS");
  title(slide, ctx, "신청 목적은 ‘무엇을 해주세요’가 아니라 ‘왜 해야 하는지’를 설명합니다.");
  sectionBox(slide, ctx, "결재자가 보는 것", "업무상 필요한 신청인지\n비용·시간·권한이 타당한지\n승인 후 처리 방향이 명확한지", 80, 276, 330, 210, C.blue);
  sectionBox(slide, ctx, "작성자가 해야 할 것", "신청 배경을 한 문장으로 쓰고\n구체적 대상·기간·결과를 적고\n불필요한 감정 표현은 줄입니다", 476, 276, 330, 210, C.orange);
  sectionBox(slide, ctx, "좋은 목적의 효과", "반려가 줄고\n추가 질문이 줄고\n처리 속도가 빨라집니다", 872, 276, 330, 210, C.green);
  bullet(slide, ctx, "결재자는 신청 목적만 보고도 승인 판단의 70%를 끝낼 수 있어야 합니다.", 96, 560, 940);
  return slide;
}
