import { useEffect, useState, useCallback, useRef, useLayoutEffect } from 'react';
import { api } from '../api';
import { useAuthStore } from '../store';
import type { User } from '../types';
import { ROLE_LABELS } from '../types';
import type { Role } from '../types';
import { Users, Plus, Trash2, Settings, UserMinus, Pencil } from 'lucide-react';

const STORAGE_KEY = 'myauction_org_tree';
const TIER_KEY = 'myauction_org_tiers';
const DEFAULT_TIERS = ['대표', '임원', '부서', '팀원', '스태프'];
const TIER_COLORS = ['#1a73e8', '#1a73e8', '#e65100', '#188038', '#7b1fa2'];
const TIER_BG = ['#e8f0fe', '#e8f0fe', '#fff3e0', '#e8f5e9', '#f3e5f5'];

const ROLE_COLORS: Record<Role, string> = {
  master: '#7b1fa2', ceo: '#1a73e8', admin: '#e65100', manager: '#188038', member: '#5f6368',
};

interface OrgNode {
  id: string;
  label: string;
  userId?: string;
  tier: number;       // 1~5 (스타일용)
  children: OrgNode[];
}

function genId() { return 'n' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6); }

function findNode(nodes: OrgNode[], id: string): OrgNode | null {
  for (const n of nodes) {
    if (n.id === id) return n;
    const f = findNode(n.children, id);
    if (f) return f;
  }
  return null;
}

function removeNode(nodes: OrgNode[], id: string): OrgNode[] {
  return nodes.filter((n) => n.id !== id).map((n) => ({ ...n, children: removeNode(n.children, id) }));
}

function getAllUserIds(nodes: OrgNode[]): string[] {
  const ids: string[] = [];
  for (const n of nodes) {
    if (n.userId) ids.push(n.userId);
    ids.push(...getAllUserIds(n.children));
  }
  return ids;
}

function isDescendant(node: OrgNode, targetId: string): boolean {
  if (node.id === targetId) return true;
  return node.children.some((c) => isDescendant(c, targetId));
}

interface LineCoord { x1: number; y1: number; x2: number; y2: number; }

