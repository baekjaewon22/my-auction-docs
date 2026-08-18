import sys
import threading
import time
import unittest
from pathlib import Path
from unittest.mock import Mock

import requests

BACKEND_PATH = Path(__file__).resolve().parents[1] / "automation-service" / "backend"
if str(BACKEND_PATH) not in sys.path:
    sys.path.insert(0, str(BACKEND_PATH))

from app.core.execution import AUTOMATION_EXECUTION_LOCK  # noqa: E402
from app.services.central_queue_worker import CentralQueueWorker, _retry_after_seconds  # noqa: E402


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

    def test_idle_claim_does_not_send_a_redundant_heartbeat(self):
        worker = CentralQueueWorker.__new__(CentralQueueWorker)
        worker.agent_id = "office-automation-01"
        worker.display_name = "Office automation server #1"
        worker.version = "test"
        worker.poll_seconds = 5
        worker.stop_event = Mock()
        worker.stop_event.is_set.side_effect = [False, True]
        worker.stop_event.wait.return_value = True
        worker._post = Mock(return_value={"job": None})

        worker.run_forever()

        worker._post.assert_called_once_with("/jobs/claim", {
            "agent_id": worker.agent_id,
            "display_name": worker.display_name,
            "version": worker.version,
        })
        worker.stop_event.wait.assert_called_once_with(5)

    def test_retry_after_seconds_reads_rate_limit_header(self):
        response = requests.Response()
        response.status_code = 429
        response.headers["Retry-After"] = "17"
        error = requests.HTTPError(response=response)

        self.assertEqual(_retry_after_seconds(error), 17)

    def test_rate_limit_waits_for_retry_after(self):
        worker = CentralQueueWorker.__new__(CentralQueueWorker)
        worker.agent_id = "office-automation-01"
        worker.display_name = "Office automation server #1"
        worker.version = "test"
        worker.poll_seconds = 5
        worker.stop_event = Mock()
        worker.stop_event.is_set.side_effect = [False, True]
        response = requests.Response()
        response.status_code = 429
        response.headers["Retry-After"] = "17"
        worker._post = Mock(side_effect=requests.HTTPError(response=response))

        worker.run_forever()

        worker.stop_event.wait.assert_called_once_with(17)


if __name__ == "__main__":
    unittest.main()
