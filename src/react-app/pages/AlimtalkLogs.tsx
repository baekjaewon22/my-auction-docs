import { useEffect, useState } from 'react';
import { api } from '../api';
import { MessageSquare, Search, CheckCircle, XCircle, Clock } from 'lucide-react';

interface LogEntry {
  id: string;
  template_code: string;
  recipient_phone: string;
  recipient_name?: string;
  content: string;
  request_id: string;
  status: string;
  error_message?: string;
  related_type?: string;
  created_at: string;
}

const TEMPLATE_LABELS: Record<string, string> = {
  SIGNUP: '회원가입 인증',
  signup2: '회원가입 승인',
  DOC: '문서 제출',
  docstep: '단계 승인',
  docfinal: '최종 승인',
  docre: '문서 반려',
  shared: '회의록 공유',
  chong: '입금 매칭',
};

const STATUS_CONFIG: Record<string, { label: string; color: string; bg: string; icon: typeof CheckCircle }> = {
  sent: { label: '발송완료', color: '#188038', bg: '#e8f5e9', icon: CheckCircle },
  pending: { label: '대기중', color: '#e65100', bg: '#fff3e0', icon: Clock },
  failed: { label: '실패', color: '#d93025', bg: '#fce4ec', icon: XCircle },
  skipped: { label: '스킵', color: '#9aa0a6', bg: '#f5f5f5', icon: XCircle },
};

function maskPhone(phone: string) {
  if (!phone || phone.length < 8) return phone;
  return phone.slice(0, 3) + '****' + phone.slice(-4);
}

function formatDate(iso: string) {
  if (!iso) return '';
  const d = new Date(iso);
  return d.toLocaleString('ko-KR', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
}

export default function AlimtalkLogs() {
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [searchInput, setSearchInput] = useState('');
  const [filterTemplate, setFilterTemplate] = useState('');
  const [, setCategories] = useState<{ code: string; label: string }[]>([]);

  const load = async () => {
    setLoading(true);
    try {
      const res = await api.alimtalk.logs({ template: filterTemplate || undefined, search: search || undefined, limit: 200 });
      setLogs(res.logs || []);
    } catch { /* */ }
    setLoading(false);
  };

  useEffect(() => {
    api.alimtalk.status().then(res => setCategories(res.categories || [])).catch(() => {});
  }, []);

  useEffect(() => { load(); }, [filterTemplate, search]);

  const handleSearch = () => setSearch(searchInput.trim());

  if (loading && logs.length === 0) return <div className="page-loading">로딩중...</div>;

  return (
    <div className="page">
      <div className="page-header">
        <h2><MessageSquare size={20} style={{ marginRight: 6, verticalAlign: 'middle' }} />카카오 발송내역</h2>
      </div>

      <div style={{ display: 'flex', gap: 10, marginBottom: 16, flexWrap: 'wrap', alignItems: 'center' }}>
        <select className="form-input" value={filterTemplate} onChange={(e) => setFilterTemplate(e.target.value)}
          style={{ padding: '6px 10px', fontSize: '0.82rem', minWidth: 150 }}>
          <option value="">전체 템플릿</option>
          {Object.entries(TEMPLATE_LABELS).map(([code, label]) => (
            <option key={code} value={code}>{label}</option>
          ))}
        </select>
        <div style={{ display: 'flex', gap: 4, flex: 1, maxWidth: 320 }}>
          <input className="form-input" value={searchInput} onChange={(e) => setSearchInput(e.target.value)}
            placeholder="이름, 전화번호, 내용 검색..."
            onKeyDown={(e) => { if (e.key === 'Enter') handleSearch(); }}
            style={{ flex: 1, padding: '6px 10px', fontSize: '0.82rem' }} />
          <button className="btn btn-primary btn-sm" onClick={handleSearch}><Search size={14} /></button>
        </div>
        <span style={{ fontSize: '0.75rem', color: '#9aa0a6' }}>{logs.length}건</span>
      </div>

      {logs.length === 0 ? (
        <div className="empty-state" style={{ padding: 40 }}>발송 내역이 없습니다.</div>
      ) : (
        <div className="alimtalk-log-list">
          <div className="alimtalk-log-header">
            <span>상태</span>
            <span>템플릿</span>
            <span>수신자</span>
            <span>내용</span>
            <span>발송일시</span>
          </div>
          {logs.map(log => {
            const cfg = STATUS_CONFIG[log.status] || STATUS_CONFIG.pending;
            const Icon = cfg.icon;
            return (
              <div key={log.id} className="alimtalk-log-row">
                <span>
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, padding: '2px 8px', borderRadius: 8, fontSize: '0.72rem', fontWeight: 600, background: cfg.bg, color: cfg.color }}>
                    <Icon size={11} /> {cfg.label}
                  </span>
                </span>
                <span style={{ fontSize: '0.78rem', fontWeight: 500 }}>
                  {TEMPLATE_LABELS[log.template_code] || log.template_code}
                </span>
                <span style={{ fontSize: '0.78rem' }}>
                  {log.recipient_name && <strong>{log.recipient_name}</strong>}
                  {log.recipient_name && <br />}
                  <span style={{ color: '#9aa0a6', fontSize: '0.72rem' }}>{maskPhone(log.recipient_phone)}</span>
                </span>
                <span className="alimtalk-log-content" title={log.content}>
                  {log.content.length > 60 ? log.content.slice(0, 60) + '...' : log.content}
                </span>
                <span style={{ fontSize: '0.72rem', color: '#5f6368' }}>{formatDate(log.created_at)}</span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