export default function OrgChart() {
  useAuthStore();
  const [users, setUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);
  const [tree, setTree] = useState<OrgNode[]>([]);
  const [tiers, setTiers] = useState<string[]>(DEFAULT_TIERS);
  const [poolSearch, setPoolSearch] = useState('');
  const [addingTo, setAddingTo] = useState<string | null>(null); // node id or 'root'
  const [addLabel, setAddLabel] = useState('');
  const [addUserId, setAddUserId] = useState('');
  const [addTier, setAddTier] = useState(1);
  const [editingTiers, setEditingTiers] = useState(false);
  const [editTiers, setEditTiers] = useState<string[]>([]);
  const [dragNodeId, setDragNodeId] = useState<string | null>(null);
  const [dropTargetId, setDropTargetId] = useState<string | null>(null);
  const [lines, setLines] = useState<LineCoord[]>([]);
  const [scale, setScale] = useState(1);
  const treeRef = useRef<HTMLDivElement>(null);
  const pyramidRef = useRef<HTMLDivElement>(null);

  const load = useCallback(async () => {
    const uRes = await api.users.list();
    setUsers(uRes.users);
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) setTree(JSON.parse(raw));
      const tr = localStorage.getItem(TIER_KEY);
      if (tr) setTiers(JSON.parse(tr));
    } catch { /* */ }
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  const save = (t: OrgNode[]) => { setTree(t); localStorage.setItem(STORAGE_KEY, JSON.stringify(t)); };
  const saveTiers = (t: string[]) => { setTiers(t); localStorage.setItem(TIER_KEY, JSON.stringify(t)); };

  // 연결선 계산
  const calcLines = useCallback(() => {
    if (!treeRef.current) return;
    const ct = treeRef.current;
    const rect = ct.getBoundingClientRect();
    const sl = ct.scrollLeft, st = ct.scrollTop;
    const result: LineCoord[] = [];

    ct.querySelectorAll('[data-oc-id]').forEach((el) => {
      const pid = el.getAttribute('data-oc-id')!;
      const kids = ct.querySelectorAll(`[data-oc-parent="${pid}"]`);
      if (kids.length === 0) return;
      const pr = el.getBoundingClientRect();
      const px = pr.left + pr.width / 2 - rect.left + sl;
      const py = pr.bottom - rect.top + st;

      kids.forEach((cel) => {
        const cr = cel.getBoundingClientRect();
        const cx = cr.left + cr.width / 2 - rect.left + sl;
        const cy = cr.top - rect.top + st;
        result.push({ x1: px, y1: py, x2: cx, y2: cy });
      });
    });
    setLines(result);
  }, []);

  const autoScale = useCallback(() => {
    if (!treeRef.current || !pyramidRef.current) return;
    // 먼저 스케일 1로 리셋하여 실제 크기 측정
    pyramidRef.current.style.transform = 'scale(1)';
    const containerW = treeRef.current.clientWidth - 48; // padding 제외
    const contentW = pyramidRef.current.scrollWidth;
    const newScale = contentW > containerW ? Math.max(containerW / contentW, 0.45) : 1;
    setScale(newScale);
    pyramidRef.current.style.transform = `scale(${newScale})`;
    // 스케일 적용 후 연결선 재계산
    setTimeout(calcLines, 30);
  }, [calcLines]);

  useLayoutEffect(() => { const t = setTimeout(autoScale, 80); return () => clearTimeout(t); }, [tree, autoScale]);
  useEffect(() => { window.addEventListener('resize', autoScale); return () => window.removeEventListener('resize', autoScale); }, [autoScale]);

  const usedIds = getAllUserIds(tree);
  const poolUsers = users.filter((u) => u.role !== 'master' && !usedIds.includes(u.id));
  const filteredPool = poolUsers.filter((u) =>
    u.name.includes(poolSearch) || u.email.includes(poolSearch) ||
    (u.department || '').includes(poolSearch) || (u.position_title || '').includes(poolSearch)
  );
  const getUserById = (id: string) => users.find((u) => u.id === id);

  // 추가
  const handleAdd = () => {
    if (!addLabel.trim()) { alert('이름/직책을 입력하세요.'); return; }
    const node: OrgNode = { id: genId(), label: addLabel.trim(), userId: addUserId || undefined, tier: addTier, children: [] };
    if (addingTo === 'root') {
      save([...tree, node]);
    } else {
      const updated = JSON.parse(JSON.stringify(tree)) as OrgNode[];
      const parent = findNode(updated, addingTo!);
      if (parent) {
        node.tier = Math.min(parent.tier + 1, 5);
        parent.children.push(node);
      }
      save(updated);
    }
    setAddLabel(''); setAddUserId(''); setAddingTo(null);
  };

  // 인원 비우기 (노드는 유지, userId만 제거)
  const handleUnassign = (id: string) => {
    const updated = JSON.parse(JSON.stringify(tree)) as OrgNode[];
    const node = findNode(updated, id);
    if (!node || !node.userId) return;
    const u = getUserById(node.userId);
    if (!confirm(`"${node.label}"에서 ${u?.name || '인원'}을 비우시겠습니까? (자리는 유지)`) ) return;
    // label에서 이름 부분 제거
    node.label = node.label.replace(/ — .+$/, '');
    node.userId = undefined;
    save(updated);
  };

  const handleDelete = (id: string) => {
    const node = findNode(tree, id);
    if (!node) return;
    const msg = node.children.length > 0 ? `"${node.label}" 및 하위 항목 전체를 삭제하시겠습니까?` : `"${node.label}"을(를) 삭제하시겠습니까?`;
    if (!confirm(msg)) return;
    save(removeNode(tree, id));
  };

  // 드래그 → 부모 변경
  const handleDrop = (targetId: string | null, e: React.DragEvent) => {
    e.preventDefault(); e.stopPropagation();
    const nodeId = e.dataTransfer.getData('text/node');
    const userId = e.dataTransfer.getData('text/user');

    if (nodeId) {
      if (nodeId === targetId) { reset(); return; }
      const drag = findNode(tree, nodeId);
      if (drag && targetId && isDescendant(drag, targetId)) { reset(); return; }

      const stripped = removeNode(JSON.parse(JSON.stringify(tree)), nodeId);
      const orig = findNode(JSON.parse(JSON.stringify(tree)), nodeId)!;

      if (!targetId) {
        orig.tier = 1;
        stripped.push(orig);
      } else {
        const parent = findNode(stripped, targetId);
        if (parent) { orig.tier = Math.min(parent.tier + 1, 5); parent.children.push(orig); }
      }
      save(stripped);
    } else if (userId) {
      const u = getUserById(userId);
      if (!u) { reset(); return; }
      const updated = JSON.parse(JSON.stringify(tree)) as OrgNode[];

      if (!targetId) {
        // 빈 영역에 드롭 → 최상위 노드 생성
        const label = `${u.name} ${u.position_title || ROLE_LABELS[u.role]}`;
        updated.push({ id: genId(), label, userId: u.id, tier: 1, children: [] });
      } else {
        const target = findNode(updated, targetId);
        if (target && !target.userId) {
          // 빈 자리(userId 없음)에 드롭 → 그 자리에 채워넣기
          target.userId = u.id;
          target.label = `${target.label} — ${u.name}`;
        } else if (target) {
          // 이미 인원이 있는 노드 → 하위로 추가
          const label = `${u.name} ${u.position_title || ROLE_LABELS[u.role]}`;
          target.children.push({ id: genId(), label, userId: u.id, tier: Math.min(target.tier + 1, 5), children: [] });
        }
      }
      save(updated);
    }
    reset();
  };

  const reset = () => { setDragNodeId(null); setDropTargetId(null); };

  // 노드 라벨 수정
  const [editingNodeId, setEditingNodeId] = useState<string | null>(null);
  const [editNodeLabel, setEditNodeLabel] = useState('');

  const startEditNode = (id: string, label: string) => {
    setEditingNodeId(id);
    setEditNodeLabel(label);
  };

  const saveEditNode = () => {
    if (!editingNodeId || !editNodeLabel.trim()) { setEditingNodeId(null); return; }
    const updated = JSON.parse(JSON.stringify(tree)) as OrgNode[];
    const node = findNode(updated, editingNodeId);
    if (node) node.label = editNodeLabel.trim();
    save(updated);
    setEditingNodeId(null);
  };

  // 등급명 편집
  const startEditTiers = () => { setEditTiers([...tiers]); setEditingTiers(true); };
  const saveEditTiers = () => { saveTiers(editTiers); setEditingTiers(false); };

  // 노드 렌더 (재귀 피라미드)
  const renderNode = (node: OrgNode, parentId?: string): React.ReactNode => {
    const u = node.userId ? getUserById(node.userId) : null;
    const tierIdx = Math.max(0, Math.min(node.tier - 1, 4));
    const color = TIER_COLORS[tierIdx];
    const bg = TIER_BG[tierIdx];
    const isDragging = dragNodeId === node.id;
    const isDropOver = dropTargetId === node.id;

    return (
      <div key={node.id} className="oc-branch">
        <div className="oc-card-wrap">
          {/* 노드 이름 — 카드 위 (클릭하여 편집) */}
          {editingNodeId === node.id ? (
            <input
              className="oc-card-tier-edit"
              value={editNodeLabel}
              onChange={(e) => setEditNodeLabel(e.target.value)}
              onBlur={saveEditNode}
              onKeyDown={(e) => { if (e.key === 'Enter') saveEditNode(); if (e.key === 'Escape') setEditingNodeId(null); }}
              autoFocus
              onClick={(e) => e.stopPropagation()}
            />
          ) : (
            <div className="oc-card-tier-label" onClick={(e) => { e.stopPropagation(); startEditNode(node.id, node.label); }}>
              {node.label} <Pencil size={8} className="oc-edit-icon" />
            </div>
          )}
          {/* 노드 카드 */}
          <div
            className={`oc-card ${isDragging ? 'oc-card-dragging' : ''} ${isDropOver ? 'oc-card-drop' : ''} ${u ? '' : 'oc-card-dept'}`}
            style={{ borderColor: color, background: u ? '#fff' : bg }}
            data-oc-id={node.id}
            data-oc-parent={parentId || ''}
            draggable
            onDragStart={(e) => { e.dataTransfer.setData('text/node', node.id); e.dataTransfer.effectAllowed = 'move'; setDragNodeId(node.id); }}
            onDragEnd={reset}
            onDragOver={(e) => { e.preventDefault(); e.stopPropagation(); setDropTargetId(node.id); }}
            onDragLeave={(e) => { e.stopPropagation(); if (dropTargetId === node.id) setDropTargetId(null); }}
            onDrop={(e) => handleDrop(node.id, e)}
          >
            {u ? (
              <div className="oc-card-avatar" style={{ background: (ROLE_COLORS[u.role] || color) + '20', color: ROLE_COLORS[u.role] || color }}>{u.name.charAt(0)}</div>
            ) : (
              <div className="oc-card-empty-avatar" style={{ borderColor: color }}>?</div>
            )}
            <div className="oc-card-body">
              {u ? (
                <>
                  <div className="oc-card-name">{u.name}</div>
                  <div className="oc-card-pos">{u.position_title || ROLE_LABELS[u.role]}</div>
                </>
              ) : (
                <div className="oc-card-hint">드래그 배치</div>
              )}
            </div>
            <div className="oc-card-actions">
              <button className="oc-card-btn" title="하위 추가" onClick={(e) => { e.stopPropagation(); setAddingTo(node.id); setAddLabel(''); setAddUserId(''); setAddTier(Math.min(node.tier + 1, 5)); }}>
                <Plus size={9} />
              </button>
              {u && (
                <button className="oc-card-btn" title="인원 비우기" onClick={(e) => { e.stopPropagation(); handleUnassign(node.id); }}>
                  <UserMinus size={9} />
                </button>
              )}
              <button className="oc-card-btn oc-card-btn-del" title="삭제" onClick={(e) => { e.stopPropagation(); handleDelete(node.id); }}>
                <Trash2 size={9} />
              </button>
            </div>
          </div>
        </div>

        {/* 추가 폼 (이 노드 하위) */}
        {addingTo === node.id && (
          <div className="oc-inline-add" onClick={(e) => e.stopPropagation()}>
            <input className="oc-add-input" value={addLabel} onChange={(e) => setAddLabel(e.target.value)}
              placeholder="직책/부서명 (예: 경매1팀)" autoFocus onKeyDown={(e) => e.key === 'Enter' && handleAdd()} />
            <button className="btn btn-sm btn-primary" onClick={handleAdd}>추가</button>
            <button className="btn btn-sm" onClick={() => setAddingTo(null)}>취소</button>
          </div>
        )}

        {/* 자식 — 가로 배치 */}
        {node.children.length > 0 && (
          <div className={`oc-kids ${node.children.every((c) => c.children.length === 0 && c.userId) ? 'oc-kids-col' : ''}`}>
            {node.children.map((child) => renderNode(child, node.id))}
          </div>
        )}
      </div>
    );
  };

  if (loading) return <div className="page-loading">로딩중...</div>;

  return (
    <div className="page org-chart-page">
      <div className="page-header" style={{ marginBottom: 8 }}>
        <h2><Users size={20} style={{ marginRight: 6, verticalAlign: 'middle' }} />조직도</h2>
        <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
          <button className="btn btn-sm" onClick={startEditTiers}><Settings size={13} /> 등급 설정</button>
          {addingTo === 'root' ? (
            <div className="oc-add-form">
              <input className="oc-add-input" value={addLabel} onChange={(e) => setAddLabel(e.target.value)}
                placeholder="직책/부서명 (예: 대표이사)" autoFocus onKeyDown={(e) => e.key === 'Enter' && handleAdd()} />
              <button className="btn btn-sm btn-primary" onClick={handleAdd}>추가</button>
              <button className="btn btn-sm" onClick={() => setAddingTo(null)}>취소</button>
            </div>
          ) : (
            <button className="btn btn-sm btn-primary" onClick={() => { setAddingTo('root'); setAddLabel(''); setAddUserId(''); setAddTier(1); }}>
              <Plus size={13} /> 조직 추가
            </button>
          )}
        </div>
      </div>

      {/* 등급명 편집 */}
      {editingTiers && (
        <div className="modal-overlay" onClick={() => setEditingTiers(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 320 }}>
            <h3>등급 이름 설정</h3>
            {editTiers.map((t, i) => (
              <div key={i} className="form-group" style={{ marginBottom: 8 }}>
                <label style={{ fontSize: '0.75rem', color: TIER_COLORS[i] }}>{i + 1}단계</label>
                <input value={t} onChange={(e) => { const a = [...editTiers]; a[i] = e.target.value; setEditTiers(a); }} />
              </div>
            ))}
            <div className="modal-actions">
              <button className="btn" onClick={() => setEditingTiers(false)}>취소</button>
              <button className="btn btn-primary" onClick={saveEditTiers}>저장</button>
            </div>
          </div>
        </div>
      )}

      <div className="oc-layout">
        {/* 조직도 */}
        <div className="oc-tree" ref={treeRef}
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => handleDrop(null, e)}
        >
          <svg className="oc-lines">
            <defs>
              <linearGradient id="oc-line-grad" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#e8a838" stopOpacity="0.8" />
                <stop offset="100%" stopColor="#e8a838" stopOpacity="0.3" />
              </linearGradient>
            </defs>
            {lines.map((l, i) => {
              const midY = (l.y1 + l.y2) / 2;
              return <path key={i} d={`M${l.x1},${l.y1} L${l.x1},${midY} L${l.x2},${midY} L${l.x2},${l.y2}`}
                fill="none" stroke="url(#oc-line-grad)" strokeWidth="2" strokeLinejoin="round" />;
            })}
          </svg>

          {tree.length === 0 && (
            <div className="empty-state" style={{ padding: 40, fontSize: '0.8rem' }}>
              "조직 추가" 버튼으로 최상위(대표)부터 구성하세요.<br />
              각 노드의 + 버튼으로 하위 조직을 추가합니다.
            </div>
          )}

          <div className="oc-pyramid" ref={pyramidRef} style={{ transform: `scale(${scale})` }}>
            {tree.length === 1 ? (
              renderNode(tree[0])
            ) : (
              <div className="oc-kids">
                {tree.map((node) => renderNode(node))}
              </div>
            )}
          </div>
        </div>

        {/* 우측 풀 */}
        <div className="oc-pool">
          <div className="oc-pool-hd"><span>미배치 인원 <b>{poolUsers.length}</b></span></div>
          <input className="oc-pool-search" placeholder="검색..." value={poolSearch} onChange={(e) => setPoolSearch(e.target.value)} />
          <div className="oc-pool-list">
            {filteredPool.length === 0 && <div className="empty-state" style={{ fontSize: '0.72rem', padding: 12 }}>없음</div>}
            {filteredPool.map((u) => {
              const c = ROLE_COLORS[u.role];
              return (
                <div key={u.id} className="oc-chip" draggable
                  onDragStart={(e) => { e.dataTransfer.setData('text/user', u.id); e.dataTransfer.effectAllowed = 'move'; }}>
                  <span className="oc-chip-dot" style={{ background: c }} />
                  <span className="oc-chip-name">{u.name}</span>
                  <span className="oc-chip-title">{u.position_title || ROLE_LABELS[u.role]}</span>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
