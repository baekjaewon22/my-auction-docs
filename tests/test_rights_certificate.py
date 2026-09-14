import sys
import tempfile
import unittest
import hashlib
from pathlib import Path
from unittest.mock import MagicMock, patch

from bs4 import BeautifulSoup
from pptx import Presentation
from pptx.enum.text import MSO_AUTO_SIZE
from pptx.util import Inches

BACKEND_PATH = Path(__file__).resolve().parents[1] / "automation-service" / "backend"
if str(BACKEND_PATH) not in sys.path:
    sys.path.insert(0, str(BACKEND_PATH))

from app.services.rights_certificate import (  # noqa: E402
    _extract_management_fee,
    _extract_management_fee_amount,
    _extract_dividend_requests,
    _extract_myungseung_rights_analysis,
    _extract_rights,
    _clean_court_label,
    _paginate_narrative_sections,
    _right_dividend_request_status,
    _tenant_ocr_text_indicates_no_tenants,
    analyze_surplus,
    analyze_registered_takeover_rights,
    analyze_tenants,
    build_template_data,
    calculate_surplus_basis,
    export_pptx_to_pdf,
    extract_rights_context,
    extract_rights_context_by_ocr,
    extract_sale_spec_tenant_context_by_ocr,
    render_certificate_template,
    render_certificate_pptx_template,
    merge_rights,
    parse_rights_from_ocr,
    parse_tenants_from_ocr,
    registered_right_amount_total,
    substantive_registered_rights,
)
from app.services.rights_checklist import State, build_checklist_from_pipeline  # noqa: E402
from app.services.briefing_rights import _build_surplus_description as build_briefing_surplus_description  # noqa: E402
from app.services import crawler  # noqa: E402


def _slide_text(slide) -> str:
    values = []
    for shape in slide.shapes:
        if getattr(shape, "has_text_frame", False):
            values.append(shape.text_frame.text)
        if getattr(shape, "has_table", False):
            values.extend(cell.text for row in shape.table.rows for cell in row.cells)
    return "\n".join(values)


def _slide_image_hashes(slide) -> set[str]:
    return {
        hashlib.sha256(rel.target_part.blob).hexdigest()
        for rel in slide.part.rels.values()
        if not rel.is_external and rel.reltype.endswith("/image")
    }


