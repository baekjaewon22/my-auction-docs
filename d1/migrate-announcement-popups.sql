CREATE TABLE IF NOT EXISTS announcement_popups (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  content TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 1,
  start_at TEXT,
  end_at TEXT,
  dismiss_days INTEGER NOT NULL DEFAULT 7,
  created_by TEXT,
  updated_by TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now', '+9 hours')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now', '+9 hours'))
);

CREATE INDEX IF NOT EXISTS idx_announcement_popups_active
ON announcement_popups(enabled, start_at, end_at);

INSERT OR IGNORE INTO announcement_popups (
  id,
  title,
  content,
  enabled,
  start_at,
  end_at,
  dismiss_days,
  created_by,
  updated_by
) VALUES (
  'template-change-myungseung-20260703',
  '브리핑 자료 및 권리분석보증서 템플릿 변경 안내',
  '법무법인 명승으로 변경됨에 따라 브리핑 자료 및 권리분석보증서 템플릿이 변경되었습니다.

현재 작성 중인 자료가 있는 경우에는 기존 템플릿을 그대로 사용해 주시고,
다음 주부터 제출되는 자료는 변경된 템플릿을 사용해 주시기 바랍니다.

변경된 자료는
마이옥션 오피스 > 사내 커뮤니티 > 자료실에서 다운로드하실 수 있습니다.

또한 계약서 등 관련 서류는 이폼사인에 변경 사항 반영이 완료되었습니다.',
  1,
  date('now', '+9 hours'),
  NULL,
  7,
  'system',
  'system'
);
