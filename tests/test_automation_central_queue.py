import sys
import threading
import time
import unittest
from pathlib import Path

BACKEND_PATH = Path(__file__).resolve().parents[1] / "automation-service" / "backend"
if str(BACKEND_PATH) not in sys.path:
    sys.path.insert(0, str(BACKEND_PATH))

from app.core.execution import AUTOMATION_EXECUTION_LOCK  # noqa: E402


class AutomationCentralQueueTests(unittest.TestCase):
    def test_execution_lock_serializes_legacy_and_central_workers(self):
        active = 0
        maximum = 0
        state_lock = threading.Lock()

        def run_once():
            nonlocal active, maximum
            with AUTOMATION_EXECUTION_LOCK:
                with state_lock:
                    active += 1
                    maximum = max(maximum, active)
                time.sleep(0.03)
                with state_lock:
                    active -= 1

        threads = [threading.Thread(target=run_once) for _ in range(3)]
        for thread in threads:
            thread.start()
        for thread in threads:
            thread.join()

        self.assertEqual(maximum, 1)


if __name__ == "__main__":
    unittest.main()
