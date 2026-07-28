import importlib.util
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch


MODULE_PATH = Path(__file__).resolve().parents[1] / "automation-service" / "installer" / "setup_agent.py"
SPEC = importlib.util.spec_from_file_location("setup_agent", MODULE_PATH)
assert SPEC and SPEC.loader
setup_agent = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(setup_agent)


class AutomationInstallerTests(unittest.TestCase):
    def test_watchdog_prevents_duplicate_instances(self):
        with tempfile.TemporaryDirectory() as temp:
            runner = setup_agent.write_startup_runner(Path(temp))
            content = runner.read_text(encoding="utf-8")
            self.assertIn("MyAuctionAutomationAgentWatchdog", content)
            self.assertIn("if (-not $createdNew)", content)

    def test_desktop_launcher_repairs_startup_and_checks_health(self):
        with tempfile.TemporaryDirectory() as temp:
            launcher = setup_agent.write_manual_launcher(Path(temp))
            content = launcher.read_text(encoding="utf-8")
            self.assertIn("http://127.0.0.1:8001/api/health", content)
            self.assertIn("Set-ItemProperty", content)
            self.assertIn("Start-ScheduledTask", content)
            self.assertIn("Start-MyAuctionAutomationAgent.ps1", content)

    def test_installer_creates_desktop_and_startup_shortcuts(self):
        source = MODULE_PATH.read_text(encoding="utf-8")
        self.assertIn("GetFolderPath('Desktop')", source)
        self.assertIn("GetFolderPath('Startup')", source)
        self.assertIn("마이실행기.lnk", source)
        self.assertIn("마이실행기 자동시작.lnk", source)
        self.assertIn("마이옥션 업무자동화 실행기.lnk", source)

    def test_slow_start_is_reported_as_warning_after_successful_install(self):
        self.assertIn("Installation/update completed", setup_agent.installation_result_message(False))
        self.assertIn("desktop launcher", setup_agent.installation_result_message(False))
        self.assertEqual(setup_agent.wait_for_agent_health.__defaults__, (60.0,))
        source = MODULE_PATH.read_text(encoding="utf-8")
        self.assertNotIn('raise RuntimeError("The agent was installed but did not start', source)

    def test_locked_old_directory_falls_back_to_in_place_update(self):
        source = MODULE_PATH.read_text(encoding="utf-8")
        self.assertIn("continuing with an in-place update", source)
        self.assertNotIn("Old installation could not be removed", source)

    def test_old_and_duplicate_installer_names_are_cleanup_targets(self):
        with tempfile.TemporaryDirectory() as temp:
            home = Path(temp)
            downloads = home / "Downloads"
            desktop = home / "Desktop"
            downloads.mkdir()
            desktop.mkdir()
            expected = [
                downloads / "MyAuctionAutomationAgentSetup.exe",
                downloads / "MyAuctionAutomationAgentSetup (2).exe",
                downloads / "MyAuctionRunnerSetup.exe",
                downloads / "MyAuctionRunnerSetup (3).exe",
                desktop / "마이실행기.exe",
                desktop / "마이실행기 (1).exe",
            ]
            for path in expected:
                path.write_bytes(b"setup")
            (downloads / "unrelated.exe").write_bytes(b"keep")

            candidates = setup_agent.downloaded_installer_candidates(home)

            self.assertEqual(set(candidates), set(expected))

    def test_health_check_requires_the_exact_bundled_version(self):
        class Response:
            status = 200

            def __init__(self, version):
                self.version = version

            def __enter__(self):
                return self

            def __exit__(self, *_args):
                return False

            def read(self):
                return ('{"version":"' + self.version + '"}').encode()

        with patch.object(setup_agent.urllib.request, "urlopen", return_value=Response("2026.07.28.1")):
            self.assertTrue(setup_agent.wait_for_agent_health("2026.07.28.1", timeout_seconds=0.1))
        with patch.object(setup_agent.urllib.request, "urlopen", return_value=Response("2026.07.21.1")):
            self.assertFalse(setup_agent.wait_for_agent_health("2026.07.28.1", timeout_seconds=0.01))


if __name__ == "__main__":
    unittest.main()
