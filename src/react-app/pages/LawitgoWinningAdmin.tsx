import { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, CheckCircle2, RefreshCw, Send, ShieldCheck } from 'lucide-react';
import { api } from '../api';

type OutboxItem = {
  id: string;
  status: 'pending' | 'blocked' | 'sending' | 'sent' | 'failed';
  missing_fields: string[];
  attempt_count: number;
  sent_at?: string | null;
  remote_request_id?: string | null;
  last_error?: string | null;
  customer_name: string;
  customer_phone_masked: string;
  court: string;
  case_number: string;
  property_type: string;
  winning_date: string;
  assignee_name: string;
  assignee_branch: string;
};

const STATUS_LABELS: Record<string, string> = {
  pending: '발송대기', blocked: '정보누락', sending: '전송중', sent: '성공', failed: '실패',
};
const MISSING_LABELS: Record<string, string> = {
  customerName: '고객명', customerPhone: '전화번호', court: '법원', caseNumber: '사건번호',
  propertyType: '물건종류', winningDate: '낙찰일', 'assignee.myDocsUserId': '담당자 계정',
  'assignee.consultantId': 'Lawitgo 담당자 연결', 'assignee.name': '담당자명',
};

export default function LawitgoWinningAdmin() {
  const [data, setData] = useState<any>({ items: [], summary: {}, manual_runs: [], scheduled_runs: [] });
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [filter, setFilter] = useState('all');
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');

  const load = async (refresh = false) => {
    setLoading(true); setError('');
    try {
      setData(refresh ? await api.lawitgoWinningAdmin.refresh() : await api.lawitgoWinningAdmin.get());
      setSelected(new Set());
    } catch (err: any) { setError(err.message || '발송 내역을 불러오지 못했습니다.'); }
    finally { setLoading(false); }
  };
  useEffect(() => { load(); }, []);

  const items = (data.items || []) as OutboxItem[];
  const visible = useMemo(() => filter === 'all' ? items : items.filter((item) => item.status === filter), [items, filter]);
  const eligible = items.filter((item) => ['pending', 'failed'].includes(item.status) && item.missing_fields.length === 0);
  const selectedEligible = eligible.filter((item) => selected.has(item.id));
  const toggle = (id: string) => setSelected((current) => {
    const next = new Set(current); next.has(id) ? next.delete(id) : next.add(id); return next;
  });

  const sendItems = async (targets: OutboxItem[]) => {
    if (targets.length === 0) return alert('발송 가능한 내역을 선택하세요.');
    const accepted = confirm(
      `${targets.length}건을 Lawitgo.com으로 실제 발송합니다.\n고객명·전화번호·법원·사건번호가 외부로 전송됩니다.\n\n계속할까요?`,
    );
    if (!accepted) return;
    setSending(true); setError('');
    try {
      const response = await api.lawitgoWinningAdmin.send(targets.map((item) => item.id));
      setData(response);
      setSelected(new Set());
      const result = response.result || {};
      alert(`발송 완료: 성공 ${result.sent || 0}건 / 실패 ${result.failed || 0}건`);
    } catch (err: any) { setError(err.message || 'Lawitgo 발송에 실패했습니다.'); }
    finally { setSending(false); }
  };

  return (
    <div className="page lawitgo-winning-admin-page">
      <div className="page-header lawitgo-winning-header">
        <div>
          <h2><ShieldCheck size={22} /> Lawitgo 낙찰 전송 관리</h2>
          <p>마스터 전용 · 자동 발송과 수동 발송 이력을 통합 관리합니다.</p>
        </div>
        <div className="lawitgo-winning-actions">
          <button className="btn" onClick={() => load(true)} disabled={loading || sending}><RefreshCw size={15} /> 새로고침</button>
          <button className="btn btn-primary" onClick={() => sendItems(selectedEligible)} disabled={sending || selectedEligible.length === 0}><Send size={15} /> 선택 발송 ({selectedEligible.length})</button>
          <button className="btn btn-danger" onClick={() => sendItems(eligible)} disabled={sending || eligible.length === 0}>대기 전체 발송 ({eligible.length})</button>
        </div>
      </div>

      {error && <div className="alert alert-error"><AlertTriangle size={16} /> {error}</div>}
      <div className="lawitgo-winning-summary">
        {[
          ['전체', data.summary?.total || 0, 'all'], ['발송대기', data.summary?.pending || 0, 'pending'],
          ['정보누락', data.summary?.blocked || 0, 'blocked'], ['실패', data.summary?.failed || 0, 'failed'],
          ['성공', data.summary?.sent || 0, 'sent'],
        ].map(([label, count, key]) => (
          <button key={String(key)} className={`lawitgo-winning-summary-card ${filter === key ? 'active' : ''}`} onClick={() => setFilter(String(key))}>
            <span>{label}</span><strong>{count}</strong>
          </button>
        ))}
      </div>

      <section className="lawitgo-winning-panel">
        <div className="lawitgo-winning-panel-head">
          <h3>발송 대상</h3>
          <span>전화번호는 화면에서 마스킹됩니다.</span>
        </div>
        {loading ? <div className="empty-state">불러오는 중...</div> : visible.length === 0 ? <div className="empty-state">해당 내역이 없습니다.</div> : (
          <div className="lawitgo-winning-table-wrap">
            <table className="lawitgo-winning-table">
              <thead><tr><th>선택</th><th>상태</th><th>담당자</th><th>고객</th><th>법원·사건번호</th><th>물건/낙찰일</th><th>발송 정보</th></tr></thead>
              <tbody>{visible.map((item) => {
                const canSend = ['pending', 'failed'].includes(item.status) && item.missing_fields.length === 0;
                return <tr key={item.id}>
                  <td data-label="선택"><input type="checkbox" aria-label={`${item.customer_name} 선택`} checked={selected.has(item.id)} disabled={!canSend || sending} onChange={() => toggle(item.id)} /></td>
                  <td data-label="상태"><span className={`lawitgo-winning-status ${item.status}`}>{STATUS_LABELS[item.status] || item.status}</span></td>
                  <td data-label="담당자">{item.assignee_branch}<br /><strong>{item.assignee_name}</strong></td>
                  <td data-label="고객"><strong>{item.customer_name}</strong><br />{item.customer_phone_masked}</td>
                  <td data-label="법원·사건번호">{item.court}<br /><strong>{item.case_number}</strong></td>
                  <td data-label="물건/낙찰일">{item.property_type}<br />{item.winning_date}</td>
                  <td data-label="발송 정보">
                    {item.missing_fields.length > 0 && <span className="lawitgo-winning-missing">누락: {item.missing_fields.map((field) => MISSING_LABELS[field] || field).join(', ')}</span>}
                    {item.sent_at && <><CheckCircle2 size={13} /> {item.sent_at}</>}
                    {item.remote_request_id && <small>요청 ID: {item.remote_request_id}</small>}
                    {item.last_error && <small className="text-danger">{item.last_error}</small>}
                  </td>
                </tr>;
              })}</tbody>
            </table>
          </div>
        )}
      </section>

      <section className="lawitgo-winning-panel">
        <div className="lawitgo-winning-panel-head"><h3>수동 발송 이력</h3></div>
        <div className="lawitgo-winning-run-list">
          {(data.manual_runs || []).length === 0 ? <div className="empty-state">수동 발송 이력이 없습니다.</div> : (data.manual_runs || []).map((run: any) => (
            <div className="lawitgo-winning-run" key={run.id}>
              <strong>{run.started_at} · {run.actor_name || run.actor_user_id}</strong>
              <span>{STATUS_LABELS[run.status] || run.status} · 성공 {run.sent_count} / 실패 {run.failed_count}</span>
              {run.remote_request_id && <small>요청 ID: {run.remote_request_id}</small>}
              {run.error && <small className="text-danger">{run.error}</small>}
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
