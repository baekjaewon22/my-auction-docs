-- 조직도 노드 (localStorage → DB)
CREATE TABLE IF NOT EXISTS org_nodes (
  id TEXT PRIMARY KEY,
  label TEXT NOT NULL,
  user_id TEXT,
  parent_id TEXT,
  tier INTEGER NOT NULL DEFAULT 1,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL,
  FOREIGN KEY (parent_id) REFERENCES org_nodes(id) ON DELETE CASCADE
);

-- CC 승인자 설정 (지사장/본부장 등 최상위급의 결재 대상)
CREATE TABLE IF NOT EXISTS approval_cc (
  id TEXT PRIMARY KEY,
  cc_user_id TEXT NOT NULL,
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (cc_user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (created_by) REFERENCES users(id)
);

-- 문서별 결재선 단계
CREATE TABLE IF NOT EXISTS approval_steps (
  id TEXT PRIMARY KEY,
  document_id TEXT NOT NULL,
  step_order INTEGER NOT NULL,
  approver_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
  comment TEXT,
  signed_at TEXT,
  FOREIGN KEY (document_id) REFERENCES documents(id) ON DELETE CASCADE,
  FOREIGN KEY (approver_id) REFERENCES users(id)
);

CREATE INDEX IF NOT EXISTS idx_org_nodes_user ON org_nodes(user_id);
CREATE INDEX IF NOT EXISTS idx_org_nodes_parent ON org_nodes(parent_id);
CREATE INDEX IF NOT EXISTS idx_approval_steps_document ON approval_steps(document_id);
CREATE INDEX IF NOT EXISTS idx_approval_steps_approver ON approval_steps(approver_id);
