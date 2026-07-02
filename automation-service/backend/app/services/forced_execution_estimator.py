# -*- coding: utf-8 -*-
"""강제집행 비용 계산기 결과 PNG 생성."""

from __future__ import annotations

import math
import os
import re
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

from ..core.utils import track_file


COLORS = {
    "bg": "#f8f9fb",
    "navy": "#0f2a5c",
    "navy_light": "#1e3a7b",
    "gold": "#c8922a",
    "gold_light": "#d4a84b",
    "gold_dark": "#a87020",
    "card": "#ffffff",
    "border": "#e5e7eb",
    "text": "#111827",
    "muted": "#6b7280",
    "soft": "#fffbf0",
    "green": "#10b981",
    "green_dark": "#059669",
}


BUILDING_LABELS = {
    "villa": "빌라/다세대",
    "apartment": "아파트",
    "commercial": "상가/오피스텔",
    "other": "기타",
}

SECTIONAL_ATTORNEY_FEE = 900000
OTHER_ATTORNEY_FEE = 3000000


def pyeong_to_sqm(pyeong: float) -> float:
    return pyeong * 3.305785


def sqm_to_pyeong(sqm: float) -> float:
    return sqm / 3.305785


def calc_cost(area: float, area_unit: str = "sqm") -> dict:
    area_pyeong = sqm_to_pyeong(area or 0) if area_unit == "sqm" else (area or 0)
    area_sqm = pyeong_to_sqm(area or 0) if area_unit == "pyeong" else (area or 0)

    filing_fee = 150000
    container_count = math.ceil(area_sqm / 75) if area_sqm > 0 else 0
    transport_storage = container_count * 1100000

    if area_pyeong < 5:
        workers = 7
    elif area_pyeong < 10:
        workers = 10
    elif area_pyeong < 20:
        workers = 13
    elif area_pyeong < 30:
        workers = 16
    elif area_pyeong < 40:
        workers = 19
    elif area_pyeong < 50:
        workers = 22
    else:
        workers = 24 + math.ceil((area_pyeong - 50) / 10) * 2

    labor_base = workers * 130000
    locksmith = 200000
    ladder_truck = 350000
    witness = 100000
    options_total = locksmith + ladder_truck + witness
    grand_total = filing_fee + transport_storage + labor_base + options_total
    proposed_price = round(grand_total * 0.8)
    savings = grand_total - proposed_price

    return {
        "filingFee": filing_fee,
        "transportStorage": transport_storage,
        "containerCount": container_count,
        "laborBase": labor_base,
        "laborWorkers": workers,
        "laborSurcharge": 1,
        "laborTotal": labor_base,
        "occupancyBan": 0,
        "locksmith": locksmith,
        "ladderTruck": ladder_truck,
        "witness": witness,
        "optionsTotal": options_total,
        "grandTotal": grand_total,
        "proposedPrice": proposed_price,
        "savings": savings,
        "areaPyeong": area_pyeong,
        "areaSqm": area_sqm,
    }


def estimate_context_from_data(data: dict) -> tuple[str, bool, dict]:
    area_sqm = _parse_float(data.get("building_area_m2"))
    if area_sqm <= 0:
        area_pyeong = _parse_float(data.get("building_area_py"))
        area_sqm = pyeong_to_sqm(area_pyeong) if area_pyeong > 0 else 0

    building_type = _infer_building_type(data.get("item_type") or "")
    has_elevator = True
    cost = calc_cost(area_sqm, "sqm")
    return building_type, has_elevator, cost


