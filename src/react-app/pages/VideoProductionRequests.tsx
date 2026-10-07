import { useEffect, useMemo, useState } from 'react';
import { CalendarDays, CheckCircle, Edit3, Plus, RotateCcw, Trash2, Video } from 'lucide-react';
import { Navigate, useSearchParams } from 'react-router-dom';
import { api, type VideoProductionRequestItem, type VideoProductionStatus, type VideoProductionType } from '../api';
import { useAuthStore } from '../store';
import Select from '../components/Select';
import {
  canManageVideoProduction,
  videoProductionDefaultAmount,
  VIDEO_PRODUCTION_STATUS_LABELS,
  VIDEO_PRODUCTION_TYPE_LABELS,
} from '../../shared/video-production';

type AssigneeOption = {
  id: string;
  name: string;
  role: string;
  branch: string;
  department: string;
  position_title?: string;
  login_type?: string;
};

type SelectOption = {
  value: string;
  label: string;
};

type VideoProductionFormState = {
  assignee_user_id: string;
  video_type: VideoProductionType;
  quantity: string;
  unit_amount: string;
  amount: string;
  request_date: string;
  title: string;
  memo: string;
};

type ResultDatePickerState = {
  item: VideoProductionRequestItem;
  date: string;
};

const todayKey = () => new Date(Date.now() + 9 * 60 * 60 * 1000).toISOString().slice(0, 10);
const currentMonthKey = () => todayKey().slice(0, 7);

const emptyForm = (assigneeId = ''): VideoProductionFormState => ({
  assignee_user_id: assigneeId,
  video_type: 'short_form',
  quantity: '1',
  unit_amount: String(videoProductionDefaultAmount('short_form')),
  amount: String(videoProductionDefaultAmount('short_form')),
  request_date: todayKey(),
  title: '',
  memo: '',
});

function preferredAssigneeId(users: AssigneeOption[]): string {
  return users.find((item) => item.name === '임은혜')?.id || users[0]?.id || '';
}

function parseMoney(value: string): number {
  return Math.max(Number(String(value || '').replace(/[^0-9]/g, '')) || 0, 0);
}

function fmt(value: number): string {
  return `${(Number(value) || 0).toLocaleString('ko-KR')}원`;
}

function itemToForm(item: VideoProductionRequestItem): VideoProductionFormState {
  const quantity = Math.max(Number(item.quantity) || 1, 1);
  const unitAmount = Number(item.unit_amount) || Math.trunc((Number(item.amount) || videoProductionDefaultAmount(item.video_type)) / quantity);
  return {
    assignee_user_id: item.assignee_user_id,
    video_type: item.video_type,
    quantity: String(quantity),
    unit_amount: String(unitAmount),
    amount: String(Number(item.amount) || unitAmount * quantity),
    request_date: item.request_date || todayKey(),
    title: item.title || '',
    memo: item.memo || '',
  };
}

function assigneeLabel(user?: AssigneeOption): string {
  if (!user) return '';
  return [user.name, user.branch, user.department, user.position_title].filter(Boolean).join(' · ');
}

function itemTypeLabel(item: VideoProductionRequestItem): string {
  return VIDEO_PRODUCTION_TYPE_LABELS[item.video_type] || item.video_type;
}

