import { useEffect, useMemo, useState } from 'react';
import { FileSpreadsheet, History, Pencil, RefreshCw, Search, Trash2, X } from 'lucide-react';
import { api } from '../api';
import type { User } from '../types';

type LedgerItem = {
  id: string;
  external_id: string;
  progress_id: string | null;
  consultant_user_id: string;
  consultant_name: string;
  consultant_branch: string;
  consultant_department: string;
  client_name: string;
  settlement_date: string;
  payroll_month: string;
  consultant_share: number;
  statement_title: string | null;
  statement_content: string | null;
  source_registered_at: string;
  updated_at: string;
  manual_override_at: string | null;
  manual_override_name: string;
  deleted_at: string | null;
  deleted_by_name: string;
  delete_reason: string;
};

const currentMonth = () => new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Seoul' }).slice(0, 7);
const won = (value: number) => `${Number(value || 0).toLocaleString('ko-KR')}원`;

export default function LawitgoSettlementLedger() {
  const [items, setItems] = useState<LedgerItem[]>([]);
  const [users, setUsers] = useState<User[]>([]);
  const [month, setMonth] = useState(currentMonth());
  const [status, setStatus] = useState<'active' | 'deleted' | 'all'>('active');
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(false);
  const [editing, setEditing] = useState<LedgerItem | null>(null);
  const [historyItem, setHistoryItem] = useState<LedgerItem | null>(null);
  const [history, setHistory] = useState<any[]>([]);

  const load = async () => {
    setLoading(true);
    try {
      const result = await api.lawitgoSettlementLedger.list({ month, status, search: search.trim(), limit: 500 });
      setItems(result.items as LedgerItem[]);
    } catch (error: any) {
      alert(error.message || '신정산 원장을 불러오지 못했습니다.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void load(); }, [month, status]);
  useEffect(() => {
    api.users.list().then((result) => setUsers(result.users.filter((user) => user.role !== 'resigned'))).catch(() => setUsers([]));
  }, []);

  const total = useMemo(() => items.filter((item) => !item.deleted_at).reduce((sum, item) => sum + Number(item.consultant_share || 0), 0), [items]);

  const openHistory = async (item: LedgerItem) => {
    setHistoryItem(item);
    try {
      const result = await api.lawitgoSettlementLedger.history(item.id);
      setHistory(result.history);
    } catch (error: any) {
      setHistoryItem(null);
      alert(error.message || '변경 이력을 불러오지 못했습니다.');
    }
  };

  const remove = async (item: LedgerItem) => {
    const reason = prompt(`“${item.client_name}” 신정산 원장을 삭제 처리합니다.\n급여와 명도 사건 목록에서 제외되며 감사 이력은 보관됩니다.\n\n삭제 사유를 입력하세요.`);
    if (reason === null) return;
    if (!reason.trim()) { alert('삭제 사유를 입력해 주세요.'); return; }
    if (!confirm('정말 삭제 처리하시겠습니까?')) return;
    try {
      await api.lawitgoSettlementLedger.delete(item.id, reason.trim());
      await load();
    } catch (error: any) {
      alert(error.message || '삭제 처리에 실패했습니다.');
    }
  };

  return (
    <div className="page">
      <div className="page-header">
        <h2><FileSpreadsheet size={24} style={{ marginRight: 8, verticalAlign: 'middle' }} />명승 신정산 원장</h2>
        <div style={{ fontSize: 12, color: '#5f6368', marginTop: 4 }}>명승에서 수신한 컨설턴트 지급액을 관리합니다. 수정·삭제 이력은 별도로 보관됩니다.</div>
      </div>

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 14, alignItems: 'center' }}>
        <input type="month" value={month} onChange={(event) => setMonth(event.target.value)} style={controlStyle} />
        <select value={status} onChange={(event) => setStatus(event.target.value as typeof status)} style={controlStyle}>
          <option value="active">사용 중</option><option value="deleted">삭제됨</option><option value="all">전체</option>
        </select>
        <div style={{ display: 'flex', flex: '1 1 260px', minWidth: 220 }}>
          <input value={search} onChange={(event) => setSearch(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') void load(); }} placeholder="의뢰인·컨설턴트·외부 ID 검색" style={{ ...controlStyle, flex: 1, borderRadius: '7px 0 0 7px' }} />
          <button onClick={() => void load()} className="btn btn-primary" style={{ borderRadius: '0 7px 7px 0' }}><Search size={15} /> 검색</button>
        </div>
        <button onClick={() => void load()} className="btn"><RefreshCw size={15} /> 새로고침</button>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: 10, marginBottom: 14 }}>
        <Summary label="조회 건수" value={`${items.length}건`} />
        <Summary label="사용 중 합계" value={won(total)} />
        <Summary label="조회 급여월" value={month || '전체'} />
      </div>

      <div style={{ overflowX: 'auto', background: '#fff', border: '1px solid #e0e0e0', borderRadius: 10 }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 1080, fontSize: 12 }}>
          <thead><tr style={{ background: '#f8f9fa', textAlign: 'left' }}>
            {['상태', '정산일', '컨설턴트', '의뢰인', '지급액', '명승 ID', '수정 정보', '관리'].map((label) => <th key={label} style={cellStyle}>{label}</th>)}
          </tr></thead>
          <tbody>
            {items.map((item) => <tr key={item.id} style={{ opacity: item.deleted_at ? .65 : 1 }}>
              <td style={cellStyle}><span style={{ ...badgeStyle, background: item.deleted_at ? '#fce8e6' : '#e6f4ea', color: item.deleted_at ? '#c5221f' : '#137333' }}>{item.deleted_at ? '삭제됨' : item.manual_override_at ? '수정됨' : '사용 중'}</span></td>
              <td style={cellStyle}>{item.settlement_date}<div style={subStyle}>{item.payroll_month}</div></td>
              <td style={cellStyle}><b>{item.consultant_name || '-'}</b><div style={subStyle}>{[item.consultant_branch, item.consultant_department].filter(Boolean).join(' · ')}</div></td>
              <td style={cellStyle}>{item.client_name}</td>
              <td style={{ ...cellStyle, textAlign: 'right', fontWeight: 700 }}>{won(item.consultant_share)}</td>
              <td style={{ ...cellStyle, fontFamily: 'monospace', fontSize: 11 }}>{item.external_id}<div style={subStyle}>{item.progress_id || ''}</div></td>
              <td style={cellStyle}>{item.deleted_at ? `${item.deleted_by_name || '-'} 삭제` : item.manual_override_at ? `${item.manual_override_name || '-'} 수정` : '명승 수신'}<div style={subStyle}>{item.deleted_at || item.manual_override_at || item.updated_at}</div>{item.delete_reason && <div style={{ color: '#c5221f', marginTop: 3 }}>{item.delete_reason}</div>}</td>
              <td style={cellStyle}><div style={{ display: 'flex', gap: 5 }}>
                {!item.deleted_at && <><button className="btn btn-sm" onClick={() => setEditing(item)} title="수정"><Pencil size={14} /></button><button className="btn btn-sm" onClick={() => void remove(item)} title="삭제" style={{ color: '#c5221f' }}><Trash2 size={14} /></button></>}
                <button className="btn btn-sm" onClick={() => void openHistory(item)} title="변경 이력"><History size={14} /></button>
              </div></td>
            </tr>)}
            {!loading && items.length === 0 && <tr><td colSpan={8} style={{ padding: 36, textAlign: 'center', color: '#80868b' }}>조회된 원장이 없습니다.</td></tr>}
            {loading && <tr><td colSpan={8} style={{ padding: 36, textAlign: 'center', color: '#80868b' }}>불러오는 중...</td></tr>}
          </tbody>
        </table>
      </div>

      {editing && <EditModal item={editing} users={users} onClose={() => setEditing(null)} onSaved={async () => { setEditing(null); await load(); }} />}
      {historyItem && <HistoryModal item={historyItem} history={history} onClose={() => setHistoryItem(null)} />}
    </div>
  );
}