def build_eviction_cost_values(data: dict) -> dict:
    _, _, cost = estimate_context_from_data(data)
    attorney_fee = _attorney_fee_from_item_type(data.get("item_type") or "")
    normal_execution_cost = int(cost["grandTotal"])
    discounted_execution_cost = int(cost["proposedPrice"])
    flat_total = int(round((attorney_fee + normal_execution_cost) * 0.8))
    cost_plus_total = attorney_fee + normal_execution_cost

    return {
        "attorney_fee": attorney_fee,
        "normal_execution_cost": normal_execution_cost,
        "myungsung_execution_cost": discounted_execution_cost,
        "flat_total": flat_total,
        "cost_plus_total": cost_plus_total,
        "attorney_fee_won": _format_won_with_space(attorney_fee),
        "normal_execution_cost_won": _format_won_with_space(normal_execution_cost),
        "myungsung_execution_cost_won": _format_won_with_space(discounted_execution_cost),
        "eviction_flat_total_label": f"총 {_format_manwon_number(flat_total)}만원",
        "eviction_flat_total_paren_label": f"(총 {_format_manwon_number(flat_total)}만원)",
        "eviction_cost_plus_total_label": f"약 {_format_manwon_number(cost_plus_total)}만원 + @",
        "eviction_cost_plus_total_paren_label": f"(약 {_format_manwon_number(cost_plus_total)}만원 + @‥.)",
        "명도_변호사수임료": attorney_fee,
        "명도_변호사수임료_원": _format_won_with_space(attorney_fee),
        "명도_정액제변호사수임료": attorney_fee,
        "명도_정액제변호사수임료_원": _format_won_with_space(attorney_fee),
        "명도_실비제변호사수임료": attorney_fee,
        "명도_실비제변호사수임료_원": _format_won_with_space(attorney_fee),
        "명도_일반강제집행비용": normal_execution_cost,
        "명도_일반강제집행비용_원": _format_won_with_space(normal_execution_cost),
        "명도_강제집행예상비용": normal_execution_cost,
        "명도_강제집행예상비용_원": _format_won_with_space(normal_execution_cost),
        "명도_명승강제집행예상비용": discounted_execution_cost,
        "명도_명승강제집행예상비용_원": _format_won_with_space(discounted_execution_cost),
        "명도_정액제총액": flat_total,
        "명도_정액제총액_표시": f"{_format_manwon_number(flat_total)}만원",
        "명도_정액제총액_괄호표시": f"(총 {_format_manwon_number(flat_total)}만원)",
        "명도_실비제총액": cost_plus_total,
        "명도_실비제총액_표시": f"약 {_format_manwon_number(cost_plus_total)}만원",
        "명도_실비제총액_괄호표시": f"(약 {_format_manwon_number(cost_plus_total)}만원 + @‥.)",
        "명도_총명도비용": flat_total,
        "명도_총명도비용_원": _format_won_with_space(flat_total),
        "명도_접수비": int(cost["filingFee"]),
        "명도_접수비_원": _format_won_with_space(int(cost["filingFee"])),
        "명도_운반및보관료": int(cost["transportStorage"]),
        "명도_운반및보관료_원": _format_won_with_space(int(cost["transportStorage"])),
        "명도_노무비": int(cost["laborTotal"]),
        "명도_노무비_원": _format_won_with_space(int(cost["laborTotal"])),
        "명도_노무인원": int(cost["laborWorkers"]),
        "명도_노무인원_명": f"{int(cost['laborWorkers'])}명",
        "명도_열쇠개문": int(cost["locksmith"]),
        "명도_열쇠개문_원": _format_won_with_space(int(cost["locksmith"])),
        "명도_사다리차": int(cost["ladderTruck"]),
        "명도_사다리차_원": _format_won_with_space(int(cost["ladderTruck"])),
        "명도_입회자동행": int(cost["witness"]),
        "명도_입회자동행_원": _format_won_with_space(int(cost["witness"])),
        "cost": cost,
    }


def _format_won_with_space(value: int) -> str:
    return f"{int(value):,} 원"


def _format_manwon_number(value: int) -> str:
    return f"{round(int(value) / 10000):,}"


def generate_forced_execution_estimate_png(data: dict, out_path: str) -> str:
    building_type, has_elevator, cost = estimate_context_from_data(data)

    width, height = 900, 1350
    image = Image.new("RGB", (width, height), COLORS["bg"])
    draw = ImageDraw.Draw(image)
    fonts = _fonts()

    _draw_estimate_result_template(draw, building_type, has_elevator, cost, fonts)

    output = Path(out_path)
    output.parent.mkdir(parents=True, exist_ok=True)
    image.save(output, "PNG")
    track_file(str(output))
    return str(output)


