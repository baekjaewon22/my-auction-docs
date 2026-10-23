import { useRef, useState } from 'react';
import { api } from '../api';
import type { SalesRecord } from '../types';
import { PROXY_UNDECIDED_WARNING, validateSalesProxy } from '../../shared/sales-proxy';

export type ProxyForm = { proxy_agent: string; proxy_date: string; proxy_undecided: boolean };
export function SalesProxyFields({ value, onChange, disabled = false }: { value: ProxyForm; onChange: (value: ProxyForm) => void; disabled?: boolean }) {
  return <fieldset disabled={disabled} style={{ border: 0, padding: 0, margin: '12px 0' }}>
    <label style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 10 }}>
      <input type="checkbox" checked={value.proxy_undecided} onChange={e => {
        onChange({ ...value, proxy_undecided: e.target.checked });
        if (e.target.checked) alert(PROXY_UNDECIDED_WARNING);
      }} />대리인·대리일 미정
    </label>
    <div className="mobile-stack-grid" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
      <label className="form-label">대리인{!value.proxy_undecided && ' *'}
        <input className="form-input" type="text" maxLength={100} required={!value.proxy_undecided} value={value.proxy_agent} placeholder="대리인 이름 입력" onChange={e => onChange({ ...value, proxy_agent: e.target.value })} />
      </label>
      <label className="form-label">대리일{!value.proxy_undecided && ' *'}
        <input className="form-input" type="date" min="2000-01-01" max="2099-12-31" required={!value.proxy_undecided} value={value.proxy_date} onChange={e => onChange({ ...value, proxy_date: e.target.value })} />
      </label>
    </div>
    {value.proxy_undecided && <p role="status" style={{ marginBottom: 0 }}>⚠ 정해지는 즉시 미정을 해제하고 대리인·대리일을 수정해 주세요. 미정 건은 Slack 알림에서 제외됩니다.</p>}
  </fieldset>;
}

export function SalesProxyEditor({ record, canEdit, onSaved }: { record: SalesRecord; canEdit: boolean; onSaved: (value: ProxyForm) => void }) {
  const [value, setValue] = useState<ProxyForm>({ proxy_agent: record.proxy_agent || '', proxy_date: record.proxy_date || '', proxy_undecided: record.proxy_undecided !== 0 });
  const [busy, setBusy] = useState(false);
  const lock = useRef(false);
  async function save() {
    if (lock.current) return;
    try {
      validateSalesProxy(value);
      if (value.proxy_undecided && !confirm(PROXY_UNDECIDED_WARNING + '\n\n미정으로 저장하시겠습니까?')) return;
      lock.current = true; setBusy(true);
      await api.sales.updateProxy(record.id, value);
      onSaved(value);
      alert('대리 정보를 저장했습니다.');
    } catch (error) { alert(error instanceof Error ? error.message : '저장하지 못했습니다.'); }
    finally { lock.current = false; setBusy(false); }
  }
  return <section style={{ margin: '16px 0', padding: 16, border: '1px solid var(--border-color, #c8d6e5)', borderRadius: 8 }}>
    <h4 style={{ margin: 0 }}>매수신청 대리 정보</h4>
    <SalesProxyFields value={value} onChange={setValue} disabled={!canEdit || busy} />
    {canEdit && <button type="button" className="btn btn-primary" disabled={busy} onClick={() => void save()}>{busy ? '저장 중…' : '대리 정보 저장'}</button>}
  </section>;
}
