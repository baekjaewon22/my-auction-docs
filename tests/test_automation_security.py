import asyncio
import json
import sys
import unittest
from pathlib import Path

BACKEND_PATH = Path(__file__).resolve().parents[1] / "automation-service" / "backend"
if str(BACKEND_PATH) not in sys.path:
    sys.path.insert(0, str(BACKEND_PATH))

from app.core.security import (  # noqa: E402
    AGENT_SESSION_TOKEN,
    fetch_trusted_profile,
    is_allowed_origin,
    is_valid_agent_token,
)
from app.api.routes import _require_agent_token  # noqa: E402
from fastapi import HTTPException, WebSocketException  # noqa: E402


class FakeResponse:
    status = 200

    def __init__(self, payload):
        self.payload = payload

    def __enter__(self):
        return self

    def __exit__(self, *_args):
        return False

    def read(self):
        return json.dumps(self.payload).encode("utf-8")


class AutomationSecurityTests(unittest.TestCase):
    def test_only_explicit_business_origins_are_allowed(self):
        self.assertTrue(is_allowed_origin("https://my-docs.kr"))
        self.assertTrue(is_allowed_origin("http://127.0.0.1:5173"))
        self.assertFalse(is_allowed_origin("https://evil.example"))
        self.assertFalse(is_allowed_origin(None))

    def test_agent_token_is_required_and_exact(self):
        self.assertTrue(is_valid_agent_token(AGENT_SESSION_TOKEN))
        self.assertFalse(is_valid_agent_token(""))
        self.assertFalse(is_valid_agent_token("forged-token"))

    def test_cloud_profile_replaces_client_claimed_role(self):
        trusted = {
            "myauction_id": "trusted-id",
            "myauction_pw": "trusted-password",
            "author_name": "승인 사용자",
            "author_title": "담당자",
            "author_phone": "010-0000-0000",
            "requester_role": "member",
            "requester_permission": "special",
        }
        captured = {}

        def opener(request, timeout):
            captured["authorization"] = request.headers.get("Authorization")
            captured["timeout"] = timeout
            return FakeResponse(trusted)

        profile = fetch_trusted_profile("Bearer valid-user-token", opener=opener)
        self.assertEqual(profile, trusted)
        self.assertEqual(captured["authorization"], "Bearer valid-user-token")
        self.assertEqual(captured["timeout"], 10)

    def test_cloud_profile_rejects_missing_user_token(self):
        with self.assertRaises(PermissionError):
            fetch_trusted_profile(None)

    def test_invalid_http_token_raises_http_exception(self):
        connection = type("Connection", (), {
            "headers": {},
            "query_params": {},
            "scope": {"type": "http"},
        })()
        with self.assertRaises(HTTPException) as raised:
            asyncio.run(_require_agent_token(connection))
        self.assertEqual(raised.exception.status_code, 401)

    def test_invalid_websocket_token_closes_with_policy_violation(self):
        connection = type("Connection", (), {
            "headers": {},
            "query_params": {},
            "scope": {"type": "websocket"},
        })()
        with self.assertRaises(WebSocketException) as raised:
            asyncio.run(_require_agent_token(connection))
        self.assertEqual(raised.exception.code, 1008)


if __name__ == "__main__":
    unittest.main()
