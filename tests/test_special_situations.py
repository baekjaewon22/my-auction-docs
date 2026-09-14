import sys
import unittest
from pathlib import Path


BACKEND_PATH = Path(__file__).resolve().parents[1] / "automation-service" / "backend"
if str(BACKEND_PATH) not in sys.path:
    sys.path.insert(0, str(BACKEND_PATH))

from app.services.special_situations import (  # noqa: E402
    SPECIAL_SITUATION_RULES,
    build_special_issue_lines,
    detect_affirmative_signal,
    detect_building_violation,
)


RULE_CASES = {
    "OWN-04": ("가등기가 접수되어 현재 존속 중", "가등기 말소 완료"),
    "OWN-06": ("가처분 등기가 현재 존속 중", "가처분 없음"),
    "ENC-01": ("유치권 신고가 접수됨", "유치권 신고 없음"),
    "BLD-01": ("건축물대장에 위반건축물로 표기됨", "위반건축물 아님"),
    "LND-01": ("토지만 매각되고 지상건물이 존재함", "법정지상권 성립 가능성 없음"),
    "OWN-03": ("신탁등기가 현재 존속 중", "신탁등기 해당없음"),
    "LIM-07": ("임차인의 대위변제 가능성이 있음", "대위변제 가능성 없음"),
    "BLD-03": ("대지권 미등기 상태임", "대지권 미등기 아님"),
    "OWN-02": ("토지 별도등기가 있음", "토지 별도등기 없음"),
    "OWN-01": ("공유지분만 매각함", "지분매각 아님"),
    "LND-03": ("토지 위 분묘가 확인됨", "분묘 부존재"),
}


class SpecialSituationSignalTests(unittest.TestCase):
    def test_every_rule_keeps_affirmative_and_rejects_negative_source_text(self):
        self.assertEqual(set(RULE_CASES), {rule["code"] for rule in SPECIAL_SITUATION_RULES})

        for rule in SPECIAL_SITUATION_RULES:
            positive_text, negative_text = RULE_CASES[rule["code"]]
            with self.subTest(code=rule["code"], polarity="positive"):
                detected, evidence = detect_affirmative_signal(positive_text, rule["keywords"])
                self.assertTrue(detected)
                self.assertTrue(evidence)
                self.assertTrue(
                    any(rule["name"] in line for line in build_special_issue_lines(positive_text)),
                    build_special_issue_lines(positive_text),
                )
            with self.subTest(code=rule["code"], polarity="negative"):
                self.assertEqual(
                    detect_affirmative_signal(negative_text, rule["keywords"]),
                    (False, ""),
                )
                self.assertFalse(
                    any(rule["name"] in line for line in build_special_issue_lines(negative_text)),
                    build_special_issue_lines(negative_text),
                )

    def test_mixed_context_retains_a_later_affirmative_signal(self):
        rule = next(item for item in SPECIAL_SITUATION_RULES if item["code"] == "ENC-01")
        detected, evidence = detect_affirmative_signal(
            "유치권 신고는 없음. 다만 현장 점유자가 공사대금 채권을 주장하고 있음.",
            rule["keywords"],
        )
        self.assertTrue(detected)
        self.assertIn("공사대금", evidence)

    def test_same_rule_can_be_negated_then_affirmed_later(self):
        rule = next(item for item in SPECIAL_SITUATION_RULES if item["code"] == "OWN-06")
        detected, evidence = detect_affirmative_signal(
            "기존 가처분은 말소 완료. 별도의 처분금지 가처분이 새로 등기됨.",
            rule["keywords"],
        )
        self.assertTrue(detected)
        self.assertIn("처분금지", evidence)

    def test_unrelated_negative_value_does_not_suppress_positive_signal(self):
        rule = next(item for item in SPECIAL_SITUATION_RULES if item["code"] == "ENC-01")
        detected, _ = detect_affirmative_signal(
            "유치권 신고 있음, 배제신청 없음",
            rule["keywords"],
        )
        self.assertTrue(detected)

    def test_double_negative_and_future_removal_remain_affirmative(self):
        rule = next(item for item in SPECIAL_SITUATION_RULES if item["code"] == "OWN-06")
        for source_text in ("가처분이 말소되지 않음", "가처분 말소 예정"):
            with self.subTest(source_text=source_text):
                self.assertTrue(detect_affirmative_signal(source_text, rule["keywords"])[0])

    def test_adjacent_line_label_value_is_scoped(self):
        rule = next(item for item in SPECIAL_SITUATION_RULES if item["code"] == "ENC-01")
        self.assertFalse(detect_affirmative_signal("유치권 신고 여부:\n없음", rule["keywords"])[0])
        self.assertFalse(detect_affirmative_signal("없음\n유치권 신고 여부:", rule["keywords"])[0])
        self.assertTrue(detect_affirmative_signal("유치권 신고 여부:\n있음", rule["keywords"])[0])

    def test_empty_label_and_unknown_values_are_not_affirmative_evidence(self):
        cases = (
            ("ENC-01", "유치권 신고 여부\n확인 필요"),
            ("ENC-01", "유치권 신고 여부: 미상"),
            ("OWN-03", "신탁등기 말소 여부"),
            ("OWN-03", "신탁등기 여부 불명"),
            ("LIM-07", "대위변제 가능성 미확인"),
            ("LND-03", "분묘 소재 여부: 판단불가"),
        )
        rules_by_code = {rule["code"]: rule for rule in SPECIAL_SITUATION_RULES}
        for code, source_text in cases:
            with self.subTest(code=code, source_text=source_text):
                rule = rules_by_code[code]
                self.assertFalse(detect_affirmative_signal(source_text, rule["keywords"])[0])
                self.assertFalse(
                    any(rule["name"] in line for line in build_special_issue_lines(source_text))
                )

    def test_explicit_affirmative_values_remain_detected(self):
        cases = (
            ("ENC-01", "유치권 신고 있음"),
            ("OWN-03", "신탁등기 존재"),
            ("OWN-03", "신탁등기 설정"),
            ("LIM-07", "대위변제 가능성이 있음"),
            ("LND-03", "분묘 소재가 확인됨"),
        )
        rules_by_code = {rule["code"]: rule for rule in SPECIAL_SITUATION_RULES}
        for code, source_text in cases:
            with self.subTest(code=code, source_text=source_text):
                rule = rules_by_code[code]
                self.assertTrue(detect_affirmative_signal(source_text, rule["keywords"])[0])

    def test_building_violation_uses_the_same_negation_contract(self):
        self.assertEqual(detect_building_violation("위반건축물 아님"), (False, ""))
        detected, evidence = detect_building_violation(
            "위반건축물 아님. 그러나 옥상 무단증축이 확인됨"
        )
        self.assertTrue(detected)
        self.assertIn("무단증축", evidence)


if __name__ == "__main__":
    unittest.main()