export default function VideoProductionRequests() {
  const { user } = useAuthStore();
  const [searchParams, setSearchParams] = useSearchParams();
  const allowed = canManageVideoProduction(user);
  const queryMonth = searchParams.get('month');
  const queryEditId = searchParams.get('edit') || '';
  const [month, setMonth] = useState(() => (/^\d{4}-\d{2}$/.test(queryMonth || '') ? queryMonth! : currentMonthKey()));
  const [items, setItems] = useState<VideoProductionRequestItem[]>([]);
  const [users, setUsers] = useState<AssigneeOption[]>([]);
  const [statusFilter, setStatusFilter] = useState<VideoProductionStatus | ''>('');
  const [assigneeFilter, setAssigneeFilter] = useState('');
  const [summary, setSummary] = useState({ confirmed_count: 0, short_count: 0, long_count: 0, total_amount: 0 });
  const [form, setForm] = useState<VideoProductionFormState>(() => emptyForm());
  const [editingId, setEditingId] = useState('');
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [resultPicker, setResultPicker] = useState<ResultDatePickerState | null>(null);

  const assigneeMap = useMemo(() => new Map(users.map((item) => [item.id, item])), [users]);
  const assigneeOptions = useMemo<SelectOption[]>(
    () => users.map((item) => ({ value: item.id, label: assigneeLabel(item) })),
    [users],
  );
  const selectedAssigneeOption = assigneeOptions.find((option) => option.value === form.assignee_user_id) || null;
  const selectedFilterAssigneeOption = assigneeOptions.find((option) => option.value === assigneeFilter) || null;
  const monthlyWithholding = Math.trunc((summary.total_amount * 0.033) / 10) * 10;
  const monthlyNet = summary.total_amount - monthlyWithholding;
  const quantity = Math.max(Number(form.quantity) || 1, 1);
  const unitAmount = parseMoney(form.unit_amount);
  const totalAmount = quantity * unitAmount;
  const quantityOptions = Array.from({ length: 20 }, (_, index) => index + 1);

  const load = async () => {
    setLoading(true);
    setError('');
    try {
      const [options, list] = await Promise.all([
        api.videoProduction.options(),
        api.videoProduction.list({ month, assignee_user_id: assigneeFilter, status: statusFilter }),
      ]);
      setUsers(options.users || []);
      setItems(list.items || []);
      setSummary(list.summary || { confirmed_count: 0, short_count: 0, long_count: 0, total_amount: 0 });
      setForm((current) => (
        current.assignee_user_id || !options.users?.[0]
          ? current
          : { ...current, assignee_user_id: preferredAssigneeId(options.users || []) }
      ));
    } catch (err) {
      setError(err instanceof Error ? err.message : '영상제작 의뢰 목록을 불러오지 못했습니다.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (allowed) void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [allowed, month, assigneeFilter, statusFilter]);

  useEffect(() => {
    if (/^\d{4}-\d{2}$/.test(queryMonth || '') && queryMonth !== month) {
      setMonth(queryMonth!);
    }
  }, [queryMonth, month]);

  useEffect(() => {
    if (!queryEditId) return;
    const target = items.find((item) => item.id === queryEditId);
    if (!target) return;
    setEditingId(target.id);
    setForm(itemToForm(target));
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }, [queryEditId, items]);

  if (!allowed) return <Navigate to="/dashboard" replace />;

  const resetForm = () => {
    setEditingId('');
    setForm(emptyForm(preferredAssigneeId(users)));
    if (queryEditId) {
      const next = new URLSearchParams(searchParams);
      next.delete('edit');
      if (!next.get('month')) next.set('month', month);
      setSearchParams(next);
    }
  };

  const updateForm = (patch: Partial<VideoProductionFormState>) => {
    setForm((current) => ({ ...current, ...patch }));
  };

  const handleTypeChange = (videoType: VideoProductionType) => {
    setForm((current) => ({
      ...current,
      video_type: videoType,
      unit_amount: editingId ? current.unit_amount : String(videoProductionDefaultAmount(videoType)),
      amount: editingId ? current.amount : String(videoProductionDefaultAmount(videoType) * (Number(current.quantity) || 1)),
    }));
  };

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!form.assignee_user_id) {
      setError('담당자를 선택해주세요.');
      return;
    }
    setSaving(true);
    setError('');
    try {
      const payload = {
        ...form,
        quantity,
        unit_amount: unitAmount,
        amount: totalAmount,
        provided_date: '',
        submit_due_date: '',
      };
      if (editingId) {
        await api.videoProduction.update(editingId, payload);
      } else {
        await api.videoProduction.create(payload);
      }
      resetForm();
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : '영상제작 의뢰를 저장하지 못했습니다.');
    } finally {
      setSaving(false);
    }
  };

  const edit = (item: VideoProductionRequestItem) => {
    setEditingId(item.id);
    setForm(itemToForm(item));
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const openResultPicker = (item: VideoProductionRequestItem) => {
    setResultPicker({ item, date: item.result_received_date || todayKey() });
  };

  const saveResultDate = async () => {
    if (!resultPicker) return;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(resultPicker.date)) {
      setError('결과물 받은 일자를 선택해 주세요.');
      return;
    }
    const assigneeName = resultPicker.item.assignee_name || assigneeMap.get(resultPicker.item.assignee_user_id)?.name || '담당자';
    if (!window.confirm(`${assigneeName} ${itemTypeLabel(resultPicker.item)} ${Math.max(Number(resultPicker.item.quantity) || 1, 1)}건의 결과물 받은 일자를 ${resultPicker.date}로 확정할까요?`)) return;
    setSaving(true);
    setError('');
    try {
      await api.videoProduction.setResultDate(resultPicker.item.id, resultPicker.date);
      setResultPicker(null);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : '결과물 받은 일자를 저장하지 못했습니다.');
    } finally {
      setSaving(false);
    }
  };

  const clearResultDate = async () => {
    if (!resultPicker) return;
    if (!window.confirm('결과물 받은 일자를 비우고 의뢰 상태로 되돌릴까요? 해당 건은 급여정산에서 제외됩니다.')) return;
    setSaving(true);
    setError('');
    try {
      await api.videoProduction.setResultDate(resultPicker.item.id, '');
      setResultPicker(null);
      await load();
      if (editingId === resultPicker.item.id) resetForm();
    } catch (err) {
      setError(err instanceof Error ? err.message : '결과물 받은 일자를 비우지 못했습니다.');
    } finally {
      setSaving(false);
    }
  };

  const reopen = async (item: VideoProductionRequestItem) => {
    if (!window.confirm('결과물 받은 일자를 비우고 의뢰 상태로 되돌릴까요? 해당 건은 급여정산에서 제외됩니다.')) return;
    setSaving(true);
    setError('');
    try {
      await api.videoProduction.reopen(item.id);
      await load();
      if (editingId === item.id) resetForm();
    } catch (err) {
      setError(err instanceof Error ? err.message : '확정 되돌리기에 실패했습니다.');
    } finally {
      setSaving(false);
    }
  };

  const remove = async (item: VideoProductionRequestItem) => {
    if (!window.confirm('이 영상제작 의뢰를 삭제할까요?')) return;
    setSaving(true);
    setError('');
    try {
      await api.videoProduction.delete(item.id);
      await load();
      if (editingId === item.id) resetForm();
    } catch (err) {
      setError(err instanceof Error ? err.message : '삭제에 실패했습니다.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="page video-production-page">
      <div className="page-header">
        <div>
          <h2><Video size={28} /> 영상제작 의뢰</h2>
          <p>영상 제작 의뢰일과 결과물 수령일을 관리하고, 결과물 받은 일자 기준으로 담당자 프리랜서 정산에 자동 반영합니다.</p>
        </div>
      </div>

      {error && <div className="alert alert-error">{error}</div>}

      <section className="video-production-summary-grid">
        <div className="video-production-summary-card">
          <span>결과물 확정 건수</span>
          <strong>{summary.confirmed_count.toLocaleString('ko-KR')}건</strong>
          <small>숏폼 {summary.short_count}건 · 롱폼 {summary.long_count}건</small>
        </div>
        <div className="video-production-summary-card">
          <span>외주 총액</span>
          <strong>{fmt(summary.total_amount)}</strong>
          <small>결과물 받은 일자 기준 월말 집계</small>
        </div>
        <div className="video-production-summary-card">
          <span>원천징수</span>
          <strong>{fmt(monthlyWithholding)}</strong>
          <small>3.3% · 10원 미만 절사</small>
        </div>
        <div className="video-production-summary-card">
          <span>정산 반영액</span>
          <strong>{fmt(monthlyNet)}</strong>
          <small>급여정산서에서 전체 프리랜서 소득 합계로 일괄 계산</small>
        </div>
      </section>

      <section className="card video-production-editor">
        <div className="video-production-section-title">
          <h3>{editingId ? '영상제작 의뢰 수정' : '영상제작 의뢰 등록'}</h3>
          {editingId && <button type="button" className="btn btn-secondary" onClick={resetForm}>새로 등록</button>}
        </div>

        <form className="video-production-form" onSubmit={submit}>
          <label>
            <span>담당자</span>
            <Select
              options={assigneeOptions}
              value={selectedAssigneeOption}
              onChange={(option: any) => updateForm({ assignee_user_id: option?.value || '' })}
              placeholder="담당자 이름 검색"
              isSearchable
            />
          </label>

          <label>
            <span>유형</span>
            <select value={form.video_type} onChange={(event) => handleTypeChange(event.target.value as VideoProductionType)}>
              <option value="short_form">숏폼 · 기본 30,000원</option>
              <option value="long_form">롱폼 · 기본 200,000원</option>
            </select>
          </label>

          <label>
            <span>건수</span>
            <select value={form.quantity} onChange={(event) => updateForm({ quantity: event.target.value })}>
              {quantityOptions.map((count) => (
                <option key={count} value={String(count)}>{count}건</option>
              ))}
            </select>
          </label>

          <label>
            <span>단가</span>
            <input
              inputMode="numeric"
              value={form.unit_amount}
              onChange={(event) => updateForm({ unit_amount: event.target.value })}
              required
            />
          </label>

          <label>
            <span>의뢰일</span>
            <input type="date" value={form.request_date} onChange={(event) => updateForm({ request_date: event.target.value })} required />
          </label>

          <label>
            <span>계산 금액</span>
            <input value={`${fmt(unitAmount)} × ${quantity.toLocaleString('ko-KR')}건 = ${fmt(totalAmount)}`} readOnly />
          </label>

          <label>
            <span>제목</span>
            <input value={form.title} onChange={(event) => updateForm({ title: event.target.value })} placeholder="예: 9월 숏폼 1건" maxLength={120} />
          </label>

          <label className="video-production-form-wide">
            <span>메모</span>
            <textarea value={form.memo} onChange={(event) => updateForm({ memo: event.target.value })} placeholder="요청사항, 수정사항 등을 기록" maxLength={2000} />
          </label>

          <div className="video-production-form-actions">
            <button type="submit" className="btn btn-primary" disabled={saving}>
              <Plus size={16} /> {saving ? '저장 중...' : editingId ? '수정 저장' : '건수 등록'}
            </button>
          </div>
        </form>
      </section>

      <section className="card video-production-list">
        <div className="video-production-section-title">
          <h3><CalendarDays size={20} /> 월별 의뢰 내역</h3>
          <div className="video-production-filters">
            <input type="month" value={month} onChange={(event) => setMonth(event.target.value)} />
            <Select
              size="sm"
              options={[{ value: '', label: '전체 담당자' }, ...assigneeOptions]}
              value={selectedFilterAssigneeOption || { value: '', label: '전체 담당자' }}
              onChange={(option: any) => setAssigneeFilter(option?.value || '')}
              placeholder="담당자 검색"
              isSearchable
            />
            <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value as VideoProductionStatus | '')}>
              <option value="">전체 상태</option>
              <option value="requested">의뢰</option>
              <option value="confirmed">결과물 확정</option>
            </select>
          </div>
        </div>

        {loading ? (
          <div className="empty-state">영상제작 의뢰를 불러오는 중입니다...</div>
        ) : items.length === 0 ? (
          <div className="empty-state">등록된 영상제작 의뢰가 없습니다.</div>
        ) : (
          <div className="table-responsive">
            <table className="admin-table video-production-table">
              <thead>
                <tr>
                  <th>담당자</th>
                  <th>유형</th>
                  <th>건수</th>
                  <th>상태</th>
                  <th>단가</th>
                  <th>총액</th>
                  <th>의뢰일</th>
                  <th>결과물</th>
                  <th>메모</th>
                  <th>관리</th>
                </tr>
              </thead>
              <tbody>
                {items.map((item) => {
                  const assignee = assigneeMap.get(item.assignee_user_id);
                  const rowQuantity = Math.max(Number(item.quantity) || 1, 1);
                  const rowUnitAmount = Number(item.unit_amount) || Math.trunc((Number(item.amount) || 0) / rowQuantity);
                  return (
                    <tr key={item.id}>
                      <td>
                        <strong>{item.assignee_name || assignee?.name || '-'}</strong>
                        <small>{[item.assignee_branch || assignee?.branch, item.assignee_department || assignee?.department].filter(Boolean).join(' · ')}</small>
                      </td>
                      <td>{itemTypeLabel(item)}</td>
                      <td>{rowQuantity.toLocaleString('ko-KR')}건</td>
                      <td><span className={`video-production-status ${item.status}`}>{item.result_received_date ? '결과물 확정' : VIDEO_PRODUCTION_STATUS_LABELS[item.status] || item.status}</span></td>
                      <td>{fmt(rowUnitAmount)}</td>
                      <td>{fmt(item.amount)}</td>
                      <td>{item.request_date || '-'}</td>
                      <td>
                        <button
                          type="button"
                          className={`video-production-result-button${item.result_received_date ? ' has-date' : ''}`}
                          onClick={() => openResultPicker(item)}
                        >
                          {item.result_received_date || '결과물 일자 기록'}
                        </button>
                      </td>
                      <td>{item.memo || item.title || '-'}</td>
                      <td>
                        <div className="video-production-row-actions">
                          <button type="button" className="btn btn-secondary" onClick={() => edit(item)}><Edit3 size={14} />수정</button>
                          {item.status === 'confirmed' && (
                            <button type="button" className="btn btn-secondary" onClick={() => reopen(item)}><RotateCcw size={14} />결과물 취소</button>
                          )}
                          <button type="button" className="btn btn-danger" onClick={() => remove(item)}><Trash2 size={14} />삭제</button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="video-production-guide">
        <CheckCircle size={18} />
        <p>정산 기준일은 모두 결과물 받은 일자입니다. 리스트의 결과물 칸을 눌러 날짜를 기록하면 해당 월 급여정산서에 반영됩니다.</p>
      </section>

      {resultPicker && (
        <div className="modal-overlay video-production-result-modal" onClick={() => setResultPicker(null)}>
          <div className="modal-content" onClick={(event) => event.stopPropagation()}>
            <div className="modal-header">
              <h3>결과물 받은 일자 기록</h3>
              <button type="button" className="modal-close" onClick={() => setResultPicker(null)}>×</button>
            </div>
            <div className="video-production-result-modal-body">
              <p>
                <strong>{resultPicker.item.assignee_name || assigneeMap.get(resultPicker.item.assignee_user_id)?.name || '담당자'}</strong>
                {' · '}
                {itemTypeLabel(resultPicker.item)}
                {' '}
                {Math.max(Number(resultPicker.item.quantity) || 1, 1).toLocaleString('ko-KR')}건
              </p>
              <label>
                <span>결과물 받은 일자</span>
                <input
                  type="date"
                  value={resultPicker.date}
                  onChange={(event) => setResultPicker((current) => current ? { ...current, date: event.target.value } : current)}
                />
              </label>
              <small>날짜 저장 전 확인 팝업이 한 번 더 표시됩니다. 저장된 날짜가 급여정산 기준일입니다.</small>
            </div>
            <div className="modal-actions">
              {resultPicker.item.result_received_date && (
                <button type="button" className="btn btn-secondary" disabled={saving} onClick={clearResultDate}>일자 비우기</button>
              )}
              <button type="button" className="btn btn-secondary" disabled={saving} onClick={() => setResultPicker(null)}>닫기</button>
              <button type="button" className="btn btn-primary" disabled={saving} onClick={saveResultDate}>결과물 일자 저장</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