function EditModal({ item, users, onClose, onSaved }: { item: LedgerItem; users: User[]; onClose: () => void; onSaved: () => Promise<void> }) {
  const [form, setForm] = useState({ consultant_user_id: item.consultant_user_id, client_name: item.client_name, settlement_date: item.settlement_date, amount: String(item.consultant_share), statement_title: item.statement_title || '결산내역서', statement_content: item.statement_content || '', reason: '' });
  const [saving, setSaving] = useState(false);
  const save = async () => {
    const amount = Number(form.amount.replace(/,/g, ''));
    if (!form.consultant_user_id || !form.client_name.trim() || !form.settlement_date) { alert('컨설턴트, 의뢰인명, 정산일을 입력해 주세요.'); return; }
    if (!Number.isInteger(amount) || amount < 0) { alert('지급액은 0 이상의 정수여야 합니다.'); return; }
    setSaving(true);
    try {
      await api.lawitgoSettlementLedger.update(item.id, { ...form, client_name: form.client_name.trim(), amount, statement_content: form.statement_content.trim() || null, reason: form.reason.trim() });
      await onSaved();
    } catch (error: any) { alert(error.message || '수정에 실패했습니다.'); } finally { setSaving(false); }
  };
  return <Modal title="신정산 원장 수정" onClose={onClose}>
    <div style={{ display: 'grid', gap: 10 }}>
      <Field label="명승 ID"><input value={item.external_id} disabled style={inputStyle} /></Field>
      <Field label="컨설턴트"><select value={form.consultant_user_id} onChange={(e) => setForm({ ...form, consultant_user_id: e.target.value })} style={inputStyle}><option value="">선택</option>{users.map((user) => <option key={user.id} value={user.id}>{user.name} · {user.branch} · {user.department}</option>)}</select></Field>
      <Field label="의뢰인명"><input value={form.client_name} onChange={(e) => setForm({ ...form, client_name: e.target.value })} style={inputStyle} /></Field>
      <Field label="최종 정산일"><input type="date" value={form.settlement_date} onChange={(e) => setForm({ ...form, settlement_date: e.target.value })} style={inputStyle} /></Field>
      <Field label="지급액"><input inputMode="numeric" value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} style={inputStyle} /></Field>
      <Field label="결산서 제목"><input value={form.statement_title} onChange={(e) => setForm({ ...form, statement_title: e.target.value })} style={inputStyle} /></Field>
      <Field label="결산내역서"><textarea value={form.statement_content} onChange={(e) => setForm({ ...form, statement_content: e.target.value })} rows={7} style={inputStyle} placeholder="비우면 결산내역서가 제거됩니다." /></Field>
      <Field label="수정 사유"><input value={form.reason} onChange={(e) => setForm({ ...form, reason: e.target.value })} style={inputStyle} placeholder="선택 입력" /></Field>
      <div style={{ padding: 10, borderRadius: 7, background: '#fff8e1', color: '#5f6368', fontSize: 12 }}>확정된 급여월은 수정할 수 없습니다. 수정 후에는 명승 재전송보다 관리 원장 값이 우선됩니다.</div>
      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}><button className="btn" onClick={onClose}>취소</button><button className="btn btn-primary" disabled={saving} onClick={() => void save()}>{saving ? '저장 중...' : '저장'}</button></div>
    </div>
  </Modal>;
}

