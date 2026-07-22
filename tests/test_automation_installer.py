import importlib.util
import tempfile
import unittest
from pathlib import Path


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
        self.assertIn("마이옥션 업무자동화 자동시작.lnk", source)


if __name__ == "__main__":
    unittest.main()
