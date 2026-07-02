import fs from "node:fs/promises";
import path from "node:path";

const workspace = path.resolve("outputs/019ed30d-da34-7c91-b393-4f6b0561de79/presentations/employee-request-purpose-guide");
const slidesDir = path.join(workspace, "slides");
const outputDir = path.join(workspace, "output");

const common = String.raw`
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
`;

const slideSources = [
  {
    file: "slide-01.mjs",
    fn: "slide01",
    body: `
${common}
export async function slide01(presentation, ctx) {
  const slide = presentation.slides.add();
  bg(slide, ctx, 1);
  text(slide, ctx, "TEAM GUIDE", 54, 108, 240, 22, { size: 11, color: C.orange, bold: true });
  text(slide, ctx, "사원용 신청 목적은\\n결재자가 바로 판단할 수 있게\\n‘왜 필요한지’를 쓰는 칸입니다.", 54, 166, 760, 190, { size: 42, color: C.ink, bold: true, serif: true });
  shape(slide, ctx, 870, 132, 300, 382, C.dark, C.dark, 0, "roundRect");
  text(slide, ctx, "목적 문장은\\n짧을수록 좋지만\\n근거는 빠지면 안 됩니다.", 908, 180, 224, 110, { size: 28, color: C.white, bold: true, serif: true });
  text(slide, ctx, "이 가이드는 팀원이 신청서를 작성할 때 목적란을 어떻게 채워야 하는지 설명합니다.", 908, 330, 220, 80, { size: 14, color: "#C9D2DC" });
  pill(slide, ctx, "대상: 팀원", 54, 520, 120, C.blue);
  pill(slide, ctx, "용도: 작성 가이드", 188, 520, 168, C.green);
  pill(slide, ctx, "핵심: 판단 가능성", 370, 520, 180, C.orange);
  smallNote(slide, ctx, "배포용 PDF와 편집 가능한 PPT 원본으로 함께 제공", 54, 618, 520);
  return slide;
}
`,
  },
  {
    file: "slide-02.mjs",
    fn: "slide02",
    body: `
${common}
export async function slide02(presentation, ctx) {
  const slide = presentation.slides.add();
  bg(slide, ctx, 2);
  kicker(slide, ctx, "WHY IT MATTERS");
  title(slide, ctx, "신청 목적은 ‘무엇을 해주세요’가 아니라 ‘왜 해야 하는지’를 설명합니다.");
  sectionBox(slide, ctx, "결재자가 보는 것", "업무상 필요한 신청인지\\n비용·시간·권한이 타당한지\\n승인 후 처리 방향이 명확한지", 80, 276, 330, 210, C.blue);
  sectionBox(slide, ctx, "작성자가 해야 할 것", "신청 배경을 한 문장으로 쓰고\\n구체적 대상·기간·결과를 적고\\n불필요한 감정 표현은 줄입니다", 476, 276, 330, 210, C.orange);
  sectionBox(slide, ctx, "좋은 목적의 효과", "반려가 줄고\\n추가 질문이 줄고\\n처리 속도가 빨라집니다", 872, 276, 330, 210, C.green);
  bullet(slide, ctx, "결재자는 신청 목적만 보고도 승인 판단의 70%를 끝낼 수 있어야 합니다.", 96, 560, 940);
  return slide;
}
`,
  },
  {
    file: "slide-03.mjs",
    fn: "slide03",
    body: `
${common}
export async function slide03(presentation, ctx) {
  const slide = presentation.slides.add();
  bg(slide, ctx, 3);
  kicker(slide, ctx, "WRITING FORMULA");
  title(slide, ctx, "목적 문장은 네 조각으로 쓰면 대부분 충분합니다.");
  const xs = [78, 352, 626, 900];
  const labels = ["상황", "필요", "사용", "기대 결과"];
  const values = [
    "현재 어떤 업무 상황인지",
    "왜 신청이 필요한지",
    "무엇에 사용할 것인지",
    "처리 후 어떤 결과가 나는지",
  ];
  xs.forEach((x, i) => {
    shape(slide, ctx, x, 278, 220, 170, "#FFFFFF", C.line, 1, "roundRect");
    text(slide, ctx, String(i + 1), x + 18, 296, 36, 32, { size: 28, color: [C.blue, C.orange, C.green, C.red][i], bold: true, serif: true });
    text(slide, ctx, labels[i], x + 60, 304, 120, 22, { size: 15, color: C.ink, bold: true });
    text(slide, ctx, values[i], x + 24, 354, 170, 48, { size: 14, color: C.muted });
  });
  text(slide, ctx, "작성 공식", 88, 512, 120, 22, { size: 12, color: C.orange, bold: true });
  text(slide, ctx, "[업무 상황] 때문에 [필요 사항]을 [사용 목적]으로 신청하며, [기대 결과]를 달성하고자 합니다.", 88, 548, 1040, 48, { size: 24, color: C.ink, bold: true, serif: true });
  return slide;
}
`,
  },
  {
    file: "slide-04.mjs",
    fn: "slide04",
    body: `
${common}
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
`,
  },
  {
    file: "slide-05.mjs",
    fn: "slide05",
    body: `
${common}
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
`,
  },
  {
    file: "slide-06.mjs",
    fn: "slide06",
    body: `
${common}
export async function slide06(presentation, ctx) {
  const slide = presentation.slides.add();
  bg(slide, ctx, 6);
  kicker(slide, ctx, "DO / DON'T");
  title(slide, ctx, "목적란에는 업무 판단에 필요한 정보만 남깁니다.");
  shape(slide, ctx, 90, 236, 500, 300, "#F4FBF6", "#A9D8B5", 1, "roundRect");
  text(slide, ctx, "DO", 124, 268, 100, 34, { size: 30, color: C.green, bold: true, serif: true });
  bullet(slide, ctx, "대상: 고객명, 사건번호, 물건, 업무명을 적기", 126, 332, 390);
  bullet(slide, ctx, "이유: 일정 증가, 처리 지연 방지, 품질 개선 등", 126, 386, 390);
  bullet(slide, ctx, "결과: 보고서 작성, 상담 대응, 자료 공유처럼 끝 상태 적기", 126, 440, 390);
  shape(slide, ctx, 690, 236, 500, 300, "#FFF7F5", "#F0B3A8", 1, "roundRect");
  text(slide, ctx, "DON'T", 724, 268, 140, 34, { size: 30, color: C.red, bold: true, serif: true });
  bullet(slide, ctx, "‘필요해서’, ‘개인 사정상’처럼 이유가 비어 있는 표현", 726, 332, 390);
  bullet(slide, ctx, "너무 긴 배경 설명이나 감정적인 표현", 726, 386, 390);
  bullet(slide, ctx, "승인 후 무엇이 달라지는지 알 수 없는 문장", 726, 440, 390);
  return slide;
}
`,
  },
  {
    file: "slide-07.mjs",
    fn: "slide07",
    body: `
${common}
export async function slide07(presentation, ctx) {
  const slide = presentation.slides.add();
  bg(slide, ctx, 7);
  kicker(slide, ctx, "CHECKLIST");
  title(slide, ctx, "제출 전 30초만 확인하면 반려를 크게 줄일 수 있습니다.");
  const checks = [
    ["업무 관련성", "개인 편의가 아니라 업무 필요성이 보이는가?"],
    ["구체성", "대상·기간·장소·사건번호 중 필요한 정보가 들어갔는가?"],
    ["사용 목적", "신청한 것을 어디에 사용할지 적었는가?"],
    ["기대 결과", "승인 후 어떤 업무 결과가 나오는지 보이는가?"],
    ["문장 길이", "한두 문장으로 읽히는가?"],
  ];
  checks.forEach((c, i) => {
    const y = 208 + i * 72;
    ctx.addShape(slide, { left: 90, top: y + 8, width: 24, height: 24, fill: i < 4 ? C.blue : C.orange, line: ctx.line("#00000000", 0), geometry: "ellipse" });
    text(slide, ctx, "✓", 95, y + 8, 16, 18, { size: 13, color: C.white, bold: true, align: "center" });
    text(slide, ctx, c[0], 136, y, 180, 24, { size: 17, color: C.ink, bold: true });
    text(slide, ctx, c[1], 336, y, 720, 30, { size: 18, color: C.muted, serif: true });
    ctx.addShape(slide, { left: 136, top: y + 46, width: 910, height: 1, fill: C.line, line: ctx.line("#00000000", 0) });
  });
  return slide;
}
`,
  },
  {
    file: "slide-08.mjs",
    fn: "slide08",
    body: `
${common}
export async function slide08(presentation, ctx) {
  const slide = presentation.slides.add();
  bg(slide, ctx, 8);
  kicker(slide, ctx, "FINAL TEMPLATE");
  title(slide, ctx, "복붙용 기본 문장으로 시작하고, 빈칸만 업무에 맞게 바꾸세요.");
  shape(slide, ctx, 96, 238, 1088, 170, "#FFFFFF", C.line, 1, "roundRect");
  text(slide, ctx, "[업무 상황]으로 인해 [신청 대상]이 필요하여 신청합니다.\\n해당 사항은 [구체적 사용 목적]에 활용하고, [기대 결과]를 달성하기 위한 목적입니다.", 136, 278, 1008, 90, { size: 27, color: C.ink, bold: true, serif: true });
  shape(slide, ctx, 96, 462, 1088, 96, C.dark, C.dark, 0, "roundRect");
  text(slide, ctx, "한 줄 원칙", 136, 486, 130, 24, { size: 13, color: C.orange, bold: true });
  text(slide, ctx, "신청 목적은 ‘상황 + 필요 + 사용 + 결과’가 보이면 충분합니다.", 288, 482, 760, 34, { size: 26, color: C.white, bold: true, serif: true });
  smallNote(slide, ctx, "팀장 검토 전에는 목적 문장만 따로 읽어 보고, 신청서 제목 없이도 이해되는지 확인합니다.", 136, 610, 900);
  return slide;
}
`,
  },
];

