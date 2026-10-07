# -*- coding: utf-8 -*-
"""브리핑자료용 취득세·입찰가·취득비용 표 이미지 생성.

옥션플래너 결과 화면과 같은 목적의 3개 이미지를 자동 생성한다.
생성 대상:
- 05.담당자 의견(6) 취득세 및 대출
- 05.담당자 의견(7) 입찰가 산정표
- 05.담당자 의견(8) 취득비용계산표
"""

from __future__ import annotations

import math
import re
from pathlib import Path
from typing import Any

from PIL import Image, ImageDraw, ImageFont


NAVY = (15, 23, 42)
BLUE = (0, 86, 179)
CYAN = (0, 142, 207)
GRAY = (107, 114, 128)
LIGHT_GRAY = (248, 250, 252)
BORDER = (203, 213, 225)
ORANGE = (249, 115, 22)
YELLOW = (255, 251, 196)
BLACK_BAR = (48, 48, 48)
DEFAULT_BANK_LOAN_NOTE = "감정가 40%,낙찰가80% 중 낮은금액으로 대출이 가능합니다."


def _font(size: int, bold: bool = False) -> ImageFont.FreeTypeFont | ImageFont.ImageFont:
    candidates = [
        r"C:\Windows\Fonts\malgunbd.ttf" if bold else r"C:\Windows\Fonts\malgun.ttf",
        r"C:\Windows\Fonts\batang.ttc",
        "/usr/share/fonts/truetype/noto/NotoSansCJK-Regular.ttc",
        "/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc",
    ]
    for path in candidates:
        try:
            if Path(path).exists():
                return ImageFont.truetype(path, size)
        except Exception:
            continue
    return ImageFont.load_default()


FONT_18 = _font(18)
FONT_18_B = _font(18, True)
FONT_20 = _font(20)
FONT_20_B = _font(20, True)
FONT_22 = _font(22)
FONT_22_B = _font(22, True)
FONT_24 = _font(24)
FONT_24_B = _font(24, True)
FONT_26 = _font(26)
FONT_26_B = _font(26, True)
FONT_30_B = _font(30, True)
FONT_34_B = _font(34, True)
FONT_38_B = _font(38, True)


def _num(value: Any) -> int:
    if value is None:
        return 0
    if isinstance(value, (int, float)):
        return int(round(value))
    text = str(value).strip()
    if not text:
        return 0
    text = text.replace(",", "")
    multiplier = 1
    if "억" in text:
        parts = text.split("억", 1)
        head = re.sub(r"[^0-9.]", "", parts[0])
        tail = re.sub(r"[^0-9.]", "", parts[1])
        total = (float(head) if head else 0) * 100_000_000
        if tail:
            # "5억 3,000"류는 만원 단위로 보는 관행이 많아 보조 처리.
            tail_num = float(tail)
            total += tail_num * (10_000 if tail_num < 1_000_000 else 1)
        return int(round(total))
    if "만" in text:
        multiplier = 10_000
    number = re.sub(r"[^0-9.]", "", text)
    if not number:
        return 0
    return int(round(float(number) * multiplier))


def _pct(value: Any, default: float = 0.0) -> float:
    if value is None or value == "":
        return default
    if isinstance(value, (int, float)):
        return float(value)
    text = str(value).replace("%", "").strip()
    try:
        return float(text)
    except Exception:
        return default


def _area_m2(data: dict[str, Any]) -> float:
    for key in ("exclusive_area_m2", "building_area_m2", "land_area_m2", "area_m2"):
        raw = data.get(key)
        if raw in (None, ""):
            continue
        found = re.search(r"\d+(?:\.\d+)?", str(raw).replace(",", ""))
        if found:
            return float(found.group(0))
    return 0.0


def _won(value: int) -> str:
    return f"{int(round(value)):,}원"


def _manwon(value: int) -> str:
    return f"{int(round(value / 10_000)):,}"


def _price_label(value: int) -> str:
    return f"{int(round(value / 10_000)):,}만원"


