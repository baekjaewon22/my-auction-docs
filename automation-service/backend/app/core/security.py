# -*- coding: utf-8 -*-
"""Security boundary for the loopback automation agent."""

from __future__ import annotations

import json
import secrets
import urllib.error
import urllib.request
from typing import Callable

from .config import settings


AGENT_SESSION_TOKEN = secrets.token_urlsafe(32)


def is_allowed_origin(origin: str | None) -> bool:
    return bool(origin and origin in settings.cors_origins)


def is_valid_agent_token(token: str | None) -> bool:
    return bool(token and secrets.compare_digest(token, AGENT_SESSION_TOKEN))


def fetch_trusted_profile(
    authorization: str | None,
    opener: Callable[..., object] = urllib.request.urlopen,
) -> dict:
    auth = str(authorization or '').strip()
    if not auth.lower().startswith('bearer '):
        raise PermissionError('업무시스템 로그인이 필요합니다.')

    request = urllib.request.Request(
        settings.authorization_profile_url,
        headers={
            'Authorization': auth,
            'Accept': 'application/json',
            'User-Agent': 'MyAuctionAutomationAgent',
        },
        method='GET',
    )
    try:
        with opener(request, timeout=10) as response:
            status = int(getattr(response, 'status', 200))
            payload = json.loads(response.read().decode('utf-8'))
    except urllib.error.HTTPError as exc:
        if exc.code in (401, 403):
            raise PermissionError('업무자동화 사용 권한을 확인할 수 없습니다.') from exc
        raise ConnectionError('업무시스템에서 사용자 권한을 확인하지 못했습니다.') from exc
    except (urllib.error.URLError, TimeoutError, OSError, ValueError, json.JSONDecodeError) as exc:
        raise ConnectionError('업무시스템에서 사용자 권한을 확인하지 못했습니다.') from exc

    if status != 200 or not isinstance(payload, dict):
        raise PermissionError('업무자동화 사용 권한을 확인할 수 없습니다.')

    required = ('myauction_id', 'myauction_pw', 'author_name', 'requester_role', 'requester_permission')
    if any(key not in payload for key in required):
        raise PermissionError('업무시스템 사용자 정보가 올바르지 않습니다.')
    return payload
