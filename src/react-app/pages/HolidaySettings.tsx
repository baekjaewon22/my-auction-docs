import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { CalendarDays, Plus, Save, Trash2 } from 'lucide-react';
import { api } from '../api';
import { useAuthStore } from '../store';

type HolidayForm = {
  id?: string;
  holiday_date: string;
  name: string;
  holiday_type: 'legal' | 'substitute' | 'temporary' | 'company';
  applies_to: 'all' | 'journal' | 'leave' | 'statistics';
  enabled: boolean;
  memo: string;
};

const emptyForm = (year: string): HolidayForm => ({
  holiday_date: `${year}-`,
  name: '',
  holiday_type: 'legal',
  applies_to: 'all',
  enabled: true,
  memo: '',
});

const typeLabels: Record<HolidayForm['holiday_type'], string> = {
  legal: '법정공휴일',
  substitute: '대체공휴일',
  temporary: '임시공휴일',
  company: '회사휴무일',
};

const appliesToLabels: Record<HolidayForm['applies_to'], string> = {
  all: '전체',
  journal: '컨설턴트 일지',
  leave: '연차관리',
  statistics: '통계',
};

function currentKstYear(): string {
  return String(new Date(Date.now() + 9 * 60 * 60 * 1000).getUTCFullYear());
}