def _rate_for_house(price: int, house_count: str, regulated: bool) -> float:
    count = str(house_count or "1").strip()
    if count in {"corporation", "법인", "4", "4_plus", "4주택", "4주택 이상", "3_plus"} and regulated:
        return 12.0
    if regulated and count in {"2", "2주택"}:
        return 8.0
    if regulated and count in {"3", "3주택", "3_plus"}:
        return 12.0
    if not regulated and count in {"3", "3주택"}:
        return 8.0
    if not regulated and count in {"4", "4_plus", "4주택", "4주택 이상", "3_plus", "corporation", "법인"}:
        return 12.0
    if price <= 600_000_000:
        return 1.0
    if price <= 900_000_000:
        return max(1.0, min(3.0, (price / 100_000_000) * (2 / 3) - 3))
    return 3.0


def calculate_acquisition_tax(
    price: int,
    *,
    property_tax_type: str = "house",
    house_count: str = "1",
    regulated_area: bool = False,
    area_m2: float = 0.0,
) -> dict[str, Any]:
    is_house = str(property_tax_type or "house").lower() in {"house", "주택", "住宅"}
    large_area = area_m2 > 85
    if is_house:
        acquisition_rate = _rate_for_house(price, house_count, regulated_area)
        if acquisition_rate >= 12:
            local_rate = 0.4
            rural_rate = 1.0 if large_area else 0.0
        elif acquisition_rate >= 8:
            local_rate = 0.4
            rural_rate = 0.6 if large_area else 0.0
        else:
            local_rate = acquisition_rate * 0.1
            rural_rate = 0.2 if large_area else 0.0
        basis = "주택"
    else:
        acquisition_rate = 4.0
        local_rate = 0.4
        rural_rate = 0.2
        basis = "주택 외"
    acquisition_tax = math.floor(price * acquisition_rate / 100 / 10) * 10
    local_tax = math.floor(price * local_rate / 100 / 10) * 10
    rural_tax = math.floor(price * rural_rate / 100 / 10) * 10
    total = acquisition_tax + local_tax + rural_tax
    return {
        "basis": basis,
        "price": price,
        "area_m2": area_m2,
        "large_area": large_area,
        "acquisition_rate": acquisition_rate,
        "local_rate": local_rate,
        "rural_rate": rural_rate,
        "total_rate": acquisition_rate + local_rate + rural_rate,
        "acquisition_tax": acquisition_tax,
        "local_tax": local_tax,
        "rural_tax": rural_tax,
        "total_tax": total,
    }


def calculate_brokerage_fee(price: int) -> dict[str, Any]:
    # 서울시/공인중개사협회 주택 매매 상한요율 기준.
    brackets = [
        (50_000_000, 0.6, 250_000),
        (200_000_000, 0.5, 800_000),
        (900_000_000, 0.4, None),
        (1_200_000_000, 0.5, None),
        (1_500_000_000, 0.6, None),
        (float("inf"), 0.7, None),
    ]
    for limit, rate, cap in brackets:
        if price < limit:
            amount = math.floor(price * rate / 100 / 10) * 10
            if cap is not None:
                amount = min(amount, cap)
            return {"rate": rate, "amount": amount}
    return {"rate": 0.7, "amount": math.floor(price * 0.007 / 10) * 10}


