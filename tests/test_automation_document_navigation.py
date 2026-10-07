import sys
import unittest
from pathlib import Path
from unittest.mock import MagicMock, patch
from selenium.common.exceptions import TimeoutException

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'automation-service' / 'backend'))
from app.services import orchestrator, briefing_rights, selenium_driver
from bs4 import BeautifulSoup


class DocumentNavigationTests(unittest.TestCase):
    def test_sale_spec_property_appendix_is_substantive_but_not_core_sections(self):
        rc = briefing_rights.rc
        appendix = '부동산의 표시 2025타경72695 1동의 건물의 표시 전유부분의 건물의 표시 대지권의 목적인 토지의 표시'
        self.assertTrue(rc._sale_spec_page_text_is_substantive(appendix))
        self.assertFalse(rc._sale_spec_required_sections_present(appendix))
        self.assertFalse(rc._sale_spec_page_text_is_substantive('부동산의 표시 ' + '읽을 수 없음 ' * 5))
        self.assertFalse(rc._sale_spec_page_text_is_substantive(''))

    def test_case_document_url_is_scoped_to_official_host_and_supported_types(self):
        self.assertEqual(selenium_driver.myauction_document_url('https://www.my-auction.co.kr/view3/1524170/user', 'mul'), 'https://www.my-auction.co.kr/auction/auction_detail_view.php?type=mul&idx=1524170')
        self.assertEqual(selenium_driver.myauction_document_url('https://example.com/view3/1524170/user', 'mul'), '')
        self.assertEqual(selenium_driver.myauction_document_url('https://www.my-auction.co.kr/view3/1524170/user', 'unsupported'), '')

    def test_registry_pdf_fallback_recovers_missing_html_tables(self):
        rc = briefing_rights.rc
        driver = MagicMock()
        with patch.object(rc, 'pytesseract', object()), patch.object(rc.capturer, 'capture_table_split_by_rows', side_effect=TimeoutException()), patch.object(rc, '_collect_registry_pdf_text', return_value=('2024.01.01 근저당권 은행 10000000원', True)):
            result = rc.extract_rights_context_by_ocr(driver, task_id='fallback')
        self.assertFalse(result['_incomplete'])
        self.assertTrue(result['_source_complete'])
        self.assertIn('근저당권', result['rights_ocr_text'])

    def test_sale_spec_uses_actual_document_url(self):
        rc = briefing_rights.rc
        driver = MagicMock()
        driver.current_url = 'https://www.my-auction.co.kr/view3/1524170/user'
        with patch.object(rc, 'wait_document_ready'), patch.object(rc, 'safe_click') as click:
            rc._open_sale_spec_document(driver)
        driver.get.assert_called_once_with('https://www.my-auction.co.kr/auction/auction_detail_view.php?type=mul&idx=1524170')
        click.assert_not_called()

    def test_document_tab_uses_url_without_unreliable_click(self):
        driver, wait = MagicMock(), MagicMock()
        driver.current_url = 'https://www.my-auction.co.kr/auction/auction_detail_view.php?type=bu&idx=1524170'
        target = 'https://www.my-auction.co.kr/auction/auction_detail_view.php?type=aceeair&idx=1524170'
        wait.until.return_value.get_attribute.return_value = target
        with patch.object(selenium_driver, 'wait_document_ready'), patch.object(selenium_driver, 'safe_click') as click:
            self.assertEqual(selenium_driver.click_tab_safe(wait, driver, ['건축물대장']), '건축물대장')
            driver.get.assert_called_once_with(target)
            click.assert_not_called()

    def test_popup_javascript_resolves_exact_case(self):
        self.assertEqual(orchestrator._public_data_direct_url(
            'https://www.my-auction.co.kr/view3/1524170/user',
            "javascript:pop_detail('bu','1524170');", ''),
            'https://www.my-auction.co.kr/auction/auction_detail_view.php?type=bu&idx=1524170')

    def test_other_case_document_types_and_hosts_are_rejected(self):
        for href in ("javascript:pop_detail('rg','1524170');",
                     'https://example.com/auction/auction_detail_view.php?type=bu&idx=1524170',
                     'https://www.my-auction.co.kr/member/login.php'):
            self.assertEqual(orchestrator._public_data_direct_url('https://www.my-auction.co.kr/', href, ''), '')

    def test_main_detail_page_is_not_viewer_even_with_matching_element(self):
        driver = MagicMock()
        driver.current_url = 'https://www.my-auction.co.kr/view3/1524170/user'
        driver.find_elements.return_value = [object()]
        self.assertFalse(orchestrator._public_data_page_ready(driver))
        driver.current_url = 'https://www.my-auction.co.kr/auction/auction_detail_view.php?type=bu&idx=1524170'
        self.assertTrue(orchestrator._public_data_page_ready(driver))
        driver.find_elements.return_value = []
        self.assertFalse(orchestrator._public_data_page_ready(driver))

    def test_initial_property_display_can_have_tabs_without_an_iframe(self):
        driver = MagicMock()
        driver.current_url = 'https://www.my-auction.co.kr/auction/auction_detail_view.php?type=bu&idx=1524170'
        driver.find_elements.side_effect = [[], [object(), object()]]
        self.assertTrue(orchestrator._public_data_page_ready(driver))

    def test_popup_click_failure_is_bypassed_by_direct_verified_navigation(self):
        driver = MagicMock()
        driver.execute_script.return_value = {'href': "javascript:pop_detail('bu','1524170');"}
        driver.current_window_handle = 'original'
        with patch.object(orchestrator, 'wait_document_ready'), patch.object(orchestrator, 'WebDriverWait') as wait, patch.object(orchestrator, 'safe_click') as click:
            self.assertEqual(orchestrator._open_public_data_page(driver, object()), 'original')
            driver.get.assert_called_once_with('https://www.my-auction.co.kr/auction/auction_detail_view.php?type=bu&idx=1524170')
            wait.return_value.until.assert_called_once_with(orchestrator._public_data_page_ready)
            click.assert_not_called()

    def test_incomplete_ocr_is_not_reported_as_normal(self):
        soup = BeautifulSoup('<html></html>', 'html.parser')
        rc = briefing_rights.rc
        with patch.object(rc, 'extract_rights_context_by_ocr', return_value={'_incomplete': True}), patch.object(rc, 'extract_tenant_context_by_ocr', return_value={}), patch.object(rc, 'extract_status_survey_context_by_ocr', return_value={}), patch.object(rc, 'collect_case_document_text', return_value=''):
            result = briefing_rights.extract_context(soup, driver=MagicMock())
        self.assertTrue(any('등기 권리정보 원자료' in warning for warning in result['rights_extraction_warnings']))
        self.assertTrue(any('매각물건명세서·임차인 원자료' in warning for warning in result['rights_extraction_warnings']))

    def test_missing_viewer_fails_instead_of_accepting_main_page(self):
        driver = MagicMock()
        driver.execute_script.return_value = {'href': "javascript:pop_detail('bu','1524170');"}
        with patch.object(orchestrator, 'wait_document_ready'), patch.object(orchestrator, 'WebDriverWait') as wait:
            wait.return_value.until.side_effect = TimeoutException('viewer absent')
            with self.assertRaises(TimeoutException):
                orchestrator._open_public_data_page(driver, object())


if __name__ == '__main__':
    unittest.main()
