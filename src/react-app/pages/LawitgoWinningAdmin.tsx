import { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, CheckCircle2, Pencil, RefreshCw, Save, Send, ShieldCheck, X } from 'lucide-react';
import {
  api,
  type LawitgoWinningRepairPayload,
  type LawitgoWinningRepairResponse,
} from '../api';

type OutboxItem = {
  id: string;
  sales_record_id: string;
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

type DeliveryRun = {
  id: string;
  actor_user_id: string;
  actor_name?: string | null;
  status: string;
  sent_count: number;
  failed_count: number;
  started_at: string;
  remote_request_id?: string | null;
  error?: string | null;
};

type WinningAdminData = {
  items: OutboxItem[];
  summary: Partial<Record<'total' | 'pending' | 'blocked' | 'sending' | 'sent' | 'failed', number>>;
  manual_runs: DeliveryRun[];
  scheduled_runs: unknown[];
  result?: { sent?: number; failed?: number };
};

const STATUS_LABELS: Record<string, string> = {
  pending: '발송대기', blocked: '정보누락', sending: '전송중', sent: '성공', failed: '실패',
};
const MISSING_LABELS: Record<string, string> = {
  customerName: '고객명', customerPhone: '전화번호', court: '법원', caseNumber: '사건번호',
  propertyType: '물건종류', winningDate: '낙찰일', 'assignee.myDocsUserId': '담당자 계정',
  'assignee.consultantId': 'Lawitgo 담당자 연결', 'assignee.name': '담당자명',
};

const EMPTY_REPAIR_FORM: LawitgoWinningRepairPayload = {
  customer_name: '',
  customer_phone: '',
  court: '',
  case_number: '',
  property_type: '',
  winning_date: '',
  assignee_user_id: '',
};

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback;
}

