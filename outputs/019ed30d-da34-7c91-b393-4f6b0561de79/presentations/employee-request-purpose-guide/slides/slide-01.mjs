

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

export async function slide01(presentation, ctx) {
  const slide = presentation.slides.add();
  bg(slide, ctx, 1);
  text(slide, ctx, "TEAM GUIDE", 54, 108, 240, 22, { size: 11, color: C.orange, bold: true });
  text(slide, ctx, "사원용 신청 목적은\n결재자가 바로 판단할 수 있게\n‘왜 필요한지’를 쓰는 칸입니다.", 54, 166, 760, 190, { size: 42, color: C.ink, bold: true, serif: true });
  shape(slide, ctx, 870, 132, 300, 382, C.dark, C.dark, 0, "roundRect");
  text(slide, ctx, "목적 문장은\n짧을수록 좋지만\n근거는 빠지면 안 됩니다.", 908, 180, 224, 110, { size: 28, color: C.white, bold: true, serif: true });
  text(slide, ctx, "이 가이드는 팀원이 신청서를 작성할 때 목적란을 어떻게 채워야 하는지 설명합니다.", 908, 330, 220, 80, { size: 14, color: "#C9D2DC" });
  pill(slide, ctx, "대상: 팀원", 54, 520, 120, C.blue);
  pill(slide, ctx, "용도: 작성 가이드", 188, 520, 168, C.green);
  pill(slide, ctx, "핵심: 판단 가능성", 370, 520, 180, C.orange);
  smallNote(slide, ctx, "배포용 PDF와 편집 가능한 PPT 원본으로 함께 제공", 54, 618, 520);
  return slide;
}