def build_cost_context(inputs: dict[str, Any] | None, data: dict[str, Any] | None) -> dict[str, Any]:
    inputs = inputs or {}
    data = data or {}
    appraised = _num(data.get("appraised_price") or data.get("appraisal_price"))
    minimum = _num(data.get("min_price") or data.get("minimum_price"))
    if appraised > 0 and minimum > appraised:
        # 마이옥션 일부 영역의 다른 금액이 최저가로 오염되면 감정가보다 큰 최저가가 들어올 수 있다.
        # 경매 최저가는 감정가를 초과하지 않는 값이므로 브리핑 표에서는 감정가로 방어 보정한다.
        minimum = appraised
    deposit = _num(data.get("deposit") or data.get("bid_deposit"))
    market = _num(inputs.get("market_price")) or appraised
    bids = [
        _num(inputs.get("bid_price_1")) or minimum,
        _num(inputs.get("bid_price_2")),
        _num(inputs.get("bid_price_3")),
    ]
    bids = [bid for bid in bids if bid > 0]
    while len(bids) < 3:
        base = bids[-1] if bids else minimum or appraised
        bids.append(max(0, base - 10_000_000))
    bids = bids[:3]
    area = _area_m2(data)
    property_tax_type = str(inputs.get("property_tax_type") or "house")
    house_count = str(inputs.get("house_count") or "1")
    regulated_area = bool(inputs.get("regulated_area"))
    service_fee_rate = _pct(inputs.get("service_fee_rate"), 1.0)
    service_fee_basis = str(inputs.get("service_fee_basis") or "bid").strip().lower()
    service_fee_manual_amount = _num(inputs.get("service_fee_manual_amount"))
    unpaid_management_fee = _num(inputs.get("unpaid_management_fee"))
    bid_step = _num(inputs.get("difference_amount")) or 5_000_000
    fixed_loan = _num(inputs.get("fixed_loan_amount"))
    explicit_loan_base = _num(inputs.get("loan_base_amount"))
    loan_base = explicit_loan_base or appraised
    ltv = _pct(inputs.get("ltv_limit"), 0.0)
    bid_ltv = _pct(inputs.get("bid_price_loan_limit"), 0.0)
    room_deduction = _num(inputs.get("loan_room_deduction"))
    bank_loan_note = str(inputs.get("bank_loan_note") or "").strip()
    eviction_costs = data.get("eviction_cost_values") or {}
    flat_eviction = _num(eviction_costs.get("flat_total") or data.get("eviction_flat_total"))

    tax_basis_bid = bids[2]
    tax1 = calculate_acquisition_tax(
        tax_basis_bid,
        property_tax_type=property_tax_type,
        house_count=house_count,
        regulated_area=regulated_area,
        area_m2=area,
    )

    def scenario_for_bid(bid: int) -> dict[str, Any]:
        tax = calculate_acquisition_tax(
            bid,
            property_tax_type=property_tax_type,
            house_count=house_count,
            regulated_area=regulated_area,
            area_m2=area,
        )
        brokerage = calculate_brokerage_fee(bid)
        if service_fee_basis == "appraised":
            consulting_base = appraised or bid
            consulting_label = "감정가"
        elif service_fee_basis == "manual":
            consulting_base = service_fee_manual_amount or bid
            consulting_label = "직접입력"
        else:
            consulting_base = bid
            consulting_label = "낙찰가"
        consulting_fee = math.floor(consulting_base * service_fee_rate / 100 / 10) * 10
        if fixed_loan > 0:
            loan = fixed_loan
            loan_note = f"고정값 {_won(fixed_loan)} 우선 적용"
        else:
            candidates = []
            if loan_base and ltv:
                candidates.append(loan_base * ltv / 100)
            if bid_ltv:
                candidates.append(bid * bid_ltv / 100)
            loan = int(min(candidates) if candidates else 0)
            loan = max(0, loan - room_deduction)
            base_label = "대출기준 금액" if explicit_loan_base else "감정가"
            if bank_loan_note:
                loan_note = bank_loan_note
            elif not explicit_loan_base and ltv == 40 and bid_ltv == 80:
                loan_note = DEFAULT_BANK_LOAN_NOTE
            else:
                loan_note = f"{base_label} {ltv:g}% / 낙찰가 {bid_ltv:g}% 중 낮은 금액" if (ltv or bid_ltv) else "대출 입력값 없음"
        acquisition_subtotal = consulting_fee + tax["total_tax"] + flat_eviction + unpaid_management_fee
        required_cash = max(0, bid - loan)
        total_cost = required_cash + acquisition_subtotal
        profit = market - total_cost if market else 0
        return {
            "bid": bid,
            "bid_rate": (bid / appraised * 100) if appraised else 0,
            "tax": tax,
            "brokerage": brokerage,
            "consulting_fee": consulting_fee,
            "consulting_base": consulting_base,
            "consulting_label": consulting_label,
            "eviction_cost": flat_eviction,
            "unpaid_management_fee": unpaid_management_fee,
            "loan": loan,
            "loan_note": loan_note,
            "required_cash": required_cash,
            "acquisition_subtotal": acquisition_subtotal,
            "total_cost": total_cost,
            "profit": profit,
        }

    scenarios = [scenario_for_bid(bid) for bid in bids]
    bid_row_specs = [
        ("감정가", appraised, "appraised"),
        ("...", bids[0] + bid_step * 3, "guide"),
        ("...", bids[0] + bid_step * 2, "guide"),
        ("...", bids[0] + bid_step, "guide"),
        ("낙찰 우위입찰가", bids[0], "bid1"),
        ("경쟁 균형입찰가", bids[1], "bid2"),
        ("안정 투자입찰가", bids[2], "bid3"),
        ("...", max(0, bids[2] - bid_step), "guide"),
        ("최저 입찰가", minimum, "minimum"),
    ]
    bid_rows = [
        {"label": label, "bid": bid, "kind": kind, "scenario": scenario_for_bid(bid)}
        for label, bid, kind in bid_row_specs
        if bid > 0
    ]
    return {
        "inputs": inputs,
        "appraised": appraised,
        "minimum": minimum,
        "deposit": deposit,
        "market": market,
        "area": area,
        "property_tax_type": property_tax_type,
        "house_count": house_count,
        "regulated_area": regulated_area,
        "service_fee_rate": service_fee_rate,
        "service_fee_basis": service_fee_basis,
        "service_fee_manual_amount": service_fee_manual_amount,
        "bid_step": bid_step,
        "tax1": tax1,
        "scenarios": scenarios,
        "bid_rows": bid_rows,
    }


