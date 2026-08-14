"""Process-wide execution gate for Selenium/PPT automation.

The current engine still contains shared capture paths, so every entry point must
use this lock until all generators use task-scoped workspaces.
"""

import threading


AUTOMATION_EXECUTION_LOCK = threading.Lock()
