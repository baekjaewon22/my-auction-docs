import { useEffect, useMemo, useState } from 'react';
import { Activity, AlertTriangle, CheckCircle2, ChevronDown, ChevronUp, RefreshCw, Users } from 'lucide-react';
import { api, type AutomationDiagnosticConsultant, type AutomationGenerationLog } from '../api';

const STATUS_LABEL = { open: '확인 필요', reviewed: '검토 중', resolved: '조치 완료' } as const;

function formatDate(value: string) {
  if (!value) return '-';
  return new Date(`${value.replace(' ', 'T')}Z`).toLocaleString('ko-KR');
}

export default function AutomationDiagnosticsAdmin() {
  const [items, setItems] = useState<AutomationGenerationLog[]>([]);
  const [consultants, setConsultants] = useState<AutomationDiagnosticConsultant[]>([]);
  const [consultantId, setConsultantId] = useState('');
  const [reviewStatus, setReviewStatus] = useState('');
  const [expanded, setExpanded] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = async () => {
    setLoading(true);
    setError('');
    try {
      const res = await api.automationDiagnostics.list({ user_id: consultantId, review_status: reviewStatus, limit: 300 });
      setItems(res.items || []);
      setConsultants(res.consultants || []);
    } catch (err: any) {
      setError(err?.message || '진단 이력을 불러오지 못했습니다.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, [consultantId, reviewStatus]);

  const summary = useMemo(() => ({
    total: items.length,
    issues: items.filter((item) => item.issue_count > 0 || !item.success).length,
    open: items.filter((item) => item.review_status !== 'resolved').length,
  }), [items]);

  const updateReview = async (item: AutomationGenerationLog, status: AutomationGenerationLog['review_status']) => {
    const note = status === 'open' ? '' : window.prompt('검토 또는 조치 내용을 입력해 주세요.', item.review_note || '') ?? item.review_note;
    await api.automationDiagnostics.update(item.id, { review_status: status, review_note: note });
    await load();
  };

  return (
    <div className="page automation-admin-page">
      <div className="page-header automation-admin-header">
        <div>
          <h2><Activity size={22} /> 업무 자동화 통합 진단</h2>
          <p>담당 컨설턴트별 PPT 생성·다운로드 이력과 실행 PC의 오류 진단을 확인합니다.</p>
        </div>
        <button className="btn btn-secondary" onClick={load} disabled={loading}><RefreshCw size={16} /> 새로고침</button>
      </div>

      <div className="automation-admin-summary">
        <div><Activity /><span>조회 이력<strong>{summary.total}</strong></span></div>
        <div className="warning"><AlertTriangle /><span>오류·경고<strong>{summary.issues}</strong></span></div>
        <div className="pending"><Users /><span>미완료 검토<strong>{summary.open}</strong></span></div>
      </div>

      <section className="automation-admin-panel">
        <div className="automation-admin-filters">
          <label>담당 컨설턴트
            <select value={consultantId} onChange={(e) => setConsultantId(e.target.value)}>
              <option value="">전 인원</option>
              {consultants.map((person) => <option key={person.id} value={person.id}>{person.name} · {person.branch || person.department || '소속 미지정'}</option>)}
            </select>
          </label>
          <label>조치 상태
            <select value={reviewStatus} onChange={(e) => setReviewStatus(e.target.value)}>
              <option value="">전체 상태</option><option value="open">확인 필요</option><option value="reviewed">검토 중</option><option value="resolved">조치 완료</option>
            </select>
          </label>
          <span className="automation-local-notice">PPT 파일은 생성한 PC에 보관되며, 서버에는 이력과 진단만 안전하게 저장됩니다.</span>
        </div>

        {error && <div className="alert alert-error">{error}</div>}
        {loading ? <div className="page-loading">진단 이력을 불러오는 중입니다.</div> : items.length === 0 ? (
          <div className="automation-admin-empty">선택한 조건에 해당하는 생성 이력이 없습니다.</div>
        ) : (
          <div className="automation-admin-list">
            {items.map((item) => {
              const isOpen = expanded === item.id;
              return <article key={item.id} className={`automation-admin-row ${item.issue_count || !item.success ? 'has-issues' : ''}`}>
                <button className="automation-admin-row-main" onClick={() => setExpanded(isOpen ? '' : item.id)}>
                  <span className={`automation-result-icon ${item.success && !item.issue_count ? 'ok' : 'issue'}`}>{item.success && !item.issue_count ? <CheckCircle2 /> : <AlertTriangle />}</span>
                  <span className="consultant"><strong>{item.consultant_name || '알 수 없는 담당자'}</strong><small>{[item.branch, item.department, item.position_title].filter(Boolean).join(' · ') || '-'}</small></span>
                  <span className="file"><strong>{item.file_name || (item.output_type === 'rights_certificate' ? '권리분석 보증서' : '브리핑 자료')}</strong><small>{item.task_id}</small></span>
                  <span><strong>{item.issue_count}건</strong><small>오류·경고</small></span>
                  <span><strong>{item.agent_version || '-'}</strong><small>실행기 버전</small></span>
                  <span><strong>{formatDate(item.created_at)}</strong><small>생성 시각</small></span>
                  <span className={`review-badge ${item.review_status}`}>{STATUS_LABEL[item.review_status]}</span>
                  {isOpen ? <ChevronUp /> : <ChevronDown />}
                </button>
                {isOpen && <div className="automation-admin-detail">
                  <div className="automation-admin-diagnostics">
                    {item.diagnostics.length ? item.diagnostics.map((diagnostic, index) => <div key={`${diagnostic.section}-${index}`} className={diagnostic.status}>
                      <strong>[{diagnostic.status.toUpperCase()}] {diagnostic.section}</strong><span>{diagnostic.message}</span>
                    </div>) : <p>세부 진단 항목이 기록되지 않았습니다.</p>}
                  </div>
                  {item.review_note && <p className="automation-review-note"><strong>마스터 메모</strong>{item.review_note}</p>}
                  <div className="automation-review-actions">
                    <button className="btn btn-secondary" onClick={() => updateReview(item, 'open')}>확인 필요</button>
                    <button className="btn btn-secondary" onClick={() => updateReview(item, 'reviewed')}>검토 중</button>
                    <button className="btn btn-primary" onClick={() => updateReview(item, 'resolved')}>조치 완료</button>
                  </div>
                </div>}
              </article>;
            })}
          </div>
        )}
      </section>
    </div>
  );
}