def _draw_text(draw: ImageDraw.ImageDraw, xy: tuple[int, int], text: str, font, fill=NAVY, anchor: str | None = None):
    draw.text(xy, str(text), font=font, fill=fill, anchor=anchor)


def _line(draw: ImageDraw.ImageDraw, xy: tuple[int, int, int, int], fill=BORDER, width: int = 2):
    draw.line(xy, fill=fill, width=width)


def _rect(draw: ImageDraw.ImageDraw, xy, fill=None, outline=BORDER, width=2, radius=0):
    if radius:
        draw.rounded_rectangle(xy, radius=radius, fill=fill, outline=outline, width=width)
    else:
        draw.rectangle(xy, fill=fill, outline=outline, width=width)


def render_acquisition_tax_image(ctx: dict[str, Any], path: str | Path) -> str:
    img = Image.new("RGB", (2100, 870), "white")
    d = ImageDraw.Draw(img)
    _rect(d, (0, 0, 2098, 868), outline=(226, 232, 240), radius=14, width=2)
    _draw_text(d, (42, 66), "취득세 계산 결과", FONT_38_B)
    _line(d, (42, 116, 2058, 116), fill=CYAN, width=3)
    tax = ctx["tax1"]
    area_label = f"{tax['area_m2']:.0f}㎡ 이하" if tax["area_m2"] and tax["area_m2"] <= 85 else (f"{tax['area_m2']:.0f}㎡ 초과" if tax["area_m2"] else "면적 미확인")
    summary = [
        ("부동산", "주택" if str(ctx["property_tax_type"]).lower() in {"house", "주택"} else "주택 외"),
        ("평수", area_label),
        ("주택수", f"{ctx['house_count']}주택" if str(ctx["house_count"]).isdigit() else str(ctx["house_count"])),
        ("조정지역", "O" if ctx["regulated_area"] else "X"),
        ("취득가액", _price_label(tax["price"])),
        ("시가표준액", _price_label(ctx["market"] or tax["price"])),
    ]
    _rect(d, (42, 140, 2058, 245), fill=LIGHT_GRAY, outline=None, radius=8)
    for i, (label, value) in enumerate(summary):
        x = 60 + (i % 3) * 670
        y = 172 + (i // 3) * 42
        _draw_text(d, (x, y), f"{label}: ", FONT_24, fill=NAVY)
        _draw_text(d, (x + 120, y), value, FONT_24, fill=NAVY)
    rows = [
        ("취득가액", _won(tax["price"]), f"과세표준 ({_price_label(tax['price'])})"),
        ("취득세", _won(tax["acquisition_tax"]), f"취득세율 {tax['acquisition_rate']:.2f}%"),
        ("농어촌특별세", _won(tax["rural_tax"]), f"농특세율 {tax['rural_rate']:.2f}%"),
        ("지방교육세", _won(tax["local_tax"]), f"지방교육세율 {tax['local_rate']:.2f}%"),
    ]
    y = 320
    for label, amount, note in rows:
        _draw_text(d, (42, y), label, FONT_30_B, fill=GRAY if label == "취득가액" else NAVY)
        _draw_text(d, (266, y), amount, FONT_34_B if label == "취득가액" else FONT_30_B)
        _draw_text(d, (2058, y + 4), note, FONT_24, fill=GRAY, anchor="ra")
        _line(d, (42, y + 48, 2058, y + 48), fill=(226, 232, 240), width=2)
        y += 90
    _draw_text(d, (42, y + 8), "취득세 합계", FONT_30_B)
    _draw_text(d, (266, y + 4), _won(tax["total_tax"]), FONT_38_B, fill=CYAN)
    _draw_text(d, (2058, y + 15), f"총 취득세율 ({tax['total_rate']:.2f}%)", FONT_24, fill=GRAY, anchor="ra")
    notes = [
        "※ 취득세 기준은 정부정책 및 개별 요건(중과, 감면 등)에 따라 변경될 수 있고 실제 고지 세액과 차이가 있을 수 있습니다.",
        "· 주택수·조정지역·면적 조건은 입력값을 기준으로 계산합니다.",
    ]
    ny = y + 100
    for note in notes:
        _draw_text(d, (42, ny), note, FONT_22, fill=GRAY)
        ny += 44
    path = str(path)
    img.save(path)
    return path


def render_bid_price_image(ctx: dict[str, Any], path: str | Path) -> str:
    img = Image.new("RGB", (1450, 1130), "white")
    d = ImageDraw.Draw(img)
    _rect(d, (0, 0, 1448, 1128), outline=BORDER, width=2, radius=8)
    _rect(d, (2, 2, 578, 40), fill=BLACK_BAR, outline=BLACK_BAR)
    _draw_text(d, (60, 8), "○ 경매사건 금액정보", FONT_22_B, fill="white")
    _draw_text(d, (560, 9), "(단위:만원,%)", FONT_18_B, fill="white", anchor="ra")
    _rect(d, (718, 2, 1448, 40), fill=BLACK_BAR, outline=BLACK_BAR)
    _draw_text(d, (794, 8), "○ 일반 매매 시 (예상 비용)", FONT_22_B, fill="white")
    _draw_text(d, (1430, 9), "(단위:만원,%)", FONT_18_B, fill="white", anchor="ra")

    # 상단 좌측 금액정보
    left_rows = [
        ("감정가", ctx["appraised"], "100%"),
        ("최저가", ctx["minimum"], f"{ctx['minimum'] / ctx['appraised'] * 100:.0f}%" if ctx["appraised"] else "-"),
    ]
    x0, y0, w1, h = 0, 40, 578, 52
    for i, (label, amount, rate) in enumerate(left_rows):
        y = y0 + i * h
        _rect(d, (x0, y, 220, y + h), fill=(238, 241, 244), outline=BORDER)
        _rect(d, (220, y, 422, y + h), fill="white", outline=BORDER)
        _rect(d, (422, y, 578, y + h), fill="white", outline=BORDER)
        _draw_text(d, (110, y + 15), label, FONT_18_B, anchor="ma")
        _draw_text(d, (410, y + 15), _manwon(amount), FONT_18_B, fill=BLUE, anchor="ra")
        _draw_text(d, (520, y + 15), rate, FONT_18_B, anchor="ma")

    # 상단 우측 일반매매 예상비용
    s0 = ctx["scenarios"][0]
    cols = [718, 864, 1010, 1156, 1302, 1448]
    headers = ["기준", "매매금액", "취득세", "중개료", "합계금액"]
    for c in range(5):
        _rect(d, (cols[c], 40, cols[c + 1], 92), fill="white", outline=BORDER)
        _draw_text(d, ((cols[c] + cols[c + 1]) // 2, 56), headers[c], FONT_20_B, anchor="ma")
    values = ["예상매매가", _manwon(ctx["market"]), _manwon(s0["tax"]["total_tax"]), _manwon(s0["brokerage"]["amount"]), _manwon(ctx["market"] + s0["tax"]["total_tax"] + s0["brokerage"]["amount"])]
    for c, value in enumerate(values):
        _rect(d, (cols[c], 92, cols[c + 1], 188), fill="white", outline=BORDER)
        _draw_text(d, ((cols[c] + cols[c + 1]) // 2, 130), value, FONT_20_B, fill=BLUE if c else NAVY, anchor="ma")
    _draw_text(d, ((cols[3] + cols[4]) // 2, 106), f"{s0['brokerage']['rate']:.1f}%", FONT_20_B, fill="blue", anchor="ma")

    # 하단 입찰표
    top = 216
    _rect(d, (0, top, 1450, top + 38), fill=ORANGE, outline=ORANGE)
    _draw_text(d, (62, top + 6), "○ 경매 취득 시 (예상 비용)", FONT_22_B, fill="white")
    _draw_text(d, (1432, top + 7), "(단위:만원,%)", FONT_18_B, fill="white", anchor="ra")
    colx = [0, 220, 374, 528, 682, 836, 990, 1144, 1298, 1450]
    header_top = top + 38
    header_h = 132
    labels = ["기준", "입찰가", "낙찰가율", "취득세", "컨설팅 비용\n(*부가세별도)", "명도비\n(정액제)", "미납관리비", "합계금액", "시세대비\n이익금액"]
    for c in range(9):
        _rect(d, (colx[c], header_top, colx[c + 1], header_top + header_h), fill="white", outline=BORDER)
        _draw_text(d, ((colx[c] + colx[c + 1]) // 2, header_top + 52), labels[c], FONT_20_B, anchor="mm")
    rows = ctx.get("bid_rows") or [
        {"label": "감정가", "bid": ctx["appraised"], "kind": "appraised", "scenario": ctx["scenarios"][0]},
        {"label": "낙찰 우위입찰가", "bid": ctx["scenarios"][0]["bid"], "kind": "bid1", "scenario": ctx["scenarios"][0]},
        {"label": "경쟁 균형입찰가", "bid": ctx["scenarios"][1]["bid"], "kind": "bid2", "scenario": ctx["scenarios"][1]},
        {"label": "안정 투자입찰가", "bid": ctx["scenarios"][2]["bid"], "kind": "bid3", "scenario": ctx["scenarios"][2]},
        {"label": "최저 입찰가", "bid": ctx["minimum"], "kind": "minimum", "scenario": ctx["scenarios"][0]},
    ]
    y = header_top + header_h
    row_h = 70
    named_kinds = {"bid1", "bid2", "bid3"}
    for row in rows:
        label = str(row.get("label") or "")
        bid = int(row.get("bid") or 0)
        scenario = row.get("scenario") or ctx["scenarios"][0]
        kind = str(row.get("kind") or "")
        fill = YELLOW if kind == "bid3" else "white"
        values = [
            label,
            _manwon(bid),
            f"{scenario['bid_rate']:.2f}%",
            f"{_manwon(scenario['tax']['total_tax'])}\n{scenario['tax']['total_rate']:.2f}%",
            _manwon(scenario["consulting_fee"]),
            _manwon(scenario["eviction_cost"]),
            _manwon(scenario["unpaid_management_fee"]),
            _manwon(scenario["total_cost"]),
            _manwon(scenario["profit"]),
        ]
        color = ORANGE if kind in named_kinds else BLUE
        if kind == "bid1":
            _line(d, (0, y, 1450, y), fill=(255, 0, 0), width=3)
        for c, value in enumerate(values):
            _rect(d, (colx[c], y, colx[c + 1], y + row_h), fill=fill, outline=BORDER)
            _draw_text(d, ((colx[c] + colx[c + 1]) // 2, y + 17), value, FONT_20_B, fill=color if c else NAVY, anchor="ma")
        y += row_h
        if kind == "bid3":
            _line(d, (0, y, 1450, y), fill=(255, 0, 0), width=3)
    path = str(path)
    img.save(path)
    return path


def render_acquisition_cost_sheet_image(ctx: dict[str, Any], path: str | Path) -> str:
    img = Image.new("RGB", (1540, 920), "white")
    d = ImageDraw.Draw(img)
    _rect(d, (0, 0, 1538, 918), outline=BORDER, radius=8, width=2)
    _rect(d, (2, 2, 1538, 90), fill=BLACK_BAR, outline=BLACK_BAR)
    _draw_text(d, (770, 30), "취득시 비용 계산표", FONT_34_B, fill="white", anchor="ma")
    colx = [0, 616, 924, 1232, 1540]
    row_h = 72
    y = 90
    _rect(d, (0, y, 616, y + row_h), fill=LIGHT_GRAY, outline=BORDER)
    labels = ["예상낙찰가"] + [_won(s["bid"]) for s in ctx["scenarios"]]
    for c, value in enumerate(labels):
        _rect(d, (colx[c], y, colx[c + 1], y + row_h), fill=LIGHT_GRAY if c == 0 else "white", outline=BORDER)
        _draw_text(d, ((colx[c] + colx[c + 1]) // 2, y + 22), value, FONT_24_B if c == 0 else FONT_26_B, fill=NAVY if c == 0 else ORANGE, anchor="ma")
    y += row_h
    first_note = ctx["scenarios"][0]["loan_note"]
    rows = [
        ("은행대출", first_note, None),
        ("최종 대출 가능 금액\n(*변경될 수 있음)", None, "loan"),
        ("부동산 구입 필요 자금\n(입찰보증금 + 잔금)", None, "required_cash"),
        ("컨설팅 비용\n(부가세 10% 별도)", None, "consulting_fee"),
        ("취득세", None, "tax_total"),
        ("명도비용\n(정액제 예상 금액)", None, "eviction_cost"),
        ("미납 관리비", None, "unpaid_management_fee"),
        ("소계\n(일부 부가세 10% 별도)", None, "acquisition_subtotal"),
        ("총비용 (*대출금 제외 금액)", None, "total_cost"),
    ]
    key_map = {
        "loan": "loan",
        "required_cash": "required_cash",
        "consulting_fee": "consulting_fee",
        "tax_total": ("tax", "total_tax"),
        "eviction_cost": "eviction_cost",
        "unpaid_management_fee": "unpaid_management_fee",
        "acquisition_subtotal": "acquisition_subtotal",
        "total_cost": "total_cost",
    }
    for label, note, key in rows:
        fill = (226, 237, 248) if key in {"total_cost"} else ("white")
        left_fill = (241, 245, 249)
        _rect(d, (0, y, 616, y + row_h), fill=left_fill, outline=BORDER)
        _draw_text(d, (308, y + 16), label, FONT_20_B if "\n" in label else FONT_22_B, anchor="ma")
        if key is None:
            _rect(d, (616, y, 1540, y + row_h), fill="white", outline=BORDER)
            _draw_text(d, (1078, y + 16), note or "", FONT_20_B, anchor="ma")
        else:
            for i, scenario in enumerate(ctx["scenarios"], start=1):
                value_key = key_map[key]
                if isinstance(value_key, tuple):
                    amount = scenario[value_key[0]][value_key[1]]
                else:
                    amount = scenario[value_key]
                _rect(d, (colx[i], y, colx[i + 1], y + row_h), fill=fill, outline=BORDER)
                font = FONT_26_B if key == "total_cost" else FONT_22_B
                color = NAVY if key != "total_cost" else (255, 255, 255)
                if key == "total_cost":
                    d.rectangle((colx[i], y, colx[i + 1], y + row_h), fill=ORANGE, outline=BORDER)
                _draw_text(d, ((colx[i] + colx[i + 1]) // 2, y + 21), _won(amount), font, fill=color, anchor="ma")
        y += row_h
    note = "본 계산표는 입력값을 기준으로 산출한 예상 금액입니다. 실제 취득 과정에서는 대출 실행 조건, 세율 적용, 관리비 정산, 명도 및 기타 부대비용에 따라 금액이 달라질 수 있습니다."
    _draw_text(d, (24, 880), note, FONT_18_B, fill=GRAY)
    path = str(path)
    img.save(path)
    return path


def render_briefing_cost_images(inputs: dict[str, Any] | None, data: dict[str, Any] | None, output_dir: str | Path) -> dict[str, str]:
    ctx = build_cost_context(inputs, data)
    output = Path(output_dir)
    output.mkdir(parents=True, exist_ok=True)
    paths = {
        "acquisition-tax": render_acquisition_tax_image(ctx, output / "briefing_acquisition_tax.png"),
        "loan-bid-estimator": render_bid_price_image(ctx, output / "briefing_bid_price_table.png"),
        "acquisition-cost-sheet": render_acquisition_cost_sheet_image(ctx, output / "briefing_acquisition_cost_sheet.png"),
    }
    return paths