def _draw_estimate_result_template(draw, building_type, has_elevator, cost, fonts) -> None:
    outer_x, outer_y, outer_w, outer_h = 44, 44, 812, 1262
    content_x, content_w = 82, 736

    _draw_shadowed_card(
        draw,
        outer_x,
        outer_y,
        outer_w,
        outer_h,
        radius=34,
        fill="#ffffff",
        outline=COLORS["gold"],
        outline_width=3,
        shadow="#eadfc6",
    )

    summary = (
        f"{BUILDING_LABELS[building_type]} · {_format_area(cost['areaPyeong'])}평 · "
        f"엘리베이터 {'있음' if has_elevator else '없음'}"
    )
    summary_y = 198
    _draw_shadowed_card(draw, content_x, summary_y, content_w, 82, radius=24, fill="#ffffff", shadow="#f1f3f7")
    draw.text((content_x + 30, summary_y + 27), summary, fill="#4b5563", font=fonts["summary"])

    cards_y = 312
    gap = 34
    card_w = (content_w - gap) // 2
    card_h = 215
    left_x = content_x
    right_x = content_x + card_w + gap

    _draw_shadowed_card(draw, left_x, cards_y, card_w, card_h, radius=22, fill="#ffffff", outline=COLORS["border"], shadow="#eef0f5")
    _draw_shadowed_card(draw, right_x, cards_y, card_w, card_h, radius=22, fill=COLORS["soft"], outline=COLORS["gold"], outline_width=3, shadow="#eadfc6")
    _draw_pill(draw, right_x + card_w - 136, cards_y - 18, 116, 42, "20% 절감", fonts["badge"], fill=COLORS["green"])

    _draw_centered_text(draw, left_x, cards_y + 56, card_w, "일반 강제집행 비용", fonts["label"], "#8b95a5")
    old_text = format_won(cost["grandTotal"])
    old_y = cards_y + 108
    old_bbox = _draw_centered_text(draw, left_x, old_y, card_w, old_text, fonts["amount_old"], "#9ca3af")
    draw.line(
        (old_bbox[0], (old_bbox[1] + old_bbox[3]) // 2 + 2, old_bbox[2], (old_bbox[1] + old_bbox[3]) // 2 + 2),
        fill="#9ca3af",
        width=5,
    )

    _draw_centered_text(draw, right_x, cards_y + 46, card_w, "법률사무소 명승 대행 시", fonts["label_bold"], COLORS["gold_dark"])
    _draw_centered_text(draw, right_x, cards_y + 90, card_w, format_won(cost["proposedPrice"]), fonts["amount"], COLORS["navy"])
    _draw_centered_text(draw, right_x, cards_y + 158, card_w, f"{format_manwon(cost['savings'])} 절약", fonts["saving"], COLORS["green_dark"])

    detail_y = 562
    detail_h = 588
    _draw_shadowed_card(draw, content_x, detail_y, content_w, detail_h, radius=22, fill="#ffffff", outline=COLORS["border"], shadow="#eef0f5")
    _draw_estimate_rows(draw, content_x, detail_y, content_w, cost, fonts)


def _draw_estimate_rows(draw, x, y, w, cost, fonts) -> None:
    rows = [
        ("접수비", format_won(cost["filingFee"]), False),
        (f"운반·보관료 (컨테이너 {cost['containerCount']}대)", format_won(cost["transportStorage"]), False),
        (f"노무비 ({cost['laborWorkers']}명)", format_won(cost["laborTotal"]), False),
        ("열쇠 개문", format_won(cost["locksmith"]), False),
        ("사다리차", format_won(cost["ladderTruck"]), False),
        ("입회자 동행", format_won(cost["witness"]), False),
        ("합계", format_won(cost["grandTotal"]), True),
    ]
    row_h = 73
    row_y = y + 29
    for idx, (label, value, is_total) in enumerate(rows):
        label_font = fonts["row_bold"] if is_total else fonts["row"]
        value_font = fonts["row_bold"] if is_total else fonts["row_value"]
        text_y = row_y + 19

        _draw_label_with_hint(draw, x + 28, text_y, label, label_font, fonts["row_hint"], COLORS["text"], "#a4adbb")
        value_w = draw.textlength(value, font=value_font)
        draw.text((x + w - 28 - value_w, text_y), value, fill=COLORS["text"], font=value_font)

        if idx < len(rows) - 1:
            line_y = row_y + row_h
            draw.line((x + 28, line_y, x + w - 28, line_y), fill="#edf0f4", width=2)
        row_y += row_h


def _draw_label_with_hint(draw, x, y, text, font, hint_font, fill, hint_fill) -> None:
    match = re.match(r"^(.*?)(\s*\(.+\))$", text)
    if not match:
        draw.text((x, y), text, fill=fill, font=font)
        return
    main, hint = match.groups()
    draw.text((x, y), main, fill=fill, font=font)
    main_w = draw.textlength(main, font=font)
    draw.text((x + main_w + 4, y + 2), hint, fill=hint_fill, font=hint_font)


def _draw_shadowed_card(draw, x, y, w, h, radius, fill, outline=None, outline_width=2, shadow="#edf0f4") -> None:
    for offset, color in ((14, "#f1f3f6"), (8, shadow), (4, "#f8f9fb")):
        draw.rounded_rectangle((x + offset, y + offset, x + w + offset, y + h + offset), radius=radius, fill=color)
    draw.rounded_rectangle((x, y, x + w, y + h), radius=radius, fill=fill, outline=outline, width=outline_width if outline else 1)


def _draw_pill(draw, x, y, w, h, text, font, fill) -> None:
    draw.rounded_rectangle((x, y, x + w, y + h), radius=h // 2, fill=fill)
    _draw_centered_text(draw, x, y + 8, w, text, font, "#ffffff")


def _draw_centered_text(draw, x, y, w, text, font, fill):
    text_w = draw.textlength(text, font=font)
    bbox = draw.textbbox((0, 0), text, font=font)
    draw.text((x + (w - text_w) / 2, y), text, fill=fill, font=font)
    return (x + (w - text_w) / 2, y + bbox[1], x + (w + text_w) / 2, y + bbox[3])


def _draw_result_card(draw, x, y, w, h, data, building_type, has_elevator, cost, fonts) -> None:
    _rounded_gradient_card(draw, x, y, w, h)
    _draw_badge(draw, x + 28, y + 28, "산출 완료", fonts["tiny_bold"], fill=COLORS["gold"], text_fill="#ffffff")
    draw.text((x + 28, y + 72), "법률사무소 명승에 맡기시면", fill=COLORS["navy"], font=fonts["subtitle"])
    draw.text((x + 28, y + 116), "같은 집행, 20% 절감된 비용으로 진행합니다", fill=COLORS["muted"], font=fonts["body"])

    summary = f"{BUILDING_LABELS[building_type]} · {_format_area(cost['areaPyeong'])}평 · 엘리베이터 {'있음' if has_elevator else '없음'}"
    draw.text((x + 28, y + 156), summary, fill=COLORS["navy_light"], font=fonts["body_bold"])

    left_x = x + 34
    right_x = x + w // 2 + 28
    amount_y = y + 232
    draw.text((left_x, amount_y - 40), "일반 강제집행 비용", fill=COLORS["muted"], font=fonts["body_bold"])
    old_text = format_won(cost["grandTotal"])
    draw.text((left_x, amount_y), old_text, fill="#9ca3af", font=fonts["amount_old"])
    bbox = draw.textbbox((left_x, amount_y), old_text, font=fonts["amount_old"])
    draw.line((bbox[0], (bbox[1] + bbox[3]) // 2 + 2, bbox[2], (bbox[1] + bbox[3]) // 2 + 2), fill="#9ca3af", width=4)

    draw.text((right_x, amount_y - 40), "법률사무소 명승 대행 시", fill=COLORS["gold_dark"], font=fonts["body_bold"])
    draw.text((right_x, amount_y), format_won(cost["proposedPrice"]), fill=COLORS["gold_dark"], font=fonts["amount"])
    _draw_badge(draw, right_x, amount_y + 74, "20% 절감", fonts["tiny_bold"], fill=COLORS["navy"], text_fill="#ffffff")
    draw.text((right_x + 128, amount_y + 74), f"{format_manwon(cost['savings'])} 절약", fill=COLORS["gold_dark"], font=fonts["body_bold"])

    _draw_button(draw, x + 28, y + h - 66, 206, 44, "다시하기", fonts["button"], outline=COLORS["border"], fill="#ffffff", text_fill=COLORS["navy"])


def _draw_details(draw, x, y, w, cost, fonts) -> None:
    draw.rounded_rectangle((x, y, x + w, y + 286), radius=24, fill=COLORS["card"], outline=COLORS["border"], width=2)
    _draw_button(draw, x + 28, y + 20, 220, 42, "산출 내역 보기", fonts["button"], fill=COLORS["navy"], text_fill="#ffffff")
    _draw_button(draw, x + w - 258, y + 20, 230, 42, "견적서 PNG 복사하기", fonts["button"], fill=COLORS["gold"], text_fill="#ffffff")

    rows = [
        ("접수비", format_won(cost["filingFee"])),
        (f"운반·보관료 (컨테이너 {cost['containerCount']}대)", format_won(cost["transportStorage"])),
        (f"노무비 ({cost['laborWorkers']}명)", format_won(cost["laborTotal"])),
        ("열쇠 개문", format_won(cost["locksmith"])),
        ("사다리차", format_won(cost["ladderTruck"])),
        ("입회자 동행", format_won(cost["witness"])),
        ("합계", format_won(cost["grandTotal"])),
    ]
    row_y = y + 82
    for idx, (label, value) in enumerate(rows):
        fill = COLORS["soft"] if idx == len(rows) - 1 else None
        if fill:
            draw.rounded_rectangle((x + 26, row_y - 7, x + w - 26, row_y + 34), radius=12, fill=fill)
        draw.text((x + 42, row_y), label, fill=COLORS["text"], font=fonts["row_bold"] if idx == len(rows) - 1 else fonts["row"])
        value_w = draw.textlength(value, font=fonts["row_bold"] if idx == len(rows) - 1 else fonts["row"])
        draw.text((x + w - 42 - value_w, row_y), value, fill=COLORS["navy"], font=fonts["row_bold"] if idx == len(rows) - 1 else fonts["row"])
        row_y += 29

    cta_y = y + 306
    _draw_button(draw, x, cta_y, 506, 52, "무료 상담 신청하기", fonts["button_big"], fill=COLORS["navy"], text_fill="#ffffff")
    _draw_button(draw, x + 546, cta_y, 506, 52, "견적서 저장하기", fonts["button_big"], fill=COLORS["gold"], text_fill="#ffffff")


def _draw_step_card(draw, x, y, w, step, title, desc, selected, fonts) -> int:
    h = 92
    draw.rounded_rectangle((x, y, x + w, y + h), radius=24, fill=COLORS["card"], outline=COLORS["border"], width=2)
    _draw_badge(draw, x + 24, y + 16, f"Step {step}", fonts["tiny_bold"], fill=COLORS["navy_light"], text_fill="#ffffff")
    draw.text((x + 144, y + 16), title, fill=COLORS["navy"], font=fonts["body_bold"])
    draw.text((x + 144, y + 50), desc, fill=COLORS["muted"], font=fonts["small"])
    selected_w = max(176, int(draw.textlength(selected, font=fonts["button"])) + 46)
    _draw_button(draw, x + w - selected_w - 24, y + 25, selected_w, 44, selected, fonts["button"], fill=COLORS["gold"], text_fill="#ffffff")
    return y + h


def _rounded_gradient_card(draw, x, y, w, h) -> None:
    # Approximate the requested linear gradient with layered rounded rectangles.
    draw.rounded_rectangle((x, y, x + w, y + h), radius=32, fill="#ffffff", outline=COLORS["gold"], width=4)
    for i in range(0, max(h - 8, 1), 8):
        ratio = i / max(h, 1)
        if ratio < 0.45:
            color = "#ffffff"
        elif ratio < 0.75:
            color = "#fffbf0"
        else:
            color = "#faf3e0"
        y0 = y + i
        y1 = min(y + i + 12, y + h - 4)
        if y1 >= y0:
            draw.rounded_rectangle((x + 4, y0, x + w - 4, y1), radius=28, fill=color)
    draw.rounded_rectangle((x, y, x + w, y + h), radius=32, outline=COLORS["gold"], width=4)


def _draw_badge(draw, x, y, text, font, fill=COLORS["navy"], text_fill="#ffffff") -> None:
    tw = draw.textlength(text, font=font)
    draw.rounded_rectangle((x, y, x + tw + 34, y + 34), radius=17, fill=fill)
    draw.text((x + 17, y + 7), text, fill=text_fill, font=font)


def _draw_button(draw, x, y, w, h, text, font, fill, text_fill, outline=None) -> None:
    draw.rounded_rectangle((x, y, x + w, y + h), radius=16, fill=fill, outline=outline, width=2 if outline else 1)
    tw = draw.textlength(text, font=font)
    bbox = draw.textbbox((0, 0), text, font=font)
    th = bbox[3] - bbox[1]
    draw.text((x + (w - tw) / 2, y + (h - th) / 2 - 2), text, fill=text_fill, font=font)


def _draw_wrapped(draw, text, x, y, max_width, font, fill, line_gap=8) -> None:
    line = ""
    for token in text.split(" "):
        candidate = token if not line else f"{line} {token}"
        if draw.textlength(candidate, font=font) <= max_width:
            line = candidate
            continue
        draw.text((x, y), line, fill=fill, font=font)
        y += font.size + line_gap
        line = token
    if line:
        draw.text((x, y), line, fill=fill, font=font)


def _infer_building_type(item_type: str) -> str:
    compact = re.sub(r"\s+", "", item_type or "")
    if "아파트" in compact:
        return "apartment"
    if any(token in compact for token in ("상가", "오피스텔", "근린", "점포", "사무실")):
        return "commercial"
    if any(token in compact for token in ("빌라", "다세대", "연립", "주택")):
        return "villa"
    return "other"


def _attorney_fee_from_item_type(item_type: str) -> int:
    compact = re.sub(r"\s+", "", item_type or "")
    sectional_tokens = (
        "다세대",
        "연립",
        "빌라",
        "아파트",
        "구분상가",
        "상가",
        "오피스텔",
        "지식산업센터",
        "집합건물",
        "도시형생활주택",
        "근린생활시설",
        "사무실",
        "점포",
    )
    if any(token in compact for token in sectional_tokens):
        return SECTIONAL_ATTORNEY_FEE
    return OTHER_ATTORNEY_FEE


def _parse_float(value) -> float:
    text = str(value or "").replace(",", "")
    match = re.search(r"\d+(?:\.\d+)?", text)
    return float(match.group(0)) if match else 0.0


def _format_area(value: float) -> str:
    rounded = round(value, 1)
    if abs(rounded - round(rounded)) < 0.05:
        return f"{int(round(rounded))}"
    return f"{rounded:.1f}"


def format_won(value: int) -> str:
    return f"{int(value):,}원"


def format_manwon(value: int) -> str:
    return f"{round(value / 10000):,}만원"


def _fonts() -> dict:
    regular = _font_path("malgun.ttf")
    bold = _font_path("malgunbd.ttf") or regular
    return {
        "title": ImageFont.truetype(bold, 46),
        "subtitle": ImageFont.truetype(bold, 34),
        "summary": ImageFont.truetype(bold, 24),
        "label": ImageFont.truetype(regular, 22),
        "label_bold": ImageFont.truetype(bold, 22),
        "body": ImageFont.truetype(regular, 24),
        "body_bold": ImageFont.truetype(bold, 24),
        "small": ImageFont.truetype(regular, 20),
        "small_bold": ImageFont.truetype(bold, 20),
        "tiny": ImageFont.truetype(regular, 18),
        "tiny_bold": ImageFont.truetype(bold, 18),
        "badge": ImageFont.truetype(bold, 19),
        "button": ImageFont.truetype(bold, 20),
        "button_big": ImageFont.truetype(bold, 24),
        "amount": ImageFont.truetype(bold, 43),
        "amount_old": ImageFont.truetype(bold, 38),
        "saving": ImageFont.truetype(bold, 21),
        "row": ImageFont.truetype(regular, 23),
        "row_hint": ImageFont.truetype(regular, 20),
        "row_value": ImageFont.truetype(bold, 23),
        "row_bold": ImageFont.truetype(bold, 24),
    }


def _font_path(name: str) -> str:
    candidates = [
        Path(os.environ.get("WINDIR", "C:/Windows")) / "Fonts" / name,
        Path("C:/Windows/Fonts") / name,
    ]
    for path in candidates:
        if path.exists():
            return str(path)
    return ""
