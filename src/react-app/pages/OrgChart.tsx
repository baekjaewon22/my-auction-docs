import { useEffect, useState, useCallback, useRef } from 'react';
import { api } from '../api';
import { useAuthStore } from '../store';
import type { User, ApprovalCC } from '../types';
import { ROLE_LABELS } from '../types';
import { useBranches } from '../hooks/useBranches';
import type { Role } from '../types';
import { Users, Plus, Trash2, Settings, UserMinus, Pencil, Shield, ChevronRight, ChevronDown } from 'lucide-react';
import Select from '../components/Select';
import { useDepartments } from '../hooks/useDepartments';

const STORAGE_KEY = 'myauction_org_tree';
const TIER_KEY = 'myauction_org_tiers';
const DEFAULT_TIERS = ['대표', '임원', '부서', '팀원', '스태프'];
const TIER_COLORS = ['#1a73e8', '#1a73e8', '#e65100', '#188038', '#7b1fa2'];
const TIER_BG = ['#e8f0fe', '#e8f0fe', '#fff3e0', '#e8f5e9', '#f3e5f5'];

const ROLE_COLORS: Record<Role, string> = {
  master: '#7b1fa2', ceo: '#1a73e8', cc_ref: '#1a73e8', admin: '#e65100', director: '#0d47a1', accountant: '#283593', accountant_asst: '#00695c', manager: '#188038', member: '#5f6368', resigned: '#bdc1c6',
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

// 트리 → flat 변환 (DB 저장용)
function treeToFlat(nodes: OrgNode[], parentId?: string): { id: string; label: string; user_id?: string; parent_id?: string; tier: number; sort_order: number }[] {
  const result: { id: string; label: string; user_id?: string; parent_id?: string; tier: number; sort_order: number }[] = [];
  nodes.forEach((n, i) => {
    result.push({ id: n.id, label: n.label, user_id: n.userId, parent_id: parentId, tier: n.tier, sort_order: i });
    result.push(...treeToFlat(n.children, n.id));
  });
  return result;
}

// flat → 트리 변환 (DB 로드용)
function flatToTree(flat: { id: string; label: string; user_id: string | null; parent_id: string | null; tier: number; sort_order: number }[]): OrgNode[] {
  const map = new Map<string, OrgNode>();
  const roots: OrgNode[] = [];

  // 모든 노드를 먼저 생성
  for (const f of flat) {
    map.set(f.id, { id: f.id, label: f.label, userId: f.user_id || undefined, tier: f.tier, children: [] });
  }

  // 부모-자식 연결
  const sorted = [...flat].sort((a, b) => a.sort_order - b.sort_order);
  for (const f of sorted) {
    const node = map.get(f.id)!;
    if (f.parent_id && map.has(f.parent_id)) {
      map.get(f.parent_id)!.children.push(node);
    } else {
      roots.push(node);
    }
  }

  return roots;
}

export default function OrgChart() {
  const { user: currentUser } = useAuthStore();
  const { branches: branchList } = useBranches();
  const BRANCH_OPTS = branchList.map(b => ({ value: b, label: b }));
  const { departments: deptList } = useDepartments();
  const DEPT_OPTS = deptList.map(d => ({ value: d, label: d }));
  const [users, setUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);
  const [tree, setTree] = useState<OrgNode[]>([]);
  const [tiers, setTiers] = useState<string[]>(DEFAULT_TIERS);
  const [poolSearch, setPoolSearch] = useState('');
  const [addingTo, setAddingTo] = useState<string | null>(null);
  const [addLabel, setAddLabel] = useState('');
  const [addUserId, setAddUserId] = useState('');
  const [addTier, setAddTier] = useState(1);
  const [addType, setAddType] = useState<'branch' | 'dept' | 'free'>('free');
  const [editingTiers, setEditingTiers] = useState(false);
  const [editTiers, setEditTiers] = useState<string[]>([]);
  const [dragNodeId, setDragNodeId] = useState<string | null>(null);
  const [dropTargetId, setDropTargetId] = useState<string | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [isMobile, setIsMobile] = useState(window.innerWidth <= 768);
  const [collapsedNodes, setCollapsedNodes] = useState<Set<string>>(new Set());
  const treeRef = useRef<HTMLDivElement>(null);
  const pyramidRef = useRef<HTMLDivElement>(null);

  // CC 상태
  const [ccList, setCcList] = useState<(ApprovalCC & { cc_user_name: string; cc_user_email: string })[]>([]);
  const [showCcModal, setShowCcModal] = useState(false);
  const [ccSearch, setCcSearch] = useState('');

  const canEdit = currentUser && ['master', 'ceo', 'cc_ref', 'admin'].includes(currentUser.role);

  const load = useCallback(async () => {
    const uRes = await api.users.list();
    setUsers(uRes.users);

    // DB에서 조직도 로드 시도
    try {
      const orgRes = await api.org.list();
      if (orgRes.nodes && orgRes.nodes.length > 0) {
        setTree(flatToTree(orgRes.nodes));
      } else {
        // DB에 없으면 localStorage fallback
        const raw = localStorage.getItem(STORAGE_KEY);
        if (raw) setTree(JSON.parse(raw));
      }
    } catch {
      // API 실패 시 localStorage fallback
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) setTree(JSON.parse(raw));
    }

    try {
      const tr = localStorage.getItem(TIER_KEY);
      if (tr) setTiers(JSON.parse(tr));
    } catch { /* */ }

    // CC 목록 로드
    try {
      const ccRes = await api.org.ccList();
      setCcList(ccRes.ccList || []);
    } catch { /* */ }

    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  // 저장: localStorage + DB 동기화
  const save = async (t: OrgNode[]) => {
    setTree(t);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(t));

    // DB 동기화 (admin 이상)
    if (canEdit) {
      setSyncing(true);
      try {
        await api.org.sync(treeToFlat(t));
      } catch (e) {
        console.error('조직도 DB 동기화 실패:', e);
      }
      setSyncing(false);
    }
  };

  const saveTiers = (t: string[]) => { setTiers(t); localStorage.setItem(TIER_KEY, JSON.stringify(t)); };

  useEffect(() => {
    const handleResize = () => setIsMobile(window.innerWidth <= 768);
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

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
    if (!confirm(`"${node.label}"에서 ${u?.name || '인원'}을 비우시겠습니까? (자리는 유지)`)) return;
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

  // 드래그 → 부서 변경
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
        const label = `${u.name} ${u.position_title || ROLE_LABELS[u.role]}`;
        updated.push({ id: genId(), label, userId: u.id, tier: 1, children: [] });
      } else {
        const target = findNode(updated, targetId);
        if (target && !target.userId) {
          // 빈 자리(부서)에 드롭 → 채워넣기
          target.userId = u.id;
          // 라벨은 변경하지 않음 (부서명 유지)
        } else if (target) {
          // 인원이 있는 노드 → 하위로 추가
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

  // CC 관리
  const handleAddCc = async (userId: string) => {
    try {
      await api.org.ccAdd(userId);
      const ccRes = await api.org.ccList();
      setCcList(ccRes.ccList || []);
    } catch (e: any) {
      alert(e.message || 'CC 추가 실패');
    }
  };

  const handleDeleteCc = async (id: string) => {
    if (!confirm('CC 승인자를 삭제하시겠습니까?')) return;
    try {
      await api.org.ccDelete(id);
      setCcList(ccList.filter((c) => c.id !== id));
    } catch (e: any) {
      alert(e.message || 'CC 삭제 실패');
    }
  };

  // CC 모달에서 보여줄 사용자 목록 (이미 CC인 사람 제외)
  const ccUserIds = ccList.map((c) => c.cc_user_id);
  const ccCandidates = users.filter((u) =>
    u.role !== 'master' && !ccUserIds.includes(u.id) &&
    (u.name.includes(ccSearch) || u.email.includes(ccSearch) || (u.position_title || '').includes(ccSearch))
  );

  // 모바일: 접기/펼치기 토글
  const toggleCollapse = (id: string) => {
    setCollapsedNodes(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  // 모바일 리스트 렌더 (재귀)
  const renderMobileNode = (node: OrgNode, depth: number = 0): React.ReactNode => {
    const u = node.userId ? getUserById(node.userId) : null;
    const tierIdx = Math.max(0, Math.min(node.tier - 1, 4));
    const color = TIER_COLORS[tierIdx];
    const bg = TIER_BG[tierIdx];
    const hasChildren = node.children.length > 0;
    const isCollapsed = collapsedNodes.has(node.id);

    return (
      <div key={node.id} className="ocm-item" style={{ paddingLeft: depth * 16 }}>
        <div
          className={`ocm-row ${u ? '' : 'ocm-row-dept'}`}
          style={{ borderLeftColor: color, background: u ? '#fff' : bg }}
          onClick={() => hasChildren && toggleCollapse(node.id)}
        >
          {hasChildren && (
            <span className="ocm-chevron">
              {isCollapsed ? <ChevronRight size={14} /> : <ChevronDown size={14} />}
            </span>
          )}
          {u ? (
            <div className="ocm-avatar" style={{
              background: u.login_type === 'freelancer' ? '#7b1fa220' : (ROLE_COLORS[u.role] || color) + '20',
              color: u.login_type === 'freelancer' ? '#7b1fa2' : ROLE_COLORS[u.role] || color,
              border: u.login_type === 'freelancer' ? '2px solid #7b1fa2' : undefined,
            }}>{u.name.charAt(0)}</div>
          ) : (
            <div className="ocm-avatar ocm-avatar-empty" style={{ borderColor: color, color }}>?</div>
          )}
          <div className="ocm-info">
            <div className="ocm-label">
              {node.label}
              {u?.login_type === 'freelancer' && <span style={{ fontSize: '0.6rem', marginLeft: 4, padding: '1px 4px', borderRadius: 4, background: '#f3e5f5', color: '#7b1fa2' }}>F</span>}
            </div>
            {u && <div className="ocm-pos">{u.position_title || ROLE_LABELS[u.role]}</div>}
          </div>
          {hasChildren && <span className="ocm-badge">{node.children.length}</span>}
          {canEdit && (
            <div className="ocm-actions">
              <button className="oc-card-btn" title="하위 추가" onClick={(e) => { e.stopPropagation(); setAddingTo(node.id); setAddLabel(''); setAddUserId(''); setAddTier(Math.min(node.tier + 1, 5)); setAddType('dept'); }}>
                <Plus size={10} />
              </button>
              <button className="oc-card-btn oc-card-btn-del" title="삭제" onClick={(e) => { e.stopPropagation(); handleDelete(node.id); }}>
                <Trash2 size={10} />
              </button>
            </div>
          )}
        </div>
        {addingTo === node.id && (
          <div className="oc-inline-add" style={{ marginLeft: depth * 16 + 16 }} onClick={(e) => e.stopPropagation()}>
            <select className="oc-add-type" value={addType} onChange={(e) => { setAddType(e.target.value as any); setAddLabel(''); }} style={{ padding: '4px 6px', borderRadius: 6, border: '1px solid #dadce0', fontSize: '0.75rem' }}>
              <option value="dept">부서</option>
              <option value="branch">지사</option>
              <option value="free">직접 입력</option>
            </select>
            {addType === 'branch' ? (
              <Select size="sm" options={BRANCH_OPTS} value={BRANCH_OPTS.find(o => o.value === addLabel) || null}
                onChange={(o: any) => setAddLabel(o?.value || '')} placeholder="지사 선택" />
            ) : addType === 'dept' ? (
              <Select size="sm" options={DEPT_OPTS} value={DEPT_OPTS.find(o => o.value === addLabel) || null}
                onChange={(o: any) => setAddLabel(o?.value || '')} placeholder="부서 선택" />
            ) : (
              <input className="oc-add-input" value={addLabel} onChange={(e) => setAddLabel(e.target.value)}
                placeholder="이름 입력" autoFocus onKeyDown={(e) => e.key === 'Enter' && handleAdd()} />
            )}
            <button className="btn btn-sm btn-primary" onClick={handleAdd}>추가</button>
            <button className="btn btn-sm" onClick={() => setAddingTo(null)}>취소</button>
          </div>
        )}
        {hasChildren && !isCollapsed && (
          <div className="ocm-children">
            {node.children.map((child) => renderMobileNode(child, depth + 1))}
          </div>
        )}
      </div>
    );
  };

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
            <div className="oc-card-tier-label" onClick={(e) => { e.stopPropagation(); if (canEdit) startEditNode(node.id, node.label); }}>
              {node.label} {canEdit && <Pencil size={8} className="oc-edit-icon" />}
            </div>
          )}
          <div
            className={`oc-card ${isDragging ? 'oc-card-dragging' : ''} ${isDropOver ? 'oc-card-drop' : ''} ${u ? '' : 'oc-card-dept'}`}
            style={{ borderColor: color, background: u ? '#fff' : bg }}
            data-oc-id={node.id}
            data-oc-parent={parentId || ''}
            draggable={!!canEdit}
            onDragStart={(e) => { e.dataTransfer.setData('text/node', node.id); e.dataTransfer.effectAllowed = 'move'; setDragNodeId(node.id); }}
            onDragEnd={reset}
            onDragOver={(e) => { e.preventDefault(); e.stopPropagation(); setDropTargetId(node.id); }}
            onDragLeave={(e) => { e.stopPropagation(); if (dropTargetId === node.id) setDropTargetId(null); }}
            onDrop={(e) => handleDrop(node.id, e)}
          >
            {u ? (
              <div className="oc-card-avatar" style={{
                background: u.login_type === 'freelancer' ? '#7b1fa220' : (ROLE_COLORS[u.role] || color) + '20',
                color: u.login_type === 'freelancer' ? '#7b1fa2' : ROLE_COLORS[u.role] || color,
                border: u.login_type === 'freelancer' ? '2px solid #7b1fa2' : undefined,
              }}>{u.name.charAt(0)}</div>
            ) : (
              <div className="oc-card-empty-avatar" style={{ borderColor: color }}>?</div>
            )}
            <div className="oc-card-body">
              {u ? (
                <>
                  <div className="oc-card-name" style={u.login_type === 'freelancer' ? { color: '#7b1fa2' } : undefined}>
                    {u.name}
                    {u.login_type === 'freelancer' && <span style={{ fontSize: '0.6rem', marginLeft: 4, padding: '1px 4px', borderRadius: 4, background: '#f3e5f5', color: '#7b1fa2' }}>F</span>}
                  </div>
                  <div className="oc-card-pos">{u.position_title || ROLE_LABELS[u.role]}</div>
                </>
              ) : (
                <div className="oc-card-hint">드래그 배치</div>
              )}
            </div>
            {canEdit && (
              <div className="oc-card-actions">
                <button className="oc-card-btn" title="하위 추가" onClick={(e) => { e.stopPropagation(); setAddingTo(node.id); setAddLabel(''); setAddUserId(''); setAddTier(Math.min(node.tier + 1, 5)); setAddType('dept'); }}>
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
            )}
          </div>
        </div>

        {addingTo === node.id && (
          <div className="oc-inline-add" onClick={(e) => e.stopPropagation()}>
            <select className="oc-add-type" value={addType} onChange={(e) => { setAddType(e.target.value as any); setAddLabel(''); }} style={{ padding: '4px 6px', borderRadius: 6, border: '1px solid #dadce0', fontSize: '0.75rem' }}>
              <option value="dept">부서</option>
              <option value="branch">지사</option>
              <option value="free">직접 입력</option>
            </select>
            {addType === 'branch' ? (
              <Select size="sm" options={BRANCH_OPTS} value={BRANCH_OPTS.find(o => o.value === addLabel) || null}
                onChange={(o: any) => setAddLabel(o?.value || '')} placeholder="지사 선택" />
            ) : addType === 'dept' ? (
              <Select size="sm" options={DEPT_OPTS} value={DEPT_OPTS.find(o => o.value === addLabel) || null}
                onChange={(o: any) => setAddLabel(o?.value || '')} placeholder="부서 선택" />
            ) : (
              <input className="oc-add-input" value={addLabel} onChange={(e) => setAddLabel(e.target.value)}
                placeholder="이름 입력" autoFocus onKeyDown={(e) => e.key === 'Enter' && handleAdd()} />
            )}
            <button className="btn btn-sm btn-primary" onClick={handleAdd}>추가</button>
            <button className="btn btn-sm" onClick={() => setAddingTo(null)}>취소</button>
          </div>
        )}

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
        <h2>
          <Users size={20} style={{ marginRight: 6, verticalAlign: 'middle' }} />조직도
          {syncing && <span style={{ fontSize: '0.65rem', color: '#888', marginLeft: 8 }}>동기화중...</span>}
        </h2>
        <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
          {canEdit && (
            <>
              <button className="btn btn-sm" onClick={() => setShowCcModal(true)}>
                <Shield size={13} /> CC 설정
              </button>
              <button className="btn btn-sm" onClick={startEditTiers}><Settings size={13} /> 등급 설정</button>
              {addingTo === 'root' ? (
                <div className="oc-add-form" style={{ display: 'flex', gap: 4, alignItems: 'center', flexWrap: 'wrap' }}>
                  <select className="oc-add-type" value={addType} onChange={(e) => { setAddType(e.target.value as any); setAddLabel(''); }} style={{ padding: '4px 6px', borderRadius: 6, border: '1px solid #dadce0', fontSize: '0.75rem' }}>
                    <option value="branch">지사</option>
                    <option value="dept">부서</option>
                    <option value="free">직접 입력</option>
                  </select>
                  {addType === 'branch' ? (
                    <Select size="sm" options={BRANCH_OPTS} value={BRANCH_OPTS.find(o => o.value === addLabel) || null}
                      onChange={(o: any) => setAddLabel(o?.value || '')} placeholder="지사 선택" />
                  ) : addType === 'dept' ? (
                    <Select size="sm" options={DEPT_OPTS} value={DEPT_OPTS.find(o => o.value === addLabel) || null}
                      onChange={(o: any) => setAddLabel(o?.value || '')} placeholder="부서 선택" />
                  ) : (
                    <input className="oc-add-input" value={addLabel} onChange={(e) => setAddLabel(e.target.value)}
                      placeholder="이름 입력" autoFocus onKeyDown={(e) => e.key === 'Enter' && handleAdd()} />
                  )}
                  <button className="btn btn-sm btn-primary" onClick={handleAdd}>추가</button>
                  <button className="btn btn-sm" onClick={() => setAddingTo(null)}>취소</button>
                </div>
              ) : (
                <button className="btn btn-sm btn-primary" onClick={() => { setAddingTo('root'); setAddLabel(''); setAddUserId(''); setAddTier(1); setAddType('branch'); }}>
                  <Plus size={13} /> 조직 추가
                </button>
              )}
            </>
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

      {/* CC 설정 모달 */}
      {showCcModal && (
        <div className="modal-overlay" onClick={() => setShowCcModal(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 420 }}>
            <h3><Shield size={16} style={{ marginRight: 6, verticalAlign: 'middle' }} />CC 승인자 설정</h3>
            <p style={{ fontSize: '0.72rem', color: '#666', margin: '4px 0 12px' }}>
              지사장/본부장 등 최상위급이 문서를 제출할 때, 대표 대신 결재할 CC 승인자를 설정합니다.
            </p>

            {/* 현재 CC 목록 */}
            {ccList.length > 0 && (
              <div style={{ marginBottom: 12 }}>
                <div style={{ fontSize: '0.72rem', fontWeight: 600, marginBottom: 4 }}>등록된 CC</div>
                {ccList.map((cc) => (
                  <div key={cc.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '4px 8px', background: '#f8f9fa', borderRadius: 6, marginBottom: 4 }}>
                    <span style={{ fontSize: '0.75rem' }}>
                      <b>{cc.cc_user_name}</b> <span style={{ color: '#888' }}>{cc.cc_user_email}</span>
                    </span>
                    <button className="btn btn-sm" style={{ color: '#d32f2f', padding: '2px 6px' }} onClick={() => handleDeleteCc(cc.id)}>
                      <Trash2 size={11} />
                    </button>
                  </div>
                ))}
              </div>
            )}

            {/* CC 추가 */}
            <div style={{ fontSize: '0.72rem', fontWeight: 600, marginBottom: 4 }}>CC 추가</div>
            <input
              className="oc-pool-search"
              placeholder="이름 또는 이메일 검색..."
              value={ccSearch}
              onChange={(e) => setCcSearch(e.target.value)}
              style={{ marginBottom: 6 }}
            />
            <div style={{ maxHeight: 180, overflowY: 'auto' }}>
              {ccCandidates.slice(0, 20).map((u) => (
                <div key={u.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '4px 8px', borderBottom: '1px solid #eee' }}>
                  <span style={{ fontSize: '0.72rem' }}>
                    {u.name} <span style={{ color: '#888' }}>{u.position_title || ROLE_LABELS[u.role]}</span>
                  </span>
                  <button className="btn btn-sm btn-primary" style={{ padding: '2px 8px', fontSize: '0.65rem' }} onClick={() => handleAddCc(u.id)}>
                    추가
                  </button>
                </div>
              ))}
              {ccCandidates.length === 0 && <div style={{ fontSize: '0.7rem', color: '#999', padding: 8 }}>결과 없음</div>}
            </div>

            <div className="modal-actions" style={{ marginTop: 12 }}>
              <button className="btn" onClick={() => setShowCcModal(false)}>닫기</button>
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
          {tree.length === 0 && (
            <div className="empty-state" style={{ padding: 40, fontSize: '0.8rem' }}>
              "조직 추가" 버튼으로 최상위(대표)부터 구성하세요.<br />
              각 노드의 + 버튼으로 하위 조직을 추가합니다.
            </div>
          )}

          {isMobile ? (
            /* 모바일: 세로 리스트 + 접기/펼치기 */
            <div className="ocm-tree">
              {tree.map((node) => renderMobileNode(node, 0))}
            </div>
          ) : (
            /* 데스크탑: 피라미드 */
            <div className="oc-pyramid oc-css-lines" ref={pyramidRef}>
              {tree.length === 1 ? (
                renderNode(tree[0])
              ) : (
                <div className="oc-kids">
                  {tree.map((node) => renderNode(node))}
                </div>
              )}
            </div>
          )}
        </div>

        {/* 우측 풀 (모바일에서는 하단 접이식) */}
        <div className="oc-pool">
          <div className="oc-pool-hd"><span>미배치 인원 <b>{poolUsers.length}</b></span></div>
          <input className="oc-pool-search" placeholder="검색..." value={poolSearch} onChange={(e) => setPoolSearch(e.target.value)} />
          <div className="oc-pool-list">
            {filteredPool.length === 0 && <div className="empty-state" style={{ fontSize: '0.72rem', padding: 12 }}>없음</div>}
            {filteredPool.map((u) => {
              const c = ROLE_COLORS[u.role];
              return (
                <div key={u.id} className="oc-chip" draggable={!!canEdit}
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