export default function HolidaySettings() {
  const { user } = useAuthStore();
  const [year, setYear] = useState(currentKstYear());
  const [holidays, setHolidays] = useState<any[]>([]);
  const [form, setForm] = useState<HolidayForm>(() => emptyForm(currentKstYear()));
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const canEdit = ['master', 'ceo', 'admin'].includes(user?.role || '');
  const yearOptions = useMemo(() => {
    const base = Number(currentKstYear());
    return [base - 1, base, base + 1, base + 2].map(String);
  }, []);

  const load = async () => {
    setLoading(true);
    setError('');
    try {
      const result = await api.system.holidays(year);
      setHolidays(result.holidays || []);
    } catch (err: any) {
      setError(err.message || '공휴일 목록을 불러오지 못했습니다.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
    setForm((prev) => (prev.id ? prev : emptyForm(year)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [year]);

  const resetForm = () => setForm(emptyForm(year));

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!canEdit) return;
    setSaving(true);
    setError('');
    try {
      const payload = {
        holiday_date: form.holiday_date,
        name: form.name,
        holiday_type: form.holiday_type,
        applies_to: form.applies_to,
        enabled: form.enabled ? 1 : 0,
        memo: form.memo,
      };
      if (form.id) await api.system.updateHoliday(form.id, payload);
      else await api.system.createHoliday(payload);
      resetForm();
      await load();
    } catch (err: any) {
      setError(err.message || '공휴일 설정을 저장하지 못했습니다.');
    } finally {
      setSaving(false);
    }
  };

  const edit = (holiday: any) => {
    setForm({
      id: holiday.id,
      holiday_date: holiday.holiday_date || '',
      name: holiday.name || '',
      holiday_type: holiday.holiday_type || 'legal',
      applies_to: holiday.applies_to || 'all',
      enabled: holiday.enabled !== 0,
      memo: holiday.memo || '',
    });
  };

  const remove = async (holiday: any) => {
    if (!canEdit || !window.confirm(`${holiday.holiday_date} ${holiday.name} 설정을 삭제할까요?`)) return;
    setSaving(true);
    setError('');
    try {
      await api.system.deleteHoliday(holiday.id);
      if (form.id === holiday.id) resetForm();
      await load();
    } catch (err: any) {
      setError(err.message || '공휴일 설정을 삭제하지 못했습니다.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <h2>공휴일 관리</h2>
          <p className="management-support-subtitle">법정공휴일, 대체공휴일, 임시공휴일을 사이트 기준일 계산에 반영합니다.</p>
        </div>
      </div>

      <div className="toolbar" style={{ marginBottom: 16 }}>
        <label className="form-label" style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
          기준연도
          <select className="form-input" value={year} onChange={(event) => setYear(event.target.value)} style={{ width: 140 }}>
            {yearOptions.map((option) => <option key={option} value={option}>{option}년</option>)}
          </select>
        </label>
      </div>

      <form className="card holiday-settings-card" onSubmit={submit} style={{ marginBottom: 16 }}>
        <div className="card-header">
          <h3>{form.id ? '공휴일 수정' : '공휴일 추가'}</h3>
          {form.id && <button type="button" className="btn btn-secondary" onClick={resetForm}>신규 입력</button>}
        </div>
        <div className="holiday-settings-form">
          <label className="form-label">
            날짜
            <input className="form-input" type="date" value={form.holiday_date} disabled={!canEdit} onChange={(event) => setForm({ ...form, holiday_date: event.target.value })} />
          </label>
          <label className="form-label">
            이름
            <input className="form-input" value={form.name} disabled={!canEdit} placeholder="예: 제8회 전국동시지방선거" onChange={(event) => setForm({ ...form, name: event.target.value })} />
          </label>
          <label className="form-label">
            구분
            <select className="form-input" value={form.holiday_type} disabled={!canEdit} onChange={(event) => setForm({ ...form, holiday_type: event.target.value as HolidayForm['holiday_type'] })}>
              {Object.entries(typeLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </select>
          </label>
          <label className="form-label">
            적용범위
            <select className="form-input" value={form.applies_to} disabled={!canEdit} onChange={(event) => setForm({ ...form, applies_to: event.target.value as HolidayForm['applies_to'] })}>
              {Object.entries(appliesToLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </select>
          </label>
          <label className="form-label">
            메모
            <input className="form-input" value={form.memo} disabled={!canEdit} placeholder="필요 시 내부 메모" onChange={(event) => setForm({ ...form, memo: event.target.value })} />
          </label>
          <label className="form-label" style={{ justifyContent: 'flex-end' }}>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8, minHeight: 40 }}>
              <input type="checkbox" checked={form.enabled} disabled={!canEdit} onChange={(event) => setForm({ ...form, enabled: event.target.checked })} />
              사용
            </span>
          </label>
        </div>
        <div className="form-actions">
          <button type="submit" className="btn btn-primary" disabled={!canEdit || saving}>
            {form.id ? <Save size={16} /> : <Plus size={16} />}
            {saving ? '저장 중' : form.id ? '수정 저장' : '추가'}
          </button>
        </div>
      </form>

      {error && <div className="alert alert-error" style={{ marginBottom: 16 }}>{error}</div>}

      <div className="card holiday-settings-card">
        <div className="card-header">
          <h3><CalendarDays size={18} /> {year}년 공휴일</h3>
          <span className="muted">{loading ? '불러오는 중' : `${holidays.length}건`}</span>
        </div>
        <div className="table-wrapper">
          <table className="data-table">
            <thead>
              <tr>
                <th>날짜</th>
                <th>이름</th>
                <th>구분</th>
                <th>적용범위</th>
                <th>상태</th>
                <th>메모</th>
                {canEdit && <th>관리</th>}
              </tr>
            </thead>
            <tbody>
              {!loading && holidays.length === 0 && (
                <tr><td colSpan={canEdit ? 7 : 6} className="empty-cell">등록된 공휴일이 없습니다.</td></tr>
              )}
              {holidays.map((holiday) => (
                <tr key={holiday.id}>
                  <td>{holiday.holiday_date}</td>
                  <td className="holiday-settings-ellipsis" title={holiday.name}>{holiday.name}</td>
                  <td>{typeLabels[holiday.holiday_type as HolidayForm['holiday_type']] || holiday.holiday_type}</td>
                  <td>{appliesToLabels[holiday.applies_to as HolidayForm['applies_to']] || holiday.applies_to}</td>
                  <td>{holiday.enabled === 0 ? '미사용' : '사용'}</td>
                  <td className="holiday-settings-ellipsis" title={holiday.memo || ''}>{holiday.memo || '-'}</td>
                  {canEdit && (
                    <td>
                      <div className="inline-actions">
                        <button type="button" className="btn btn-sm btn-secondary" onClick={() => edit(holiday)}>수정</button>
                        <button type="button" className="btn btn-sm btn-danger" onClick={() => remove(holiday)} disabled={saving}>
                          <Trash2 size={14} /> 삭제
                        </button>
                      </div>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
