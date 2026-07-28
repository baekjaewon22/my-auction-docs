import sys
import unittest
from pathlib import Path

from bs4 import BeautifulSoup

BACKEND_PATH = Path(__file__).resolve().parents[1] / "automation-service" / "backend"
if str(BACKEND_PATH) not in sys.path:
    sys.path.insert(0, str(BACKEND_PATH))

from app.services.rights_certificate import (  # noqa: E402
    _extract_management_fee,
    _extract_management_fee_amount,
    build_special_summary_text,
)


class RightsCertificateTests(unittest.TestCase):
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