function HistoryModal({ item, history, onClose }: { item: LedgerItem; history: any[]; onClose: () => void }) {
  return <Modal title={`${item.client_name} 변경 이력`} onClose={onClose}>
    {history.length === 0 ? <div style={{ padding: 24, textAlign: 'center', color: '#80868b' }}>수정·삭제 이력이 없습니다.</div> : history.map((entry) => <div key={entry.id} style={{ padding: '11px 0', borderBottom: '1px solid #eee', fontSize: 12 }}><b>{entry.action === 'delete' ? '삭제' : '수정'}</b> · {entry.changed_by_name || entry.changed_by}<div style={subStyle}>{entry.changed_at}</div>{entry.reason && <div style={{ marginTop: 5 }}>사유: {entry.reason}</div>}</div>)}
  </Modal>;
}

function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) { return <div onClick={onClose} style={{ position: 'fixed', inset: 0, zIndex: 1200, background: 'rgba(0,0,0,.45)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}><div onClick={(e) => e.stopPropagation()} style={{ width: 'min(680px, 100%)', maxHeight: '92vh', overflow: 'auto', background: '#fff', borderRadius: 12 }}><div style={{ padding: '15px 18px', borderBottom: '1px solid #eee', display: 'flex', justifyContent: 'space-between' }}><b>{title}</b><button onClick={onClose} style={{ border: 0, background: 'transparent', cursor: 'pointer' }}><X size={18} /></button></div><div style={{ padding: 18 }}>{children}</div></div></div>; }
function Field({ label, children }: { label: string; children: React.ReactNode }) { return <label style={{ display: 'grid', gridTemplateColumns: '105px minmax(0,1fr)', alignItems: 'center', gap: 8, fontSize: 12, color: '#5f6368' }}><span>{label}</span>{children}</label>; }
function Summary({ label, value }: { label: string; value: string }) { return <div style={{ padding: 12, border: '1px solid #e0e0e0', background: '#fff', borderRadius: 9 }}><div style={subStyle}>{label}</div><div style={{ marginTop: 4, fontSize: 17, fontWeight: 700 }}>{value}</div></div>; }
const controlStyle: React.CSSProperties = { height: 36, border: '1px solid #dadce0', borderRadius: 7, padding: '0 10px', background: '#fff' };
const inputStyle: React.CSSProperties = { width: '100%', boxSizing: 'border-box', border: '1px solid #dadce0', borderRadius: 7, padding: '8px 9px', fontSize: 13 };
const cellStyle: React.CSSProperties = { padding: '10px 11px', borderBottom: '1px solid #eee', verticalAlign: 'top' };
const subStyle: React.CSSProperties = { color: '#80868b', fontSize: 11, marginTop: 3 };
const badgeStyle: React.CSSProperties = { display: 'inline-block', padding: '3px 7px', borderRadius: 999, fontSize: 11, fontWeight: 700 };