class RightsCertificateTests(unittest.TestCase):
    def test_case_1232734_court_keeps_parent_and_branch(self):
        self.assertEqual(
            _clean_court_label("수원지방법원 안양지원 경매4계 2022 타경 102285"),
            "수원지방법원 안양지원",
        )
        self.assertEqual(
            _clean_court_label("안양지원 경매4계 2022 타경 102285 [아파트]"),
            "수원지방법원 안양지원",
        )
        # 서부지원처럼 둘 이상의 본원에 속하는 짧은 명칭은 추측하지 않는다.
        self.assertEqual(_clean_court_label("서부지원 경매1계"), "서부지원")

        soup = BeautifulSoup(
            """
            <h2>수원지방법원 관련사건</h2>
            <div id="header_detailz"><h2>안양지원 경매4계 <span class="blue">2022 타경 102285</span> [아파트]</h2></div>
            """,
            "html.parser",
        )
        parsed = crawler.parse_myauction_detail(soup, "https://www.my-auction.co.kr/view/1232734")
        self.assertEqual(parsed["case_number"], "2022 타경 102285")
        self.assertEqual(_clean_court_label(parsed["court"]), "수원지방법원 안양지원")

    def test_auction_date_never_uses_dividend_deadline(self):
        soup = BeautifulSoup(
            """
            <div id="dtl_table">
              <table>
                <tr><th>배당요구종기일</th><td>2026.10.12</td></tr>
                <tr><th>청구금액</th><td>82,859,092원</td></tr>
              </table>
            </div>
            <div class="plan_day"><span class="pink">매각기일 2026.11.03 10:30</span></div>
            """,
            "html.parser",
        )
        parsed = crawler.parse_myauction_detail(soup, "https://www.my-auction.co.kr/view/test")
        self.assertEqual(parsed["auction_date"], "2026.11.03 10:30")
        self.assertEqual(parsed["입찰기일"], "2026.11.03 10:30")
        self.assertNotEqual(parsed["auction_date"], "2026.10.12")

        deadline_only = BeautifulSoup(
            """
            <div id="dtl_table">
              <table><tr><th>배당요구종기일</th><td>2026.10.12</td></tr></table>
            </div>
            """,
            "html.parser",
        )
        parsed_deadline_only = crawler.parse_myauction_detail(deadline_only, "https://www.my-auction.co.kr/view/test")
        self.assertEqual(parsed_deadline_only["auction_date"], "")
        self.assertEqual(parsed_deadline_only["입찰기일"], "")

    def test_case_1232734_registry_claim_and_ocr_are_canonicalized(self):
        soup = BeautifulSoup(
            """
            <table><tr><th>경매종류</th><td>부동산임의경매</td><th>매각기일</th><td>2026.09.08</td><th>청구금액</th><td>514,682,600원</td></tr></table>
            <div id="dtl_stock">
              <div id="dtl_title"><h3>건물 등기부현황</h3></div>
              <table>
                <tr><th>순위</th><th>등기일</th><th>권리종류</th><th>권리자</th><th>금액</th><th>비고</th></tr>
                <tr><td>1</td><td>2019.01.25</td><td>근저당권</td><td>중소기업은행</td><td>513,000,000원</td><td>말소기준</td></tr>
                <tr><td>2</td><td>2021.10.18</td><td>근저당권</td><td>상상인저축은행</td><td>600,000,000원</td><td>소멸</td></tr>
                <tr><td>3</td><td>2022.06.02</td><td>임의경매</td><td>웰릭스에프앤아이대부</td><td>청구금액 514,682,600원</td><td>2022타경102285 소멸</td></tr>
              </table>
            </div>
            """,
            "html.parser",
        )
        html_rights = _extract_rights(soup)
        self.assertEqual(len(html_rights), 3)
        ocr_rights = parse_rights_from_ocr(
            "2019.01.25 근저당권 중소기업은행 513,000,000원 말소기준\n"
            "2021.10.18 근저당권 상상 600,000,000원 소멸\n"
            "2022.06.02 임의경매 ES 514,682,600원 소멸"
        )
        rights = merge_rights(html_rights, ocr_rights)
        self.assertEqual(len(rights), 3)
        self.assertEqual(len(substantive_registered_rights(rights)), 2)
        self.assertEqual(registered_right_amount_total(rights), 1_113_000_000)

        data = build_template_data({
            "case_number": "2022타경102285",
            "court": "안양지원 경매4계",
            "item_type": "아파트",
            "auction_type": "부동산임의경매",
            "claim_amount": "514,682,600원",
            "min_price": "760,800,000원",
            "rights": rights,
            "tenants": parse_tenants_from_ocr("※ 조사된 임차내역이 없습니다"),
            "tenant_ocr_text": "※ 조사된 임차내역이 없습니다",
            "source_completeness": {"registry": True},
        })
        self.assertEqual(data["court"], "수원지방법원 안양지원")
        self.assertEqual(data["registeredRightCount"], 2)
        self.assertEqual(data["registeredRightAmountTotal"], 1_113_000_000)
        self.assertEqual(data["auctionProcedureCount"], 1)
        self.assertIn("2019.01.25 일자 근저당권 [중소기업은행]", data["baseRightDescription"])
        self.assertIn("매수인에게 인수되는 등기상 권리는 없습니다", data["baseRightDescription"])
        self.assertEqual(data["tenantAnalysisText"], "조사된 임차인이 없으므로, 매수인에게 인수되는 임차권리는 없습니다.")
        self.assertIn("1,113,000,000원", data["narrativeReportHtml"])
        self.assertIn("청구금액은 514,682,600원", data["narrativeReportHtml"])
        self.assertIn("법원 경매절차비용을 차감하기 전", data["surplusDescription"])
        self.assertIn("가장 후순위 담보권을 신청담보권으로 보는 보수적 기준", data["surplusDescription"])
        self.assertIn("선순위인 기재금액은 513,000,000원", data["surplusDescription"])
        self.assertIn("배당재원은 247,800,000원", data["surplusDescription"])
        self.assertNotIn("선순위인 기재금액은 담당자 확인 필요", data["surplusDescription"])
        self.assertIn("무잉여 가능성은 사실상 없습니다", data["surplusDescription"])
        self.assertIn("신청담보권에도 1원 이상 배당될 수 있어", data["surplusDescription"])
        self.assertNotIn("현재 기재값 기준", data["surplusDescription"])
        self.assertIn("법원 기록으로 최종 확인해야 합니다", data["surplusDescription"])
        self.assertNotIn("전체 수집 완결성", data["narrativeReportHtml"])
        self.assertNotIn("같은 날짜에 설정된 권리는", data["narrativeReportHtml"])

    def test_forced_auction_entry_can_be_base_right_without_senior_takeover_caveats(self):
        soup = BeautifulSoup(
            """
            <div id="dtl_stock">
              <div id="dtl_title"><h3>건물 등기부현황</h3></div>
              <table>
                <tr><th>순위</th><th>등기일</th><th>권리종류</th><th>권리자</th><th>금액</th><th>비고</th></tr>
                <tr><td>1</td><td>2025.05.09</td><td>강제경매</td><td></td><td>90,000,000원</td><td>말소기준</td></tr>
              </table>
            </div>
            """,
            "html.parser",
        )
        context = extract_rights_context(soup)
        rights = context["rights"]
        self.assertTrue(context["source_completeness"]["registry"])
        self.assertEqual(len(rights), 1)
        self.assertEqual(rights[0]["type"], "강제경매")
        self.assertEqual(rights[0]["creditor"], "")
        self.assertEqual(len(substantive_registered_rights(rights)), 0)

        data = build_template_data({
            "case_number": "2025타경101054",
            "auction_type": "부동산강제경매",
            "min_price": "300,000,000원",
            **context,
            "expected_dividend": {
                "auctionApplicantDividendFound": True,
                "auctionApplicantDividendAmount": 1,
                "source": "expected_dividend_table",
            },
            "case_notice": "가등기 없음 가처분 없음",
            "tenant_ocr_text": "조사된 임차내역이 없습니다",
        })

        self.assertIn("2025.05.09 일자 강제경매 기입등기", data["baseRightDescription"])
        self.assertNotIn("[담당자 확인 필요]", data["baseRightDescription"])
        self.assertNotIn("등기 원본 전체 확보 여부", data["baseRightDescription"])
        self.assertIn("매수인에게 인수되는 등기상 권리는 없습니다", data["baseRightDescription"])
        self.assertIn("등기상 선순위 인수 권리는 없습니다", data["narrativeReportHtml"])
        self.assertIn("예상배당표상 말소기준권리 또는 경매신청채권자에게 채권배당금 1원", data["surplusDescription"])
        self.assertIn("현재 예상배당표 기준 무잉여 가능성은 없습니다", data["surplusDescription"])
        self.assertNotIn("입력자료 기재값", data["surplusDescription"])
        self.assertNotIn("가등기(담보/순위보전)</div>", data["narrativeReportHtml"])
        self.assertNotIn("가처분</div>", data["narrativeReportHtml"])

    def test_voluntary_auction_fallback_reads_like_a_written_opinion(self):
        rights = [{
            "type": "근저당권",
            "date": "2025.04.10",
            "creditor": "신한은행",
            "amount": 72_028_201,
            "isBaseRight": True,
        }]
        text = analyze_surplus(
            {
                "auction_type": "부동산임의경매",
                "claim_amount": "82,859,092원",
                "min_price": "1,376,800,000원",
                "auction_applicant_creditors": ["신한은행"],
            },
            rights,
            rights[0],
            [],
            rights_source_complete=False,
        )
        self.assertIn("본 경매는 근저당권자인 신한은행(청구금액 82,859,092원)이 임의경매를 신청한 사건입니다", text)
        self.assertIn("신청채권자에게 배당될 가능성이 있어 무잉여 가능성은 낮게 판단됩니다", text)
        self.assertIn("취하 가능성은 낮은 편으로 판단됩니다", text)
        self.assertNotIn("입력자료 기재값", text)
        self.assertNotIn("무잉여 산식을 확정하지 않았습니다", text)
        self.assertNotIn("단순 비율로 채권자의 향후 취하 여부를 예측하지 않습니다", text)

    def test_myungseung_analysis_is_scoped_and_rendered_as_a_special_issue(self):
        soup = BeautifulSoup(
            """
            <div id="dtl_stock"><div id="dtl_title"><h3>관련사건</h3></div><div class="excmt"><table class="tbl_excmt"><tr><th>재진행</th><td>무관한 문구</td></tr></table></div></div>
            <div id="dtl_stock"><div id="dtl_title"><h3>법무법인 명승 권리분석</h3></div><div class="excmt"><table class="tbl_excmt"><tr><th>재진행</th><td>중단되었던 매각 절차가 재개되었으며 입찰 전 최신 등기와 점유를 재확인해야 합니다.</td></tr></table></div></div>
            """,
            "html.parser",
        )
        analysis = _extract_myungseung_rights_analysis(soup)
        self.assertEqual(len(analysis), 1)
        self.assertEqual(analysis[0]["label"], "재진행")
        self.assertNotIn("무관한 문구", analysis[0]["text"])
        data = build_template_data({
            "case_number": "2022타경102285",
            "item_type": "아파트",
            "rights": [],
            "tenants": [],
            "myungseung_analysis": analysis,
        })
        report = data["narrativeReportHtml"]
        self.assertIn("<strong>재진행</strong>", report)
        self.assertIn("마이옥션 상세페이지 내 법무법인 명승 권리분석", report)
        self.assertNotIn("법무법인 명승 권리분석 · 법무법인 명승 권리분석", report)
        self.assertIn("중단되었던 매각 절차가 재개", report)

    def test_powerpoint_pdf_export_initializes_com_in_worker_thread(self):
        app = MagicMock()
        presentation = MagicMock()
        app.Presentations.Open.return_value = presentation

        with tempfile.TemporaryDirectory() as temp_dir:
            pptx_path = Path(temp_dir) / "certificate.pptx"
            pdf_path = Path(temp_dir) / "certificate.pdf"
            pptx_path.write_bytes(b"pptx")
            presentation.SaveAs.side_effect = lambda path, _format: Path(path).write_bytes(b"%PDF-1.7")

            with (
                patch("pythoncom.CoInitialize") as initialize,
                patch("pythoncom.CoUninitialize") as uninitialize,
                patch("win32com.client.DispatchEx", return_value=app) as dispatch,
            ):
                self.assertTrue(export_pptx_to_pdf(pptx_path, pdf_path))

        initialize.assert_called_once_with()
        dispatch.assert_called_once_with("PowerPoint.Application")
        presentation.Close.assert_called_once_with()
        app.Quit.assert_called_once_with()
        uninitialize.assert_called_once_with()

    def test_first_page_real_case_info_stays_two_lines_inside_fixed_box(self):
        template_path = BACKEND_PATH / "templates" / "rights_certificate" / "certificate.pptx"
        source = Presentation(str(template_path))
        source_case_shape = next(
            shape for shape in source.slides[0].shapes
            if getattr(shape, "has_text_frame", False) and "{{caseNumber}}" in shape.text
        )
        first_section_top = min(
            shape.top for shape in source.slides[0].shapes
            if getattr(shape, "has_table", False) and shape.top > source_case_shape.top
        )
        data = build_template_data(
            {
                "case_number": "2026타경12345",
                "court": "서울중앙지방법원",
                "item_type": "아파트",
                "rights": [],
                "tenants": [],
            }
        )

        with tempfile.TemporaryDirectory() as temp_dir:
            output_path = Path(temp_dir) / "case-info-fit.pptx"
            render_certificate_pptx_template(template_path, output_path, data)
            rendered = Presentation(str(output_path))

        case_shape = next(
            shape for shape in rendered.slides[0].shapes
            if getattr(shape, "has_text_frame", False) and "2026타경12345" in shape.text
        )
        self.assertEqual(case_shape.top, source_case_shape.top)
        self.assertEqual(case_shape.height, source_case_shape.height)
        self.assertLess(case_shape.top + case_shape.height, first_section_top)
        self.assertEqual(
            [paragraph.text for paragraph in case_shape.text_frame.paragraphs],
            ["사건번호: 2026타경12345", "서울중앙지방법원"],
        )
        self.assertFalse(case_shape.text_frame.word_wrap)
        self.assertEqual(case_shape.text_frame.auto_size, MSO_AUTO_SIZE.TEXT_TO_FIT_SHAPE)
        self.assertLessEqual(
            max(
                run.font.size.pt
                for paragraph in case_shape.text_frame.paragraphs
                for run in paragraph.runs
            ),
            12,
        )

    def test_pptx_keeps_first_page_and_replaces_tables_with_clean_narrative(self):
        template_path = BACKEND_PATH / "templates" / "rights_certificate" / "certificate.pptx"
        source = Presentation(str(template_path))
        source_first_shape_count = len(source.slides[0].shapes)
        data = build_template_data(
            {
                "case_number": "2026타경12345",
                "court": "서울중앙지방법원",
                "item_type": "아파트",
                "rights": [
                    {"type": "근저당권", "date": "2024-01-10", "creditor": "테스트은행", "isBaseRight": True},
                    {"type": "압류", "date": "2024-02-10", "creditor": "서울시"},
                ],
                "tenants": [{"name": "임차인 없음"}],
                "tenant_ocr_text": "임차인 없음",
                "sale_spec_remarks": "특별매각조건 해당 사항 없음",
                "case_document_text": "문건처리내역 확인 완료",
                "management_fee": {
                    "unpaidAmount": 0,
                    "amountStatus": "none",
                    "note": "미납 관리비 없음",
                },
                "source_completeness": {
                    "registry": True,
                    "sale_spec": True,
                    "status_survey": True,
                    "case_documents": True,
                    "appraisal": True,
                    "building_register": True,
                    "dividend_requests": True,
                },
                "author_name": "테스트 담당자",
            }
        )

        self.assertGreaterEqual(len(data["narrativePages"]), 2)
        self.assertNotIn("checklistRows", data)
        self.assertNotIn("checklistDetails", data)
        self.assertNotIn("specialSummaryText", data)

        with tempfile.TemporaryDirectory() as temp_dir:
            output_path = Path(temp_dir) / "certificate-with-narrative.pptx"
            render_certificate_pptx_template(template_path, output_path, data)
            rendered = Presentation(str(output_path))

        self.assertEqual(len(rendered.slides), 2 + len(data["narrativePages"]))
        self.assertEqual(len(rendered.slides[0].shapes), source_first_shape_count)
        self.assertIn("1. 말소기준 및 등기부상 소멸사항", _slide_text(rendered.slides[0]))
        narrative_text = "\n".join(_slide_text(slide) for slide in list(rendered.slides)[1:-1])
        self.assertIn("4. 특이사항", narrative_text)
        self.assertIn("1) 종합 판단", narrative_text)
        self.assertNotIn("특이사항 종합 검토의견", narrative_text)
        self.assertNotIn("종합 결론 및 잔여 확인사항", narrative_text)
        self.assertGreater(len(narrative_text), 800)
        self.assertNotIn("특이사항 종합 검토의견", narrative_text)
        self.assertNotIn("자료 미확보 및 추가 확인 범위", narrative_text)
        prototype_hashes = _slide_image_hashes(source.slides[1])
        closing_hashes = _slide_image_hashes(source.slides[-1])
        self.assertTrue(prototype_hashes)
        self.assertTrue(closing_hashes)
        self.assertEqual(_slide_image_hashes(rendered.slides[-1]), closing_hashes)
        for slide in list(rendered.slides)[1:-1]:
            self.assertEqual(_slide_image_hashes(slide), prototype_hashes)
            tables = [shape for shape in slide.shapes if getattr(shape, "has_table", False)]
            self.assertEqual(len(tables), 2)
        for forbidden in (
            "특이사항 종합 체크표", "YAML", "review-standard", "규칙엔진", "이상없음 17",
            "관리비 채권의 소멸시효는 3년",
        ):
            self.assertNotIn(forbidden, narrative_text)
        self.assertNotIn("{{", "\n".join(_slide_text(slide) for slide in rendered.slides))

    def test_pptx_narrative_refuses_landscape_template_before_writing_output(self):
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
                r"최소 7\.5 x 10\.8인치.*Narrative report requires slides at least 7\.5 x 10\.8 inches",
            ):
                render_certificate_pptx_template(template_path, output_path, data)

            self.assertFalse(output_path.exists())

    def test_pptx_expands_long_risky_report_without_blank_or_table_slides(self):
        template_path = BACKEND_PATH / "templates" / "rights_certificate" / "certificate.pptx"
        data = build_template_data(
            {
                "case_number": "2026타경59999",
                "item_type": "토지",
                "rights": [{"type": "근저당권", "date": "2024-01-10", "isBaseRight": True}],
                "tenants": [{"name": "임차인 없음"}],
                "case_document_text": (
                    "신탁등기 대위변제 분묘기지권 유치권 법정지상권 위반건축물 "
                    "농지취득자격증명 지분매각 토지 별도등기 대지권 미등기"
                ),
            }
        )
        self.assertGreater(len(data["narrativePages"]), 3)

        with tempfile.TemporaryDirectory() as temp_dir:
            output_path = Path(temp_dir) / "long-risk-report.pptx"
            render_certificate_pptx_template(template_path, output_path, data)
            rendered = Presentation(str(output_path))

        self.assertEqual(len(rendered.slides), 2 + len(data["narrativePages"]))
        for slide in list(rendered.slides)[1:-1]:
            self.assertTrue(_slide_text(slide).strip())
            self.assertEqual(
                sum(bool(getattr(shape, "has_table", False)) for shape in slide.shapes),
                2,
            )

    def test_risky_narrative_has_only_issue_blocks_and_no_internal_sources(self):
        data = build_template_data(
            {
                "case_number": "2026타경67890",
                "court": "서울중앙지방법원",
                "item_type": "아파트",
                "rights": [
                    {"type": "근저당권", "date": "2024-01-10", "creditor": "A은행", "isBaseRight": True},
                ],
                "tenants": [{
                    "name": "홍길동",
                    "moveInDate": "2023-01-01",
                    "fixedDate": "",
                    "depositClaimDate": "",
                    "deposit": "100,000,000원",
                    "occupancyType": "주거",
                }],
                "tenant_ocr_text": "홍길동 전입 2023년 1월 1일 보증금 100,000,000원",
                "case_document_text": "유치권 신고서 접수 및 신탁등기 관련 문건",
                "sale_spec_remarks": "유치권 신고 있음",
                "management_fee": {"unpaidAmount": 2_300_000, "amountStatus": "confirmed"},
                "source_completeness": {
                    "registry": True,
                    "sale_spec": True,
                    "case_documents": True,
                },
            }
        )

        issue_blocks = [
            block
            for page in data["narrativePages"]
            for block in page["blocks"]
            if block.get("sectionTitle") in ("권리관계 상세 검토", "임차·점유 및 보증금 인수 검토")
        ]
        issue_headings = [block["heading"] for block in issue_blocks]
        self.assertIn("유치권", issue_headings)
        self.assertIn("신탁등기", issue_headings)
        self.assertIn("보증금 인수", issue_headings)
        self.assertNotIn("선순위 전세권", issue_headings)
        fee_pages = [
            page for page in data["narrativePages"]
            if any(block["heading"] == "체납관리비" for block in page["blocks"])
        ]
        self.assertEqual(len(fee_pages), 1)
        self.assertGreater(len(fee_pages[0]["blocks"]), 1)
        for block in issue_blocks:
            with self.subTest(issue=block["heading"]):
                self.assertIn("확인", block["body"])
                self.assertNotIn("확인 사실:", block["body"])
                self.assertNotIn("권리 판단:", block["body"])
                self.assertNotIn("예상 영향:", block["body"])
                self.assertNotIn("입찰 전 조치:", block["body"])
        customer_text = data["narrativeReportHtml"]
        self.assertIn("유치권", customer_text)
        for forbidden in (
            "YAML", "review-standard", "권리분석_규칙.json", "32개", "특이사항 종합 체크표",
            "자동 판정", "자동 확인", "자동 탐지", "문건 탐지",
        ):
            self.assertNotIn(forbidden, customer_text)

    def test_missing_sources_never_become_clean_or_no_takeover(self):
        data = build_template_data(
            {"case_number": "2026타경1", "item_type": "아파트", "rights": [], "tenants": []}
        )
        text = data["narrativeReportHtml"]
        self.assertIn("등기부현황 확인이 필요한 사건입니다", text)
        self.assertIn("임차·점유 확인이 필요한 사건입니다", text)
        self.assertNotIn("깨끗하다고 단정하지 않습니다", text)
        self.assertNotIn("인수되는 임차권리는 없습니다", text)
        self.assertNotIn("인수되는 임차권리는 없습니다", data["tenantAnalysisText"])
        self.assertNotIn("인수 없음", data["tenantAnalysisText"])

        items = build_checklist_from_pipeline(
            data={}, rights=[], base_right=None, valid_tenants=[], management_fee={}, texts=[]
        )
        by_name = {item.name: item for item in items}
        self.assertEqual(by_name["선순위 전세권"].state, State.UNKNOWN)
        self.assertEqual(by_name["대항력"].state, State.UNKNOWN)
        self.assertEqual(by_name["보증금 인수"].state, State.UNKNOWN)
        self.assertEqual(by_name["체납관리비"].state, State.UNKNOWN)

    def test_explicit_no_tenant_row_is_distinct_from_empty_input(self):
        explicit = build_template_data(
            {
                "case_number": "2026타경2",
                "item_type": "아파트",
                "rights": [{"type": "근저당권", "date": "2024-01-10", "isBaseRight": True}],
                "tenants": [{"name": "임차인 없음"}],
            }
        )
        missing = build_template_data(
            {
                "case_number": "2026타경3",
                "item_type": "아파트",
                "rights": [{"type": "근저당권", "date": "2024-01-10", "isBaseRight": True}],
                "tenants": [],
            }
        )
        self.assertFalse(explicit["noTenants"])
        self.assertIn("법원에서 조사된 임차인 현황", explicit["tenantAnalysisText"])
        self.assertIn("인수되는 임차권리는 없습니다", explicit["tenantAnalysisText"])
        self.assertIn("임차·점유 확인이 필요한 사건입니다", missing["narrativeReportHtml"])

    def test_partial_no_tenant_ocr_is_scope_limited_on_first_page(self):
        partial = build_template_data(
            {
                "case_number": "2026타경20",
                "item_type": "아파트",
                "rights": [],
                "tenants": [],
                "tenant_source": "sale_spec_ocr",
                "tenant_ocr_text": "임차인 없음",
            }
        )
        self.assertFalse(partial["noTenants"])
        self.assertIn("법원에서 조사된 임차인 현황", partial["tenantAnalysisText"])
        self.assertIn("매수인에게 인수되는 임차권리는 없습니다", partial["tenantAnalysisText"])
        self.assertIn("조사 결과상 임차인은 없으며", partial["narrativeReportHtml"])

        complete = build_template_data(
            {
                "case_number": "2026타경20",
                "item_type": "아파트",
                "rights": [],
                "tenants": [],
                "tenant_source": "sale_spec_ocr",
                "tenant_ocr_text": "임차인 없음",
                "source_completeness": {"sale_spec": True},
            }
        )
        self.assertTrue(complete["noTenants"])
        self.assertIn("매수인에게 인수되는 임차권리는 없습니다", complete["tenantAnalysisText"])

    def test_no_tenant_ocr_requires_tenant_label_and_adjacent_absence_value(self):
        self.assertTrue(_tenant_ocr_text_indicates_no_tenants("임차인: 없음"))
        self.assertTrue(_tenant_ocr_text_indicates_no_tenants("점유자 성명\n해당사항 없음"))
        self.assertFalse(_tenant_ocr_text_indicates_no_tenants("임차인 홍길동\n확정일자 해당없음"))
        self.assertFalse(_tenant_ocr_text_indicates_no_tenants("홍길동 / 전입일 2023-01-01 / 해당사항 없음"))

        data = build_template_data(
            {
                "case_number": "2026타경21",
                "item_type": "아파트",
                "rights": [],
                "tenants": [],
                "tenant_ocr_text": "임차인 홍길동\n확정일자 해당없음",
            }
        )
        self.assertFalse(data["noTenants"])
        self.assertNotIn("인수되는 임차권리는 없습니다", data["tenantAnalysisText"])
        self.assertIn("임차·점유 확인이 필요한 사건입니다", data["narrativeReportHtml"])

    def test_site_survey_explicit_no_tenant_is_definitive_without_fake_name(self):
        text = "※ 조사된 임차내역이 없습니다\n별지 전입세대열람내역상 채무자(소유자) 세대 전입"
        tenants = parse_tenants_from_ocr(text)
        self.assertEqual(len(tenants), 1)
        self.assertNotEqual(tenants[0]["name"], "조사된")
        data = build_template_data({
            "case_number": "2022타경102285",
            "item_type": "아파트",
            "rights": [{"type": "근저당권", "date": "2019.01.25", "isBaseRight": True}],
            "tenants": tenants,
            "tenant_ocr_text": text,
        })
        self.assertEqual(data["tenantAnalysisText"], "조사된 임차인이 없으므로, 매수인에게 인수되는 임차권리는 없습니다.")
        self.assertIn("법원에서 조사된 임차인 현황에는", data["narrativeReportHtml"])
        self.assertIn("조사 결과상 임차인은 없으며", data["narrativeReportHtml"])

    def test_source_label_or_missing_base_date_never_proves_no_tenant_takeover(self):
        source_label_only = build_template_data(
            {
                "case_number": "2026타경31",
                "item_type": "아파트",
                "rights": [],
                "tenants": [],
                "tenant_source": "sale_spec_ocr",
                "tenant_ocr_text": "",
            }
        )
        self.assertIn("담당자 확인이 필요", source_label_only["tenantAnalysisText"])
        self.assertNotIn("인수되는 임차권리는 없습니다", source_label_only["tenantAnalysisText"])
        self.assertIn("임차·점유 확인이 필요한 사건입니다", source_label_only["narrativeReportHtml"])

        missing_base = build_template_data(
            {
                "case_number": "2026타경32",
                "item_type": "아파트",
                "rights": [],
                "tenants": [{
                    "name": "홍길동",
                    "moveInDate": "2023-01-01",
                    "deposit": "100,000,000원",
                    "occupancyType": "주거",
                }],
                "tenant_ocr_text": "홍길동 전입 2023년 1월 1일 보증금 100,000,000원",
            }
        )
        self.assertIn("말소기준권리 일자가 확인되지 않아", missing_base["tenantAnalysisText"])
        self.assertNotIn("인수되는 임차권리는 없습니다", missing_base["tenantAnalysisText"])

    def test_partial_tenant_source_describes_only_the_known_junior_tenant(self):
        data = build_template_data(
            {
                "case_number": "2026타경32",
                "item_type": "아파트",
                "rights": [{"type": "근저당권", "date": "2024-01-10", "isBaseRight": True}],
                "tenants": [{
                    "name": "홍길동",
                    "moveInDate": "2024-02-01",
                    "fixedDate": "2024-02-02",
                    "depositClaimDate": "2024-02-03",
                    "depositDeadline": "2024-03-01",
                }],
            }
        )
        first_page = data["tenantAnalysisText"]
        self.assertIn("확인된 임차인은 말소기준권리보다 후순위", first_page)
        self.assertIn("낙찰자에게 인수되는 임차권리는 없습니다", first_page)

    def test_missing_tenant_dates_do_not_calculate_priority_repayment_or_safe_dividend(self):
        base_right = {"type": "근저당권", "date": "2024-01-10", "isBaseRight": True}
        data = build_template_data(
            {
                "case_number": "2026타경33",
                "item_type": "아파트",
                "address": "",
                "rights": [base_right],
                "tenants": [{
                    "name": "홍길동",
                    "moveInDate": "",
                    "fixedDate": "",
                    "depositClaimDate": "",
                    "deposit": "50,000,000원",
                    "occupancyType": "주거",
                }],
                "source_completeness": {"registry": True, "sale_spec": True},
            }
        )
        first_page = data["tenantAnalysisText"]
        self.assertIn("최우선변제 여부", first_page)
        self.assertIn("판단을 유보", first_page)
        self.assertNotIn("최우선 변제됩니다", first_page)
        self.assertNotIn("인수되지 않습니다", first_page)

        items = build_checklist_from_pipeline(
            data={"item_type": "아파트"},
            rights=[base_right],
            base_right=base_right,
            valid_tenants=[{"name": "홍길동", "moveInDate": ""}],
            management_fee={},
            tenant_source_confirmed=True,
            rights_source_confirmed=True,
        )
        by_name = {item.name: item for item in items}
        self.assertEqual(by_name["배당요구"].state, State.UNKNOWN)
        self.assertIn("배당요구", data["narrativeReportHtml"])

    def test_late_tenant_dividend_demand_is_risk_and_blocks_priority_amount(self):
        base_right = {"type": "근저당권", "date": "2024-01-10", "isBaseRight": True}
        tenant = {
            "name": "홍길동",
            "moveInDate": "2023-01-01",
            "fixedDate": "2023-01-02",
            "depositClaimDate": "2024-04-01",
            "depositDeadline": "2024-03-01",
            "deposit": "50,000,000원",
            "occupancyType": "주거",
        }
        data = build_template_data(
            {
                "case_number": "2026타경34",
                "item_type": "아파트",
                "address": "서울특별시 중구 세종대로 1",
                "rights": [base_right],
                "tenants": [tenant],
                "source_completeness": {"registry": True, "sale_spec": True},
            }
        )
        first_page = data["tenantAnalysisText"]
        self.assertIn("배당요구일이 배당요구종기보다 늦어", first_page)
        self.assertNotIn("한도에서 우선변제", first_page)
        self.assertNotIn("잔존 보증금은 0원", first_page)

        items = build_checklist_from_pipeline(
            data={"item_type": "아파트"},
            rights=[base_right],
            base_right=base_right,
            valid_tenants=[tenant],
            management_fee={},
            tenant_source_confirmed=True,
            rights_source_confirmed=True,
        )
        by_name = {item.name: item for item in items}
        self.assertEqual(by_name["배당요구"].state, State.RISK)
        self.assertNotIn("적법한 배당요구 제출", by_name["배당요구"].basis)

        separate_request = build_template_data(
            {
                "case_number": "2026타경34-1",
                "item_type": "아파트",
                "address": "서울특별시 중구 세종대로 1",
                "rights": [base_right],
                "tenants": [{**tenant, "depositClaimDate": "", "depositDeadline": ""}],
                "dividend_requests": [{
                    "creditor": "홍길동",
                    "requestDate": "2024-04-01",
                    "deadline": "2024-03-01",
                }],
                "source_completeness": {"registry": True, "sale_spec": True},
            }
        )
        self.assertIn("배당요구일이 배당요구종기보다 늦어", separate_request["tenantAnalysisText"])
        demand_blocks = [
            block for page in separate_request["narrativePages"] for block in page["blocks"]
            if block["heading"] == "배당요구"
        ]
        self.assertTrue(demand_blocks)
        self.assertEqual(demand_blocks[0]["kind"], "risk")

    def test_same_date_right_is_not_described_as_junior(self):
        rights = [
            {"type": "근저당권", "date": "2024-01-10", "creditor": "A은행", "isBaseRight": True},
            {"type": "가처분", "date": "2024-01-10", "creditor": "B"},
        ]
        items = build_checklist_from_pipeline(
            data={}, rights=rights, base_right=rights[0], valid_tenants=[], management_fee={},
            texts=["가처분 등기"], tenant_source_confirmed=False, signal_source_confirmed=True,
        )
        by_name = {item.name: item for item in items}
        self.assertEqual(by_name["가처분"].state, State.CHECK)

        data = build_template_data(
            {"case_number": "2026타경4", "item_type": "아파트", "rights": rights, "tenants": []}
        )
        first_page = data["baseRightDescription"]
        self.assertIn("같은 날짜", first_page)
        self.assertIn("접수번호·순위 확인 전", first_page)
        self.assertNotIn("인수되는 권리는 없습니다", first_page)

    def test_special_situations_outside_internal_32_items_are_not_dropped(self):
        data = build_template_data(
            {
                "case_number": "2026타경41",
                "item_type": "토지",
                "rights": [{"type": "근저당권", "date": "2024-01-10", "isBaseRight": True}],
                "tenants": [{"name": "임차인 없음"}],
                "case_document_text": (
                    "신탁등기가 현재 존속 중. 임차인의 대위변제 가능성이 있음. "
                    "현장에서 분묘 소재가 확인됨."
                ),
            }
        )
        blocks = [block for page in data["narrativePages"] for block in page["blocks"]]
        by_heading = {block["heading"]: block for block in blocks}
        for heading in ("신탁등기", "대위변제 위험", "분묘기지권"):
            with self.subTest(heading=heading):
                self.assertIn(heading, by_heading)
                body = by_heading[heading]["body"]
                self.assertNotIn("확인 사실:", body)
                self.assertNotIn("권리 판단:", body)
                self.assertNotIn("예상 영향:", body)
                self.assertNotIn("입찰 전 조치:", body)

    def test_appraisal_text_is_positive_evidence_but_not_global_absence_coverage(self):
        partial = build_template_data(
            {
                "case_number": "2026타경42",
                "item_type": "아파트",
                "rights": [{"type": "근저당권", "date": "2024-01-10", "isBaseRight": True}],
                "tenants": [],
                "appraisal_raw": "감정평가액 300,000,000원",
            }
        )
        partial_text = partial["narrativeReportHtml"]
        self.assertNotIn("유치권·토지 별도등기 관련 특이 기재는 발견되지 않았습니다", partial_text)
        self.assertNotIn("관련 특이 기재가 발견되지 않았습니다", partial_text)
        self.assertNotIn("자료 미확보 및 추가 확인 범위", partial_text)
        self.assertNotIn("인수되는 권리는 없습니다", partial["baseRightDescription"])

        positive = build_template_data(
            {
                "case_number": "2026타경43",
                "item_type": "아파트",
                "rights": [],
                "tenants": [],
                "appraisal_raw": "감정평가서에 제시외 건물 표시가 있음",
            }
        )
        headings = [block["heading"] for page in positive["narrativePages"] for block in page["blocks"]]
        self.assertIn("제시외 건물", headings)

        timed_out = build_template_data(
            {
                "case_number": "2026타경44",
                "item_type": "아파트",
                "rights": [{"type": "근저당권", "date": "2024-01-10", "isBaseRight": True}],
                "tenants": [],
                "rights_ocr_text": "근저당권 일부 OCR",
                "source_completeness": {"registry": True, "sale_spec": True},
                "source_collection_incomplete": True,
            }
        )
        self.assertNotIn("인수되는 권리는 없습니다", timed_out["baseRightDescription"])
        self.assertNotIn("자료 미확보 및 추가 확인 범위", timed_out["narrativeReportHtml"])

        failed_registry = build_template_data(
            {
                "case_number": "2026타경4-1",
                "item_type": "아파트",
                "rights": [{"type": "근저당권", "date": "2024-01-10", "isBaseRight": True}],
                "source_completeness": {"registry": True},
                "source_status": {
                    "registry": {"collected": True, "complete": True, "failed": True},
                },
            }
        )
        self.assertNotIn("인수되는 권리는 없습니다", failed_registry["baseRightDescription"])

    def test_partial_sources_still_produce_detailed_fact_narrative(self):
        data = build_template_data(
            {
                "case_number": "2026타경35",
                "item_type": "아파트",
                "rights": [
                    {"type": "근저당권", "date": "2024-01-10", "isBaseRight": True},
                    {"type": "압류", "date": "2024-02-10"},
                ],
                "tenants": [{"name": "홍길동", "moveInDate": "2024-03-01"}],
                "appraisal_raw": "감정평가현황 일부 기재",
            }
        )
        report = data["narrativeReportHtml"]
        self.assertIn("실체 권리는 2건", report)
        self.assertIn("임차 관련 기재 1건", report)
        self.assertNotIn("인수되는 권리는 없습니다", data["baseRightDescription"])
        self.assertNotIn("관련 특이 기재는 발견되지 않았습니다", report)

    def test_partial_amount_sources_do_not_produce_surplus_or_withdrawal_conclusions(self):
        data = build_template_data(
            {
                "case_number": "2026타경36",
                "item_type": "아파트",
                "appraised_price": "1,000,000,000원",
                "min_price": "700,000,000원",
                "rights": [{
                    "type": "근저당권",
                    "date": "2024-01-10",
                    "amount": 10_000_000,
                    "isBaseRight": True,
                }],
                "tenants": [],
                "appraisal_raw": "감정가 1,000,000,000원",
            }
        )
        text = data["surplusDescription"]
        self.assertIn("무잉여 여부를 결론내리지 않았습니다", text)
        self.assertIn("단순 비율로 채권자의 향후 취하 여부를 예측하지 않습니다", text)
        self.assertNotIn("입력자료 기재값", text)
        self.assertNotIn("무잉여 가능성은 낮습니다", text)
        self.assertNotIn("감정가 대비 1%", text)

    def test_eviction_execution_cost_does_not_complete_no_surplus_formula(self):
        data = build_template_data(
            {
                "case_number": "2026타경37",
                "item_type": "아파트",
                "appraised_price": "1,000,000,000원",
                "min_price": "700,000,000원",
                "rights": [{
                    "type": "근저당권",
                    "date": "2024-01-10",
                    "amount": 10_000_000,
                    "isBaseRight": True,
                }],
                "tenants": [{"name": "임차인 없음"}],
                "execution_cost_source_complete": True,
                "myauction_eviction_costs": {"grandTotal": 50_000_000},
                "source_completeness": {"registry": True, "appraisal": True},
            }
        )
        text = data["surplusDescription"]
        self.assertIn("무잉여 여부를 결론내리지 않았습니다", text)
        self.assertIn("법원 경매절차비용", text)
        self.assertNotIn("무잉여 가능성은 낮습니다", text)
        self.assertIn("단순 비율로 채권자의 향후 취하 여부를 예측하지 않습니다", text)
        self.assertNotIn("70%", text)

    def test_no_surplus_basis_requires_explicit_court_cost_and_applicant_priority(self):
        rights = [{
            "type": "근저당권",
            "date": "2024-01-10",
            "creditor": "A은행",
            "amount": 300_000_000,
            "isBaseRight": True,
        }]
        old_eviction_basis = calculate_surplus_basis(
            {
                "min_price": "700,000,000원",
                "auction_applicant_creditors": ["A은행"],
                "execution_cost_source_complete": True,
                "myauction_eviction_costs": {"grandTotal": 50_000_000},
            },
            rights,
            rights[0],
        )
        self.assertFalse(old_eviction_basis["can_calculate"])
        self.assertFalse(old_eviction_basis["court_cost_available"])
        self.assertEqual(old_eviction_basis["court_auction_cost"], 0)

        explicit_court_basis = calculate_surplus_basis(
            {
                "min_price": "700,000,000원",
                "auction_applicant_creditors": ["A은행"],
                "court_auction_cost": "10,000,000원",
                "court_auction_cost_source_complete": True,
            },
            rights,
            rights[0],
        )
        self.assertTrue(explicit_court_basis["can_calculate"])
        self.assertEqual(explicit_court_basis["remainder"], 690_000_000)

    def test_disclosed_voluntary_basis_formats_no_prior_rights_as_zero_won(self):
        rights = [
            {
                "type": "근저당권",
                "date": "2024-01-10",
                "creditor": "A은행",
                "amount": 300_000_000,
                "isBaseRight": True,
            },
            {
                "type": "임의경매",
                "date": "2024-06-01",
                "creditor": "A은행",
                "amount": 301_000_000,
                "isAuctionProcedure": True,
            },
        ]
        text = analyze_surplus(
            {
                "auction_type": "부동산임의경매",
                "claim_amount": "301,000,000원",
                "min_price": "700,000,000원",
            },
            rights,
            rights[0],
            [],
            rights_source_complete=True,
        )
        self.assertIn("선순위인 기재금액은 0원", text)
        self.assertNotIn("선순위인 기재금액은 담당자 확인 필요", text)

    def test_duplicate_expected_dividend_and_same_applicant_are_not_no_surplus_shortcuts(self):
        rights = [{
            "type": "근저당권",
            "date": "2024-01-10",
            "creditor": "A은행",
            "amount": 300_000_000,
            "isBaseRight": True,
        }]
        data = {
            "min_price": "700,000,000원",
            "auction_applicant_creditors": ["A은행"],
            "expected_dividend": {
                "auctionApplicantDividendFound": True,
                "auctionApplicantDividendAmount": 100_000_000,
            },
            "execution_cost_source_complete": True,
            "myauction_eviction_costs": {"grandTotal": 50_000_000},
        }
        text = analyze_surplus(
            data,
            rights,
            rights[0],
            [{"type": "중복경매", "caseNumber": "2024타경2"}],
            rights_source_complete=True,
        )
        self.assertIn("예상배당표상 말소기준권리 또는 경매신청채권자에게 채권배당금 100,000,000원", text)
        self.assertIn("현재 예상배당표 기준 무잉여 가능성은 없습니다", text)
        self.assertNotIn("중복경매 신청 사건이 확인되므로", text)
        self.assertNotIn("경매신청채권자는 배당을 받을 수 있으므로", text)
        self.assertNotIn("우선 배당 가능성이 높으므로", text)

        briefing_text = build_briefing_surplus_description(
            data,
            rights,
            [{"type": "중복경매", "caseNumber": "2024타경2"}],
            rights[0],
        )
        self.assertIn("현재 예상배당표 기준 무잉여 가능성은 없습니다", briefing_text)
        self.assertNotIn("70%", briefing_text)
        self.assertNotIn("중복경매 신청 사건이 확인되므로", briefing_text)

    def test_full_sale_spec_pdf_text_marks_only_that_source_complete(self):
        full_text = (
            "매각물건명세서\n최선순위 설정일자 2024.01.10\n"
            "배당요구종기 2024.03.01\n임차인 없음\n비고 해당사항 없음"
        )
        with (
            patch(
                "app.services.rights_certificate.collect_sale_spec_text_and_images",
                return_value=(full_text, ["page1.png"]),
            ),
            patch("app.services.rights_certificate.ocr_image_to_text", return_value=full_text),
        ):
            context = extract_sale_spec_tenant_context_by_ocr(object(), task_id="full-pdf")

        self.assertTrue(context["_sale_spec_complete"])
        self.assertFalse(context["_incomplete"])
        self.assertIn("매각물건명세서", context["tenant_ocr_text"])

    def test_sale_spec_header_or_empty_page_does_not_prove_complete_source(self):
        with (
            patch(
                "app.services.rights_certificate.collect_sale_spec_text_and_images",
                return_value=("매각물건명세서", ["page2.png"]),
            ),
            patch("app.services.rights_certificate.ocr_image_to_text", return_value=""),
        ):
            context = extract_sale_spec_tenant_context_by_ocr(object(), task_id="partial-pdf")

        self.assertFalse(context["_sale_spec_complete"])
        self.assertTrue(context["_incomplete"])
        self.assertIn("매각물건명세서", context["tenant_ocr_text"])

        full_text = "점유관계 임차인 없음\n비고 해당사항 없음\n최선순위 설정 2024.01.10"
        with (
            patch(
                "app.services.rights_certificate.collect_sale_spec_text_and_images",
                return_value=(full_text, ["page1.png", "page2.png"]),
            ),
            patch(
                "app.services.rights_certificate.ocr_image_to_text",
                side_effect=[full_text, "매각물건명세서"],
            ),
        ):
            mixed = extract_sale_spec_tenant_context_by_ocr(object(), task_id="mixed-pdf")

        self.assertFalse(mixed["_sale_spec_complete"])
        self.assertTrue(mixed["_incomplete"])

    def test_registry_capture_failure_is_propagated_as_incomplete(self):
        with (
            patch("app.services.rights_certificate.pytesseract", object()),
            patch(
                "app.services.rights_certificate.capturer.capture_table_split_by_rows",
                side_effect=RuntimeError("capture failed"),
            ),
        ):
            context = extract_rights_context_by_ocr(object(), task_id="capture-failure")

        self.assertTrue(context["_incomplete"])
        self.assertFalse(context["_source_complete"])
        self.assertEqual(context["rights_ocr_images"], [])

    def test_senior_lease_dividend_request_uses_three_states(self):
        right = {
            "type": "전세권",
            "date": "2023-01-01",
            "creditor": "홍길동",
            "amount": 100_000_000,
        }
        base = {"type": "근저당권", "date": "2024-01-10", "creditor": "은행"}
        self.assertIsNone(_right_dividend_request_status(right, []))
        self.assertIsNone(_right_dividend_request_status({**right, "note": "배당요구 여부 확인 필요"}, []))
        self.assertFalse(_right_dividend_request_status({**right, "note": "배당요구 없음"}, []))
        self.assertFalse(_right_dividend_request_status({**right, "note": "배당요구 미제출"}, []))
        self.assertIsNone(_right_dividend_request_status({**right, "note": "배당요구종기 2024-03-01"}, []))
        self.assertIsNone(_right_dividend_request_status({**right, "note": "배당요구 신청 예정"}, []))
        self.assertTrue(_right_dividend_request_status({
            **right,
            "note": "배당요구 접수 완료",
            "dividendRequestDate": "2024-02-01",
            "dividendDeadline": "2024-03-01",
        }, []))
        self.assertIsNone(_right_dividend_request_status(
            right,
            [{"creditor": "홍길동", "requestDate": "2024-02-01"}],
        ))
        self.assertTrue(_right_dividend_request_status(
            right,
            [{"creditor": "홍길동", "requestDate": "2024-02-01", "deadline": "2024-03-01"}],
        ))
        self.assertFalse(_right_dividend_request_status(
            right,
            [{"creditor": "홍길동", "requestDate": "2024-04-01", "deadline": "2024-03-01"}],
        ))

        unknown_text = " ".join(analyze_registered_takeover_rights([right], base, []))
        self.assertIn("배당요구 자료가 충분히 확보되지 않아", unknown_text)
        self.assertIn("인수 가능성을 배제할 수 없습니다", unknown_text)
        self.assertNotIn("낙찰자에게 인수됩니다", unknown_text)

        no_text = " ".join(analyze_registered_takeover_rights(
            [{**right, "note": "배당요구 없음"}], base, []
        ))
        self.assertIn("배당요구가 없는 것으로 확인", no_text)

        yes_text = " ".join(analyze_registered_takeover_rights(
            [right], base, [{"creditor": "홍길동", "requestDate": "2024-02-01", "deadline": "2024-03-01"}]
        ))
        self.assertIn("배당요구가 확인", yes_text)

        late_text = " ".join(analyze_registered_takeover_rights(
            [right], base, [{"creditor": "홍길동", "requestDate": "2024-04-01", "deadline": "2024-03-01"}]
        ))
        self.assertIn("배당요구 접수는 확인되지만", late_text)
        self.assertIn("접수일이 배당요구종기보다 늦어", late_text)
        self.assertNotIn("배당요구가 없는 것으로 확인", late_text)

    def test_dividend_request_parser_rejects_deadline_and_planned_rows(self):
        soup = BeautifulSoup(
            """
            <table>
              <tr><th>배당요구종기</th><td>2024-03-01</td><td>홍길동</td></tr>
              <tr><td>배당요구 신청 예정</td><td>2024-02-01</td><td>김철수</td></tr>
              <tr><td>배당요구서 접수 완료</td><td>2024-02-02</td><td>이영희</td><td>2024-03-01</td></tr>
            </table>
            """,
            "html.parser",
        )
        requests = _extract_dividend_requests(soup)
        self.assertEqual(len(requests), 1)
        self.assertEqual(requests[0]["requestDate"], "2024.02.02")
        self.assertEqual(requests[0]["deadline"], "2024.03.01")

    def test_zero_management_fee_without_explicit_clear_remains_unknown(self):
        unknown = build_checklist_from_pipeline(
            data={}, rights=[], base_right=None, valid_tenants=[],
            management_fee={"unpaidAmount": 0}, texts=[],
        )
        clear = build_checklist_from_pipeline(
            data={}, rights=[], base_right=None, valid_tenants=[],
            management_fee={"unpaidAmount": 0, "note": "미납 관리비 없음"}, texts=[],
        )
        unknown_fee = next(item for item in unknown if item.name == "체납관리비")
        clear_fee = next(item for item in clear if item.name == "체납관리비")
        self.assertEqual(unknown_fee.state, State.UNKNOWN)
        self.assertEqual(clear_fee.state, State.SAFE)

    def test_html_fallback_contains_narrative_without_table_or_internal_sources(self):
        template_path = BACKEND_PATH / "templates" / "rights_certificate" / "certificate.html"
        data = build_template_data(
            {
                "case_number": "2026타경5",
                "item_type": "아파트",
                "rights": [{"type": "근저당권", "date": "2024-01-10", "isBaseRight": True}],
                "tenants": [{"name": "임차인 없음"}],
                "management_fee": {"unpaidAmount": 0, "note": "미납 관리비 없음"},
            }
        )
        rendered = render_certificate_template(str(template_path), data)
        self.assertIn("4. 특이사항", rendered)
        self.assertIn("<ol class=\"special-list\">", rendered)
        self.assertNotIn("특이사항 종합 검토의견", rendered)
        self.assertNotIn("특이사항 종합 체크표", rendered)
        self.assertNotIn("4. 기타사항", rendered)
        self.assertNotIn("가격 분석", rendered)
        self.assertNotIn("담당자 검토", rendered)
        self.assertNotIn("관리비 채권의 소멸시효는 3년", rendered)
        self.assertNotIn("checklistRows", rendered)
        self.assertNotIn("YAML", rendered)
        self.assertNotIn("{{", rendered)

    def test_narrative_pagination_never_splits_a_block(self):
        marker = "문단중간분할금지-" + ("가" * 250)
        sections = [{
            "title": "동적 상세",
            "blocks": [
                {"heading": f"항목 {index}", "body": marker + str(index), "kind": "check", "label": "추가 확인"}
                for index in range(10)
            ],
        }]
        pages = _paginate_narrative_sections(sections)
        rendered_bodies = [block["body"] for page in pages for block in page["blocks"]]
        self.assertGreater(len(pages), 1)
        self.assertEqual(len(rendered_bodies), 10)
        for index in range(10):
            self.assertEqual(sum(body.endswith(str(index)) for body in rendered_bodies), 1)

    def test_short_narrative_blocks_fill_four_then_three_panels(self):
        sections = [{
            "title": "동적 박스",
            "blocks": [
                {"heading": f"항목 {index}", "body": "확인된 사실과 결론입니다.", "kind": "neutral", "label": "검토"}
                for index in range(7)
            ],
        }]
        pages = _paginate_narrative_sections(sections)
        self.assertEqual([len(page["blocks"]) for page in pages], [4, 3])

    def test_short_blocks_fill_pages_across_section_boundaries(self):
        sections = [
            {
                "title": "특이사항",
                "blocks": [
                    {"heading": f"요약 {index}", "body": "확인된 결론입니다.", "kind": "neutral", "label": "검토"}
                    for index in range(3)
                ],
            },
            {
                "title": "법무법인 명승 권리분석",
                "blocks": [
                    {"heading": f"상세 {index}", "body": "확인된 사실입니다.", "kind": "check", "label": "전문 검토"}
                    for index in range(4)
                ],
            },
        ]

        pages = _paginate_narrative_sections(sections)

        self.assertEqual([len(page["blocks"]) for page in pages], [4, 3])
        self.assertEqual(pages[0]["title"], "특이사항")
        self.assertEqual(
            [block["heading"] for page in pages for block in page["blocks"]],
            ["요약 0", "요약 1", "요약 2", "상세 0", "상세 1", "상세 2", "상세 3"],
        )

    def test_narrative_pagination_rebalances_a_single_panel_tail(self):
        sections = [{
            "title": "사건별 검토",
            "blocks": [
                {
                    "heading": f"항목 {index}",
                    "body": "확인된 사실과 결론을 사건자료에 따라 설명합니다. " * 6,
                    "kind": "neutral",
                    "label": "검토",
                }
                for index in range(4)
            ],
        }]

        pages = _paginate_narrative_sections(sections)

        self.assertEqual([len(page["blocks"]) for page in pages], [2, 2])

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

if __name__ == "__main__":
    unittest.main()
