import { useEffect, useState } from 'react';
import { X, Cloud, CheckCircle, AlertCircle, Settings, History, Play, Link as LinkIcon, Loader, Unlink, Send } from 'lucide-react';
import { api } from '../api';

const FOLDER_PRESETS: { label: string; pattern: string }[] = [
  { label: '월별', pattern: '{yyyy-mm}' },
  { label: '지사 + 월별', pattern: '{branch}/{yyyy-mm}' },
  { label: '년도 + 지사', pattern: '{yyyy}/{branch}' },
  { label: '지사 + 팀 + 월', pattern: '{branch}/{department}/{yyyy-mm}' },
];

const FILENAME_PRESETS: { label: string; pattern: string }[] = [
  { label: '승인일 + 유형 + 담당자', pattern: '[{yyyy-mm-dd}] {doc_type} {author} {position}' },
  { label: '표준 (고객명)', pattern: '[{yyyy-mm-dd}] {client_name} {title}' },
  { label: '승인일 + 유형', pattern: '[{yyyy-mm-dd}] {doc_type} {title}' },
  { label: '제목만', pattern: '{title}' },
];

export default function DriveBackupModal({ onClose }: { onClose: () => void }) {
  const [loading, setLoading] = useState(true);
  const [settings, setSettings] = useState<any>(null);
  const [pendingCount, setPendingCount] = useState(0);
  const [lastBackupAt, setLastBackupAt] = useState<string | null>(null);
  const [failedLast7d, setFailedLast7d] = useState(0);
  const [logs, setLogs] = useState<any[]>([]);
  const [logsOpen, setLogsOpen] = useState(false);
  const [running, setRunning] = useState(false);
  const [folderPattern, setFolderPattern] = useState('{yyyy-mm}/{branch}');
  const [filenamePattern, setFilenamePattern] = useState('[{yyyy-mm-dd}] {doc_type} {author} {position}');
  const [rootName, setRootName] = useState('마이옥션 문서백업');
  const [saving, setSaving] = useState(false);
  const [runResult, setRunResult] = useState<string>('');
  // 테스트 발송
  const [pendingDocs, setPendingDocs] = useState<any[]>([]);
  const [testTargetId, setTestTargetId] = useState<string>('');
  const [testSending, setTestSending] = useState(false);
  const [testResult, setTestResult] = useState<{ status: 'success' | 'failed'; title: string; folder?: string; error?: string } | null>(null);
  // 실행 결과 상세 + 에러 요약
  const [runDetails, setRunDetails] = useState<Array<{ id: string; title: string; status: 'success' | 'failed'; folder?: string; error?: string }>>([]);
  const [errorSummary, setErrorSummary] = useState<Array<{ category: string; cnt: number; sample_message: string }>>([]);
  const [retrying, setRetrying] = useState(false);
  // 수동 실행 시 처리 건수 (5/15/30/50)
  const [runLimit, setRunLimit] = useState<number>(5);

  const load = () => {
    setLoading(true);
    Promise.all([
      api.drive.settings().catch(() => null),
      api.drive.logs(30).catch(() => ({ logs: [] })),
      api.drive.pending().catch(() => ({ documents: [] })),
      api.drive.errorSummary().catch(() => ({ summary: [] })),
    ]).then(([s, l, p, es]: any) => {
      setPendingDocs(p?.documents || []);
      setSettings(s);
      setLastBackupAt(s?.last_backup_at || null);
      setPendingCount(s?.pending_count || 0);
      setFailedLast7d(s?.failed_last_7d || 0);
      setLogs(l?.logs || []);
      setErrorSummary(es?.summary || []);
      if (s?.settings) {
        setFolderPattern(s.settings.folder_pattern || '{yyyy-mm}/{branch}');
        setFilenamePattern(s.settings.filename_pattern || '[{yyyy-mm-dd}] {doc_type} {author} {position}');
        setRootName(s.settings.root_folder_name || '마이옥션 문서백업');
      }
    }).finally(() => setLoading(false));
  };
  useEffect(load, []);

  const connected = !!settings?.settings?.connected;
  const connectedEmail = settings?.settings?.connected_email || '';
  const autoEnabled = !!settings?.settings?.auto_enabled;
  const lastCronStatus = settings?.settings?.last_cron_status;
  const lastCronSummary = settings?.settings?.last_cron_summary;
  const lastCronRunAt = settings?.settings?.last_cron_run_at;

  const handleConnect = async () => {
    try {
      const res = await api.drive.oauthStart();
      if (!res?.url) {
        alert('OAuth 시작 URL을 받지 못했습니다.');
        return;
      }
      // 인증된 fetch로 state 쿠키 설정 + Google 인증 URL 획득 → 전체 페이지 navigation
      window.location.href = res.url;
    } catch (err: any) {
      alert('연결 시작 실패: ' + (err?.message || err));
    }
  };

  const handleDisconnect = async () => {
    if (!confirm('Google Drive 연결을 해제하시겠습니까?\n해제 후 자동 백업이 중단됩니다.')) return;
    await api.drive.disconnect();
    load();
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      await api.drive.saveSettings({
        folder_pattern: folderPattern,
        filename_pattern: filenamePattern,
        root_folder_name: rootName,
      });
      alert('설정 저장 완료');
      load();
    } catch (err: any) { alert(err.message); }
    finally { setSaving(false); }
  };

  const handleToggleAuto = async (val: boolean) => {
    await api.drive.saveSettings({ auto_enabled: val });
    load();
  };

  const handleRunNow = async () => {
    const estMinutes = Math.ceil((runLimit * 12) / 60); // 1건당 ~12초 추정
    const warnMsg = runLimit >= 30
      ? `\n\n⚠️ 약 ${estMinutes}분 소요 예정. 처리 중 페이지를 닫지 마세요.\n(닫아도 백엔드는 계속 처리되지만 결과를 못 봅니다)`
      : '';
    if (!confirm(`지금 즉시 백업 배치를 실행하시겠습니까? (${runLimit}건)${warnMsg}`)) return;
    setRunning(true);
    setRunResult('');
    setRunDetails([]);
    try {
      const r: any = await api.drive.runNow(runLimit);
      setRunResult(`처리 ${r.processed}건 · 성공 ${r.success} · 실패 ${r.failed}${r.error ? ` · 오류: ${r.error}` : ''}`);
      setRunDetails(r.details || []);
      load();
    } catch (err: any) {
      setRunResult(`오류: ${err.message}`);
    } finally { setRunning(false); }
  };

  const handleRetryAllFailed = async () => {
    if (!confirm('이전에 실패한 문서들의 실패 로그를 모두 삭제하고 다음 실행 시 재시도하도록 큐에 다시 넣을까요?\n(코드 수정 이후 다시 시도하기 위함)')) return;
    setRetrying(true);
    try {
      const r = await api.drive.retryFailed({ all: true });
      alert(`실패 로그 ${r.deleted || 0}건 정리 완료. "지금 실행"으로 재시도하세요.`);
      load();
    } catch (err: any) { alert('재시도 준비 실패: ' + err.message); }
    finally { setRetrying(false); }
  };

  const handleTestSend = async () => {
    if (!testTargetId) { alert('테스트 대상 문서를 선택하세요.'); return; }
    setTestSending(true);
    setTestResult(null);
    try {
      const r: any = await api.drive.testSend([testTargetId]);
      const d = r.details?.[0];
      if (d) {
        setTestResult({
          status: d.status,
          title: d.title,
          folder: d.folder,
          error: d.error,
        });
      } else {
        setTestResult({
          status: 'failed',
          title: '',
          error: r.error || '상세 정보를 받지 못했습니다.',
        });
      }
      load();
    } catch (err: any) {
      setTestResult({ status: 'failed', title: '', error: err.message });
    } finally { setTestSending(false); }
  };

  // 문서 유형별 그룹핑 — 각 유형의 첫 문서를 대표로 선택 가능
  const groupedDocs = (() => {
    const groups: Record<string, any[]> = {};
    pendingDocs.forEach(d => {
      const key = d.template_name || d.title || '기타';
      if (!groups[key]) groups[key] = [];
      groups[key].push(d);
    });
    return groups;
  })();

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content" onClick={e => e.stopPropagation()} style={{ maxWidth: 780, width: '95%', maxHeight: '92vh', overflowY: 'auto' }}>
        <div className="modal-header">
          <h3 style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <Cloud size={22} /> Google Drive 자동 백업
          </h3>
          <button className="modal-close" onClick={onClose}><X size={20} /></button>
        </div>

        {loading ? (
          <div style={{ padding: 40, textAlign: 'center' }}><Loader className="spin" size={24} /> 불러오는 중...</div>
        ) : (
          <div style={{ padding: 20 }}>
            {/* 연결 상태 카드 */}
            <div style={{
              padding: 16, borderRadius: 8, marginBottom: 16,
              background: connected ? '#e6f4ea' : '#fce8e6',
              border: `1px solid ${connected ? '#c3e6cb' : '#f5c6cb'}`,
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                {connected
                  ? <CheckCircle size={22} color="#188038" />
                  : <AlertCircle size={22} color="#d93025" />}
                <div style={{ flex: 1 }}>
                  <div style={{ fontWeight: 700, fontSize: 15 }}>
                    {connected ? `연결됨: ${connectedEmail}` : '연결되지 않음'}
                  </div>
                  <div style={{ fontSize: 12, color: '#5f6368', marginTop: 2 }}>
                    {connected
                      ? autoEnabled ? '매주 토요일 새벽 자동 백업 활성' : '자동 백업 비활성 (토글 OFF)'
                      : 'Google 계정을 한 번 연결하면 이후 자동으로 백업됩니다'}
                  </div>
                </div>
                {connected ? (
                  <button className="btn btn-sm" onClick={handleDisconnect} style={{ color: '#d93025', borderColor: '#d93025' }}>
                    <Unlink size={14} /> 연결 해제
                  </button>
                ) : (
                  <button className="btn btn-primary btn-sm" onClick={handleConnect}>
                    <LinkIcon size={14} /> Google 계정 연결
                  </button>
                )}
              </div>
            </div>

            {connected && (
              <>
                {/* 통계 */}
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 10, marginBottom: 16 }}>
                  <StatCard label="백업 대기" value={pendingCount} color="#e65100" />
                  <StatCard label="최근 7일 실패" value={failedLast7d} color={failedLast7d > 0 ? '#d93025' : '#188038'} />
                  <StatCard
                    label="최근 실행"
                    value={lastCronRunAt ? new Date(lastCronRunAt).toLocaleDateString('ko-KR') : '-'}
                    subText={lastCronStatus ? lastCronSummary : ''}
                    color="#1a73e8"
                  />
                  <StatCard
                    label="마지막 성공 백업"
                    value={lastBackupAt ? new Date(lastBackupAt).toLocaleDateString('ko-KR') : '-'}
                    color="#188038"
                  />
                </div>

                {/* 자동 백업 토글 + 즉시 실행 */}
                <div style={{ display: 'flex', gap: 8, marginBottom: 16, alignItems: 'center', flexWrap: 'wrap' }}>
                  <label style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer' }}>
                    <input type="checkbox" checked={autoEnabled} onChange={e => handleToggleAuto(e.target.checked)} />
                    <span style={{ fontSize: 14 }}>자동 백업 (30분마다 5건씩)</span>
                  </label>
                  <div style={{ flex: 1 }} />
                  <select
                    value={runLimit}
                    onChange={(e) => setRunLimit(parseInt(e.target.value, 10))}
                    disabled={running}
                    style={{ fontSize: 12, padding: '4px 8px', borderRadius: 4, border: '1px solid #dadce0' }}
                  >
                    <option value={5}>5건 (안전)</option>
                    <option value={15}>15건</option>
                    <option value={30}>30건 (권장 대량)</option>
                    <option value={50}>50건 (최대)</option>
                  </select>
                  <button className="btn btn-primary btn-sm" onClick={handleRunNow} disabled={running || pendingCount === 0}>
                    {running ? <><Loader size={14} className="spin" /> 실행 중...</> : <><Play size={14} /> 지금 실행 ({runLimit}건)</>}
                  </button>
                </div>

                {runResult && (
                  <div style={{ padding: 10, background: '#f1f3f4', borderRadius: 6, fontSize: 13, marginBottom: 16 }}>
                    {runResult}
                  </div>
                )}

                {/* 실행 결과 상세 — 실패 건 별 에러 메시지 */}
                {runDetails.filter(d => d.status === 'failed').length > 0 && (
                  <details open style={{ marginBottom: 16, padding: 10, background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 6 }}>
                    <summary style={{ cursor: 'pointer', fontWeight: 600, fontSize: 13, color: '#991b1b' }}>
                      실패 건 상세 ({runDetails.filter(d => d.status === 'failed').length}건)
                    </summary>
                    <div style={{ marginTop: 8, maxHeight: 200, overflowY: 'auto', fontSize: 11 }}>
                      {runDetails.filter(d => d.status === 'failed').map(d => (
                        <div key={d.id} style={{ padding: '4px 0', borderBottom: '1px solid #fee2e2' }}>
                          <div style={{ fontWeight: 600 }}>{d.title}</div>
                          <code style={{ color: '#991b1b', fontSize: 10, wordBreak: 'break-all' }}>{d.error}</code>
                        </div>
                      ))}
                    </div>
                  </details>
                )}

                {/* 누적 에러 패턴 요약 (최근 7일) + 재시도 버튼 */}
                {errorSummary.length > 0 && (
                  <div style={{ marginBottom: 16, padding: 10, background: '#fff7ed', border: '1px solid #fdba74', borderRadius: 6 }}>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
                      <strong style={{ fontSize: 13, color: '#9a3412' }}>실패 패턴 분석 (최근 7일)</strong>
                      <button
                        className="btn btn-sm"
                        onClick={handleRetryAllFailed}
                        disabled={retrying}
                        style={{ fontSize: 11, padding: '4px 10px', background: '#dc2626', color: '#fff', border: 'none' }}
                      >
                        {retrying ? '정리 중...' : '실패 로그 초기화 + 재시도 허용'}
                      </button>
                    </div>
                    <div style={{ fontSize: 12 }}>
                      {errorSummary.map((s, i) => (
                        <div key={i} style={{ padding: '3px 0', display: 'flex', gap: 8, alignItems: 'baseline' }}>
                          <span style={{ minWidth: 120, fontWeight: 600 }}>{s.category}</span>
                          <span style={{ color: '#dc2626' }}>{s.cnt}건</span>
                          <code style={{ flex: 1, fontSize: 10, color: '#78350f', wordBreak: 'break-all' }}>{s.sample_message?.slice(0, 120)}</code>
                        </div>
                      ))}
                    </div>
                    <div style={{ marginTop: 6, fontSize: 11, color: '#78350f' }}>
                      ※ 같은 문서가 5회 실패 시 자동으로 큐에서 제외됩니다. "실패 로그 초기화" 버튼으로 다시 시도 가능합니다.
                    </div>
                  </div>
                )}

                {/* 테스트 발송 — 특정 문서 1건만 */}
                <details style={{ marginBottom: 16, padding: 10, background: '#fffbea', border: '1px solid #fde68a', borderRadius: 6 }}>
                  <summary style={{ cursor: 'pointer', fontWeight: 600, fontSize: 13, color: '#92400e', display: 'flex', alignItems: 'center', gap: 6 }}>
                    <Send size={14} /> 테스트 발송 (1건만, 재업로드)
                  </summary>
                  <div style={{ marginTop: 8, display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
                    <select
                      className="form-input"
                      value={testTargetId}
                      onChange={(e) => { setTestTargetId(e.target.value); setTestResult(null); }}
                      style={{ flex: 1, minWidth: 240, fontSize: 12 }}
                    >
                      <option value="">— 문서 유형 선택 —</option>
                      {Object.entries(groupedDocs).map(([type, docs]) => (
                        <optgroup key={type} label={`${type} (${docs.length}건)`}>
                          {docs.slice(0, 10).map((d: any) => (
                            <option key={d.id} value={d.id}>
                              {d.author_name} · {d.title} · {(d.approved_at || d.created_at || '').slice(0, 10)}
                            </option>
                          ))}
                        </optgroup>
                      ))}
                    </select>
                    <button
                      className="btn btn-sm btn-primary"
                      onClick={handleTestSend}
                      disabled={testSending || !testTargetId}
                    >
                      {testSending ? <><Loader size={12} className="spin" /> 전송 중...</> : <><Send size={12} /> 테스트 발송</>}
                    </button>
                  </div>
                  <div style={{ marginTop: 6, fontSize: 11, color: '#78350f' }}>
                    선택한 문서 1건만 즉시 PDF 생성 → Drive 업로드. 결과를 확인 후 문제 없으면 "지금 실행"으로 대량 처리하세요.
                  </div>
                  {testResult && (
                    <div style={{
                      marginTop: 8, padding: 8, borderRadius: 6, fontSize: 12,
                      background: testResult.status === 'success' ? '#e6f4ea' : '#fce8e6',
                      color: testResult.status === 'success' ? '#137333' : '#c5221f',
                    }}>
                      {testResult.status === 'success' ? (
                        <>✓ <strong>{testResult.title}</strong> 업로드 완료 (폴더: <code>{testResult.folder || '/'}</code>)</>
                      ) : (
                        <>✗ <strong>{testResult.title || '문서'}</strong> 실패: <code style={{ fontSize: 11 }}>{testResult.error}</code></>
                      )}
                    </div>
                  )}
                </details>


                {/* 설정 */}
                <details open style={{ marginBottom: 12 }}>
                  <summary style={{ cursor: 'pointer', fontWeight: 600, padding: '6px 0', display: 'flex', alignItems: 'center', gap: 6 }}>
                    <Settings size={16} /> 폴더/파일명 설정
                  </summary>
                  <div style={{ marginTop: 12, display: 'grid', gap: 12 }}>
                    <div>
                      <label style={{ fontSize: 13, fontWeight: 600, display: 'block', marginBottom: 4 }}>
                        루트 폴더 이름 (Google Drive 최상단에 생성됨)
                      </label>
                      <input className="form-input" value={rootName} onChange={e => setRootName(e.target.value)}
                        placeholder="마이옥션 문서백업" style={{ width: '100%' }} />
                    </div>
                    <div>
                      <label style={{ fontSize: 13, fontWeight: 600, display: 'block', marginBottom: 4 }}>
                        하위 폴더 구조
                      </label>
                      <input className="form-input" value={folderPattern} onChange={e => setFolderPattern(e.target.value)}
                        style={{ width: '100%', fontFamily: 'monospace', fontSize: 13 }} />
                      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 6 }}>
                        {FOLDER_PRESETS.map(p => (
                          <button key={p.pattern} className="btn btn-sm" style={{ fontSize: 11 }}
                            onClick={() => setFolderPattern(p.pattern)}>
                            {p.label}
                          </button>
                        ))}
                      </div>
                    </div>
                    <div>
                      <label style={{ fontSize: 13, fontWeight: 600, display: 'block', marginBottom: 4 }}>
                        파일명 패턴
                      </label>
                      <input className="form-input" value={filenamePattern} onChange={e => setFilenamePattern(e.target.value)}
                        style={{ width: '100%', fontFamily: 'monospace', fontSize: 13 }} />
                      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 6 }}>
                        {FILENAME_PRESETS.map(p => (
                          <button key={p.pattern} className="btn btn-sm" style={{ fontSize: 11 }}
                            onClick={() => setFilenamePattern(p.pattern)}>
                            {p.label}
                          </button>
                        ))}
                      </div>
                      <div style={{ fontSize: 11, color: '#9aa0a6', marginTop: 4 }}>
                        사용 가능: {'{yyyy}, {yyyy-mm}, {yyyy-mm-dd}, {yyyy.mm.dd}, {branch}, {department}, {doc_type}, {author}, {position}, {title}, {client_name}'}
                      </div>
                    </div>
                    <div>
                      <button className="btn btn-primary" onClick={handleSave} disabled={saving}>
                        {saving ? '저장 중...' : '설정 저장'}
                      </button>
                    </div>
                  </div>
                </details>

                {/* 로그 */}
                <details open={logsOpen} onToggle={(e: any) => setLogsOpen(e.target.open)} style={{ marginTop: 8 }}>
                  <summary style={{ cursor: 'pointer', fontWeight: 600, padding: '6px 0', display: 'flex', alignItems: 'center', gap: 6 }}>
                    <History size={16} /> 최근 백업 로그 ({logs.length})
                  </summary>
                  <div style={{ marginTop: 8, maxHeight: 300, overflowY: 'auto', border: '1px solid #eee', borderRadius: 6 }}>
                    {logs.length === 0 ? (
                      <div style={{ padding: 12, color: '#9aa0a6', fontSize: 13 }}>아직 백업 이력이 없습니다.</div>
                    ) : (
                      <table style={{ width: '100%', fontSize: 12, borderCollapse: 'collapse' }}>
                        <thead>
                          <tr style={{ background: '#f8f9fa' }}>
                            <th style={th}>상태</th>
                            <th style={th}>문서</th>
                            <th style={th}>폴더</th>
                            <th style={th}>시각</th>
                          </tr>
                        </thead>
                        <tbody>
                          {logs.map((l: any) => (
                            <tr key={l.id} style={{ borderBottom: '1px solid #f0f0f0' }}>
                              <td style={td}>
                                {l.status === 'success'
                                  ? <span style={{ color: '#188038' }}>✓</span>
                                  : <span style={{ color: '#d93025' }}>✗</span>}
                              </td>
                              <td style={td}>{l.document_title || '-'}</td>
                              <td style={{ ...td, color: '#5f6368', fontSize: 11 }}>{l.drive_folder_path || l.error_message || '-'}</td>
                              <td style={{ ...td, color: '#9aa0a6', fontSize: 11 }}>
                                {l.run_at ? new Date(l.run_at.replace(' ', 'T') + 'Z').toLocaleString('ko-KR') : '-'}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    )}
                  </div>
                </details>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

const th: React.CSSProperties = { padding: '6px 8px', textAlign: 'left', fontWeight: 600, fontSize: 11 };
const td: React.CSSProperties = { padding: '6px 8px' };

function StatCard({ label, value, subText, color }: { label: string; value: any; subText?: string; color?: string }) {
  return (
    <div style={{ padding: 12, background: '#f8f9fa', borderRadius: 8, textAlign: 'center' }}>
      <div style={{ fontSize: 11, color: '#5f6368', marginBottom: 4 }}>{label}</div>
      <div style={{ fontSize: 17, fontWeight: 700, color: color || '#1a73e8' }}>{value}</div>
      {subText && <div style={{ fontSize: 10, color: '#9aa0a6', marginTop: 2 }}>{subText}</div>}
    </div>
  );
}
