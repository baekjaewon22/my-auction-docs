import sys
import tempfile
import unittest
from pathlib import Path

from bs4 import BeautifulSoup
from pptx import Presentation
from pptx.util import Inches

BACKEND_PATH = Path(__file__).resolve().parents[1] / "automation-service" / "backend"
if str(BACKEND_PATH) not in sys.path:
    sys.path.insert(0, str(BACKEND_PATH))

from app.services.rights_certificate import (  # noqa: E402
    _extract_management_fee,
    _extract_management_fee_amount,
    build_template_data,
    build_special_summary_text,
    render_certificate_pptx_template,
)


def _slide_text(slide) -> str:
    values = []
    for shape in slide.shapes:
        if getattr(shape, "has_text_frame", False):
            values.append(shape.text_frame.text)
        if getattr(shape, "has_table", False):
            values.extend(cell.text for row in shape.table.rows for cell in row.cells)
    return "\n".join(values)


class RightsCertificateTests(unittest.TestCase):
    def test_pptx_template_includes_all_32_checklist_items_and_details(self):
        template_path = BACKEND_PATH / "templates" / "rights_certificate" / "certificate.pptx"
        source = Presentation(str(template_path))
        source_ends_with_empty_slide = len(source.slides[-1].shapes) == 0
        data = build_template_data(
            {
                "case_number": "2026타경12345",
                "court": "서울중앙지방법원",
                "item_type": "아파트",
                "rights": [],
                "tenants": [],
                "management_fee": {"unpaidAmount": 0},
                "author_name": "테스트 담당자",
            }
        )

        self.assertEqual(len(data["checklistRows"]), 32)
        self.assertGreater(len(data["checklistDetails"]), 0)

        with tempfile.TemporaryDirectory() as temp_dir:
            output_path = Path(temp_dir) / "certificate-with-checklist.pptx"
            render_certificate_pptx_template(template_path, output_path, data)
            rendered = Presentation(str(output_path))

        detail_page_count = (
            len(data["checklistDetails"]) + 3
        ) // 4
        expected_slide_count = len(source.slides) + detail_page_count + (0 if source_ends_with_empty_slide else 1)
        self.assertEqual(len(rendered.slides), expected_slide_count)

        overview_index = len(source.slides) - 1 if source_ends_with_empty_slide else len(source.slides)
        overview = rendered.slides[overview_index]
        overview_text = _slide_text(overview)
        self.assertIn("특이사항 종합 체크표", overview_text)
        self.assertIn("2026타경12345", overview_text)
        self.assertIn(data["checklistSummaryText"], overview_text)

        checklist_tables = [shape.table for shape in overview.shapes if getattr(shape, "has_table", False)]
        self.assertEqual(len(checklist_tables), 2)
        self.assertEqual(sum(len(table.rows) - 1 for table in checklist_tables), 32)
        for item in data["checklistRows"]:
            self.assertIn(item["name"], overview_text)
            self.assertIn(item["state"], overview_text)

        detail_text = "\n".join(
            _slide_text(rendered.slides[index])
            for index in range(overview_index + 1, len(rendered.slides))
        )
        for item in data["checklistDetails"]:
            self.assertIn(item["name"], detail_text)
            self.assertIn(item["basis"], detail_text)
            self.assertIn(item["sources"], detail_text)

        self.assertNotIn("{{checklistRows}}", "\n".join(_slide_text(slide) for slide in rendered.slides))

    def test_pptx_checklist_refuses_landscape_template_before_writing_output(self):
        data = build_template_data(
            {
                "case_number": "2026타경54321",
                "item_type": "아파트",
                "rights": [],
                "tenants": [],
                "management_fee": {"unpaidAmount": 0},
            }
        )
        landscape = Presentation()
        landscape.slide_width = Inches(13.333)
        landscape.slide_height = Inches(7.5)
        landscape.slides.add_slide(landscape.slide_layouts[6])

        with tempfile.TemporaryDirectory() as temp_dir:
            template_path = Path(temp_dir) / "landscape-template.pptx"
            output_path = Path(temp_dir) / "must-not-be-written.pptx"
            landscape.save(str(template_path))

            with self.assertRaisesRegex(
                ValueError,
                r"최소 7\.5 x 10\.8인치.*Rights checklist requires slides at least 7\.5 x 10\.8 inches",
            ):
                render_certificate_pptx_template(template_path, output_path, data)

            self.assertFalse(output_path.exists())

    def test_appraisal_value_is_not_used_as_unpaid_management_fee(self):
        text = "감정가 121,000,000원 미납 관리비는 관리사무소 확인 필요"

        self.assertEqual(_extract_management_fee_amount(text), 0)
        extracted = _extract_management_fee(BeautifulSoup(f"<div>{text}</div>", "html.parser"))
        self.assertEqual(extracted["unpaidAmount"], 0)

    def test_explicit_unpaid_management_fee_is_extracted(self):
        examples = (
            "미납 관리비 합계: 1,234,000원",
            "미납 관리비는 약 1,234,000원",
            "관리비 체납액 1,234,000원",
            "미납관리비 3개월분 1,500,000원",
            "미납 관리비 약 350만원",
        )

        for text in examples:
            with self.subTest(text=text):
                expected = 1_500_000 if "3개월분" in text else 3_500_000 if "350만원" in text else 1_234_000
                self.assertEqual(_extract_management_fee_amount(text), expected)
                extracted = _extract_management_fee(BeautifulSoup(f"<div>{text}</div>", "html.parser"))
                self.assertEqual(extracted["unpaidAmount"], expected)

    def test_unrelated_price_after_management_fee_keyword_is_not_used(self):
        text = "미납 관리비는 관리사무소 확인 필요. 감정가 121,000,000원"

        self.assertEqual(_extract_management_fee_amount(text), 0)

    def test_bid_strategy_is_not_in_special_summary(self):
        summary = build_special_summary_text(
            {
                "appraised_price": "700,000,000원",
                "min_price": "663,000,000원",
            },
            [],
            [],
            None,
            [],
            "",
            [],
            "",
            {},
            {},
            "",
            "",
            "",
        )

        self.assertNotIn("입찰 전략", summary)
        self.assertNotIn("보수적 검토", summary)
        self.assertNotIn("일반 경쟁 검토", summary)
        self.assertNotIn("적극 입찰 상한", summary)
        self.assertIn("3) 물건별 특이사항", summary)


if __name__ == "__main__":
    unittest.main()