async function main() {
  await fs.mkdir(slidesDir, { recursive: true });
  await fs.mkdir(outputDir, { recursive: true });
  for (const s of slideSources) {
    await fs.writeFile(path.join(slidesDir, s.file), s.body, "utf8");
  }

  const notes = {
    "profile-plan.txt": "task mode: create\nprimary deck-profile: strategy-leadership\nsecondary gates: team guide clarity, no external identity assets\nrequired proof objects: writing formula, examples, checklist\nknown missing inputs: exact company policy wording not supplied; generic internal guide used\n",
    "claim-spine.txt": "thesis: 사원용 신청 목적은 결재 판단을 돕는 업무 근거 문장이다.\naudience: team members writing internal requests\narc: why it matters -> formula -> examples -> mistakes -> checklist -> reusable template\nslides: 1 cover, 2 role, 3 formula, 4 examples, 5 bad-to-better, 6 do/don't, 7 checklist, 8 template\n",
    "design-system.txt": "1280x720. Warm paper background, dark ink, blue/orange/green accents. Editorial internal guide style. Use native editable text and shapes only. No logos or unverified identity assets.\n",
    "contact-sheet-plan.txt": "8 slides with varied layouts: cover, three proof boxes, formula sequence, example rows, contrast pairs, do/don't split, checklist, final template.\n",
  };
  for (const [name, body] of Object.entries(notes)) {
    await fs.writeFile(path.join(workspace, name), body, "utf8");
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