export default function LawitgoWinningAdmin() {
  const [data, setData] = useState<WinningAdminData>({ items: [], summary: {}, manual_runs: [], scheduled_runs: [] });
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [filter, setFilter] = useState('all');
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');
  const [repairTarget, setRepairTarget] = useState<{ salesRecordId: string; label: string } | null>(null);
  const [repair, setRepair] = useState<LawitgoWinningRepairResponse | null>(null);
  const [repairForm, setRepairForm] = useState<LawitgoWinningRepairPayload>(EMPTY_REPAIR_FORM);
  const [repairLoading, setRepairLoading] = useState(false);
  const [repairSaving, setRepairSaving] = useState(false);
  const [repairError, setRepairError] = useState('');

  const load = async (refresh = false) => {
    setLoading(true); setError('');
    try {
      setData(refresh ? await api.lawitgoWinningAdmin.refresh() : await api.lawitgoWinningAdmin.get());
      setSelected(new Set());
    } catch (err: unknown) { setError(errorMessage(err, '발송 내역을 불러오지 못했습니다.')); }
    finally { setLoading(false); }
  };
  useEffect(() => { load(); }, []);

  useEffect(() => {
    if (!repairTarget) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !repairSaving) setRepairTarget(null);
    };
    document.addEventListener('keydown', closeOnEscape);
    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener('keydown', closeOnEscape);
    };
  }, [repairTarget, repairSaving]);

  const items = useMemo(() => data.items || [], [data.items]);
  const visible = useMemo(() => filter === 'all' ? items : items.filter((item) => item.status === filter), [items, filter]);
  const eligible = items.filter((item) => ['pending', 'failed'].includes(item.status) && item.missing_fields.length === 0);
  const selectedEligible = eligible.filter((item) => selected.has(item.id));
  const toggle = (id: string) => setSelected((current) => {
    const next = new Set(current);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    return next;
  });

  const openRepair = async (item: OutboxItem) => {
    if (!item.sales_record_id) return;
    setRepairTarget({ salesRecordId: item.sales_record_id, label: item.customer_name || item.case_number || '낙찰 건' });
    setRepair(null);
    setRepairForm(EMPTY_REPAIR_FORM);
    setRepairError('');
    setRepairLoading(true);
    try {
      const response = await api.lawitgoWinningAdmin.getRepair(item.sales_record_id);
      setRepair(response);
      setRepairForm({
        customer_name: response.item.customer_name || '',
        customer_phone: response.item.customer_phone || '',
        court: response.item.court || '',
        case_number: response.item.case_number || '',
        property_type: response.item.property_type || '',
        winning_date: response.item.winning_date || '',
        assignee_user_id: response.item.assignee_user_id || '',
      });
    } catch (err: unknown) {
      setRepairError(errorMessage(err, '보완할 정보를 불러오지 못했습니다.'));
    } finally {
      setRepairLoading(false);
    }
  };

  const closeRepair = () => {
    if (repairSaving) return;
    setRepairTarget(null);
    setRepair(null);
    setRepairError('');
  };

  const updateRepairField = <K extends keyof LawitgoWinningRepairPayload>(key: K, value: LawitgoWinningRepairPayload[K]) => {
    setRepairForm((current) => ({ ...current, [key]: value }));
    setRepairError('');
  };

  const saveRepair = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!repairTarget || !repair) return;
    const normalizedPhone = repairForm.customer_phone.replace(/\D/g, '');
    if (!/^0\d{9,10}$/.test(normalizedPhone)) {
      setRepairError('전화번호는 0으로 시작하는 10~11자리 숫자로 입력하세요.');
      return;
    }
    setRepairSaving(true);
    setRepairError('');
    try {
      await api.lawitgoWinningAdmin.updateRepair(repairTarget.salesRecordId, {
        ...repairForm,
        customer_phone: normalizedPhone,
      });
      await load(true);
      setRepairTarget(null);
      setRepair(null);
    } catch (err: unknown) {
      setRepairError(errorMessage(err, '정보를 저장하지 못했습니다.'));
    } finally {
      setRepairSaving(false);
    }
  };

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
    } catch (err: unknown) { setError(errorMessage(err, 'Lawitgo 발송에 실패했습니다.')); }
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
                    {item.missing_fields.length > 0 && item.status !== 'sent' && item.status !== 'sending' && (
                      <button
                        type="button"
                        className="btn btn-sm lawitgo-winning-repair-button"
                        onClick={() => openRepair(item)}
                        disabled={sending}
                      >
                        <Pencil size={13} /> 정보 보완
                      </button>
                    )}
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
          {(data.manual_runs || []).length === 0 ? <div className="empty-state">수동 발송 이력이 없습니다.</div> : (data.manual_runs || []).map((run) => (
            <div className="lawitgo-winning-run" key={run.id}>
              <strong>{run.started_at} · {run.actor_name || run.actor_user_id}</strong>
              <span>{STATUS_LABELS[run.status] || run.status} · 성공 {run.sent_count} / 실패 {run.failed_count}</span>
              {run.remote_request_id && <small>요청 ID: {run.remote_request_id}</small>}
              {run.error && <small className="text-danger">{run.error}</small>}
            </div>
          ))}
        </div>
      </section>

      {repairTarget && (
        <div className="modal-overlay lawitgo-winning-repair-overlay" role="presentation">
          <section
            className="modal-content lawitgo-winning-repair-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="lawitgo-winning-repair-title"
          >
            <div className="modal-header lawitgo-winning-repair-header">
              <div>
                <h3 id="lawitgo-winning-repair-title">Lawitgo 발송 정보 보완</h3>
                <p>{repairTarget.label} · 누락 정보를 저장하면 발송대기로 전환됩니다.</p>
              </div>
              <button type="button" className="modal-close" onClick={closeRepair} disabled={repairSaving} aria-label="정보 보완 창 닫기">
                <X size={20} />
              </button>
            </div>

            {repairLoading ? (
              <div className="lawitgo-winning-repair-loading">보완 정보를 불러오는 중...</div>
            ) : !repair ? (
              <div className="lawitgo-winning-repair-body">
                <div className="alert alert-error"><AlertTriangle size={16} /> {repairError || '보완 정보를 불러오지 못했습니다.'}</div>
              </div>
            ) : (
              <form onSubmit={saveRepair} className="lawitgo-winning-repair-form">
                <div className="lawitgo-winning-repair-body">
                  <div className="lawitgo-winning-repair-notice">
                    <strong>현재 누락 항목</strong>
                    <div className="lawitgo-winning-repair-missing-list">
                      {repair.item.missing_fields.map((field) => (
                        <span key={field}>{MISSING_LABELS[field] || field}</span>
                      ))}
                    </div>
                    <small>전화번호 원문은 이 마스터 전용 보완 창에서만 확인할 수 있습니다.</small>
                  </div>

                  {repairError && <div className="alert alert-error"><AlertTriangle size={16} /> {repairError}</div>}

                  <div className="lawitgo-winning-repair-grid">
                    <label className={repair.item.missing_fields.includes('customerName') ? 'is-missing' : ''}>
                      <span>고객명 <em>필수</em></span>
                      <input
                        autoFocus={repair.item.missing_fields.includes('customerName')}
                        className="form-input"
                        value={repairForm.customer_name}
                        onChange={(event) => updateRepairField('customer_name', event.target.value)}
                        maxLength={100}
                        required
                      />
                    </label>

                    <label className={repair.item.missing_fields.includes('customerPhone') ? 'is-missing' : ''}>
                      <span>전화번호 <em>필수</em></span>
                      <input
                        autoFocus={!repair.item.missing_fields.includes('customerName') && repair.item.missing_fields.includes('customerPhone')}
                        className="form-input"
                        type="tel"
                        inputMode="numeric"
                        autoComplete="tel"
                        value={repairForm.customer_phone}
                        onChange={(event) => updateRepairField('customer_phone', event.target.value.replace(/\D/g, '').slice(0, 11))}
                        placeholder="01012345678"
                        pattern="0[0-9]{9,10}"
                        required
                      />
                    </label>

                    <label className={repair.item.missing_fields.includes('court') ? 'is-missing' : ''}>
                      <span>법원 <em>필수</em></span>
                      <input
                        className="form-input"
                        value={repairForm.court}
                        onChange={(event) => updateRepairField('court', event.target.value)}
                        placeholder="예: 의정부지방법원"
                        maxLength={100}
                        required
                      />
                    </label>

                    <label className={repair.item.missing_fields.includes('caseNumber') ? 'is-missing' : ''}>
                      <span>사건번호 <em>필수</em></span>
                      <input
                        className="form-input"
                        value={repairForm.case_number}
                        onChange={(event) => updateRepairField('case_number', event.target.value)}
                        placeholder="예: 2026타경12345"
                        maxLength={80}
                        required
                      />
                    </label>

                    <label className={repair.item.missing_fields.includes('propertyType') ? 'is-missing' : ''}>
                      <span>물건종류 <em>필수</em></span>
                      <input
                        className="form-input"
                        value={repairForm.property_type}
                        onChange={(event) => updateRepairField('property_type', event.target.value)}
                        placeholder="예: 아파트"
                        maxLength={100}
                        required
                      />
                    </label>

                    <label className={repair.item.missing_fields.includes('winningDate') ? 'is-missing' : ''}>
                      <span>낙찰일 <em>필수</em></span>
                      <input
                        className="form-input"
                        type="date"
                        value={repairForm.winning_date}
                        onChange={(event) => updateRepairField('winning_date', event.target.value)}
                        required
                      />
                    </label>

                    <label className={`lawitgo-winning-repair-assignee ${repair.item.missing_fields.some((field) => field.startsWith('assignee.')) ? 'is-missing' : ''}`}>
                      <span>담당자 계정 <em>필수</em></span>
                      <select
                        className="form-input"
                        value={repairForm.assignee_user_id}
                        onChange={(event) => updateRepairField('assignee_user_id', event.target.value)}
                        required
                      >
                        <option value="">담당자 선택</option>
                        {repair.assignees.map((assignee) => (
                          <option key={assignee.id} value={assignee.id}>
                            {assignee.branch ? `[${assignee.branch}] ` : ''}{assignee.name}{assignee.consultant_id ? '' : ' · Lawitgo 연결 없음'}
                          </option>
                        ))}
                      </select>
                      {(() => {
                        const assignee = repair.assignees.find((candidate) => candidate.id === repairForm.assignee_user_id);
                        if (!assignee) return <small>담당자명·지사·Lawitgo 연결값은 선택한 계정에서 자동 적용됩니다.</small>;
                        return (
                          <small className={assignee.consultant_id ? '' : 'text-danger'}>
                            담당자명 {assignee.name} · {assignee.branch || '지사 미지정'} · Lawitgo {assignee.consultant_id || '연결 없음'}
                          </small>
                        );
                      })()}
                    </label>
                  </div>
                </div>

                <div className="lawitgo-winning-repair-actions">
                  <button type="button" className="btn" onClick={closeRepair} disabled={repairSaving}>취소</button>
                  <button type="submit" className="btn btn-primary" disabled={repairSaving}>
                    <Save size={15} /> {repairSaving ? '저장 중...' : '저장하고 발송대기로 전환'}
                  </button>
                </div>
              </form>
            )}
          </section>
        </div>
      )}
    </div>
  );
}
