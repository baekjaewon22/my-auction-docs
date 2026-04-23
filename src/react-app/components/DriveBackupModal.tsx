import { useEffect, useMemo, useRef, useState } from 'react';
import { X, Cloud, CheckCircle, AlertCircle, FolderOpen, Settings, History, Play, Link as LinkIcon, Loader, StopCircle } from 'lucide-react';
import { api } from '../api';
import {
  requestToken, clearToken, fetchCurrentEmail,
  resolvePath, uploadPdf,
  buildFolderPath, buildFilename, generateDocumentPdfBlob,
  verifyFolder, extractFolderId,
  type DocMeta,
} from '../lib/drive';

const PRESETS: { label: string; pattern: string }[] = [
  { label: '월별', pattern: '{yyyy-mm}' },
  { label: '지사 + 월별', pattern: '{branch}/{yyyy-mm}' },
  { label: '지사 + 문서유형', pattern: '{branch}/{doc_type}' },
  { label: '년도 + 지사', pattern: '{yyyy}/{branch}' },
  { label: '지사 + 팀 + 월', pattern: '{branch}/{department}/{yyyy-mm}' },
];

const FILENAME_PRESETS: { label: string; pattern: string }[] = [
  { label: '승인일 + 유형 + 담당자', pattern: '{yyyy.mm.dd} {doc_type} {author} {position}' },
  { label: '표준 (고객명)', pattern: '[{yyyy-mm-dd}] {client_name} {title}' },
  { label: '승인일 + 유형', pattern: '[{yyyy-mm-dd}] {doc_type} {title}' },
  { label: '제목만', pattern: '{title}' },
];

export default function DriveBackupModal({ onClose }: { onClose: () => void }) {
  const [loading, setLoading] = useState(true);
  const [, setSettings] = useState<any>(null);
  const [lastBackupAt, setLastBackupAt] = useState<string | null>(null);
  const [pendingCount, setPendingCount] = useState(0);
  const [pendingDocs, setPendingDocs] = useState<any[]>([]);
  const [logs, setLogs] = useState<any[]>([]);
  const [logsOpen, setLogsOpen] = useState(false);

  const [folderId, setFolderId] = useState('');
  const [folderName, setFolderName] = useState('');
  const [folderPattern, setFolderPattern] = useState('{yyyy-mm}/{branch}');
  const [filenamePattern, setFilenamePattern] = useState('[{yyyy-mm-dd}] {client_name} {title}');

  const [connectedEmail, setConnectedEmail] = useState('');
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState<{ current: number; total: number; currentTitle: string }>({ current: 0, total: 0, currentTitle: '' });
  const [runResult, setRunResult] = useState<{ success: number; failed: number; cancelled?: boolean } | null>(null);
  const cancelRef = useRef(false);

  const loadAll = async () => {
    setLoading(true);
    try {
      const s = await api.drive.settings();
      setSettings(s.settings);
      setLastBackupAt(s.last_backup_at);
      setPendingCount(s.pending_count);
      // 기존에 URL 전체가 저장됐을 수 있으니 ID만 추출
      const rawId = s.settings?.root_folder_id || '';
      const cleanId = extractFolderId(rawId);
      setFolderId(cleanId);
      if (rawId !== cleanId && cleanId) {
        api.drive.saveSettings({ root_folder_id: cleanId }).catch(() => { /* ignore */ });
      }
      setFolderName(s.settings?.root_folder_name || '');
      setFolderPattern(s.settings?.folder_pattern || '{yyyy-mm}/{branch}');
      setFilenamePattern(s.settings?.filename_pattern || '[{yyyy-mm-dd}] {client_name} {title}');
      setConnectedEmail(s.settings?.connected_email || '');
    } catch (err: any) { alert(err.message); }
    finally { setLoading(false); }
  };

  useEffect(() => { loadAll(); }, []);

  const loadPending = async () => {
    const r = await api.drive.pending();
    setPendingDocs(r.documents);
  };

  const loadLogs = async () => {
    const r = await api.drive.logs(30);
    setLogs(r.logs);
  };

  // 설정 저장 (debounced auto-save on change)
  const saveSettings = async (partial: any) => {
    try { await api.drive.saveSettings(partial); }
    catch (err: any) { alert(err.message); }
  };

  // Google 연결
  const handleConnect = async () => {
    try {
      const token = await requestToken(true);
      const email = await fetchCurrentEmail(token);
      if (email) {
        setConnectedEmail(email);
        await saveSettings({ connected_email: email });
      }
    } catch (err: any) { alert('Google 연결 실패: ' + err.message); }
  };

  const handleDisconnect = () => {
    clearToken();
    setConnectedEmail('');
    saveSettings({ connected_email: '' });
  };

  // 백업 실행
  const handleRunBackup = async () => {
    if (!folderId) return alert('Drive 루트 폴더 ID를 입력하고 저장하세요.');
    cancelRef.current = false;
    setRunning(true); setRunResult(null);
    try {
      const token = await requestToken();
      // 루트 폴더 사전 검증
      const v = await verifyFolder(token, folderId);
      if (!v.ok) {
        alert('루트 폴더 접근 불가: ' + v.error + '\n\nDrive 폴더 URL을 복사해서 루트 폴더 ID 칸에 붙여넣어주세요.');
        setRunning(false);
        return;
      }
      const r = await api.drive.pending();
      const docs = r.documents;
      if (docs.length === 0) {
        setProgress({ current: 0, total: 0, currentTitle: '' });
        setRunResult({ success: 0, failed: 0 });
        setRunning(false);
        await loadAll();
        return;
      }
      setProgress({ current: 0, total: docs.length, currentTitle: '' });
      let success = 0, failed = 0;

      let cancelled = false;
      for (let i = 0; i < docs.length; i++) {
        if (cancelRef.current) { cancelled = true; break; }
        const d = docs[i];
        setProgress({ current: i + 1, total: docs.length, currentTitle: d.title });
        try {
          const { blob, meta: pdfMeta } = await generateDocumentPdfBlob(d.id, api);
          const meta: DocMeta = {
            ...pdfMeta,
            author_name: d.author_name,
            author_branch: d.author_branch,
            author_department: d.author_department,
            author_position: d.author_position || '',
            template_name: d.template_name || pdfMeta.template_name,
            approved_at: d.approved_at,
          };
          const segments = buildFolderPath(folderPattern, meta);
          const filename = buildFilename(filenamePattern, meta);
          const folderPathStr = '/' + segments.join('/');
          const folderIdTarget = await resolvePath(token, folderId, segments);
          const up = await uploadPdf(token, folderIdTarget, filename, blob);
          await api.drive.log({
            document_id: d.id,
            status: 'success',
            drive_file_id: up.id,
            drive_folder_path: folderPathStr + '/' + filename,
            file_size: up.size,
          });
          success++;
        } catch (err: any) {
          failed++;
          try {
            await api.drive.log({
              document_id: d.id,
              status: 'failed',
              error_message: String(err?.message || err).slice(0, 400),
            });
          } catch { /* ignore */ }
        }
      }
      setRunResult({ success, failed, cancelled });
      await loadAll();
      if (logsOpen) await loadLogs();
    } catch (err: any) {
      alert('백업 실행 실패: ' + err.message);
    } finally {
      setRunning(false);
    }
  };

  const preview = useMemo(() => {
    const sample: DocMeta = {
      id: 'sample',
      title: '컨설팅 계약서',
      client_name: '홍길동',
      author_name: '박정수',
      author_branch: '서초',
      author_department: '경매사업부2팀',
      author_position: '차장',
      template_name: '컨설팅계약서',
      approved_at: new Date().toISOString(),
    };
    const path = buildFolderPath(folderPattern, sample).join('/');
    const file = buildFilename(filenamePattern, sample);
    return { path, file };
  }, [folderPattern, filenamePattern]);

  const needsConnect = !connectedEmail;
  const needsFolder = !folderId;

  return (
    <div className="drive-modal-backdrop" onClick={onClose}>
      <div className="drive-modal" onClick={(e) => e.stopPropagation()}>
        <div className="drive-modal-head">
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <Cloud size={18} color="#1a73e8" />
            <h3 style={{ margin: 0, fontSize: '1rem' }}>Google Drive 백업</h3>
          </div>
          <button className="drive-close-btn" onClick={onClose}><X size={18} /></button>
        </div>

        {loading ? (
          <div style={{ padding: 40, textAlign: 'center', color: '#9aa0a6' }}>
            <Loader className="drive-spin" size={20} /> 로딩중...
          </div>
        ) : needsConnect ? (
          <div className="drive-modal-body" style={{ textAlign: 'center', padding: '32px 20px' }}>
            <Cloud size={40} color="#93c5fd" style={{ marginBottom: 12 }} />
            <p style={{ margin: '0 0 8px', fontSize: '0.95rem', color: '#334155' }}>
              문서보관함을 Google Drive에 자동 백업하려면<br />관리자 Google 계정 연결이 필요합니다.
            </p>
            <p style={{ margin: '0 0 20px', fontSize: '0.78rem', color: '#64748b' }}>
              연결된 계정의 Drive에만 업로드됩니다.
            </p>
            <button className="drive-primary-btn" onClick={handleConnect}>
              <LinkIcon size={14} /> Google 계정 연결
            </button>
          </div>
        ) : (
          <div className="drive-modal-body">
            {/* 상태 요약 */}
            <div className="drive-status-row">
              <div>
                <CheckCircle size={14} color="#188038" /> 연결됨: <strong>{connectedEmail}</strong>
                <button className="drive-link-btn" onClick={handleDisconnect}>[해제]</button>
              </div>
              <div style={{ color: '#64748b' }}>
                {lastBackupAt ? <>마지막 백업: {lastBackupAt.slice(0, 10)}</> : '첫 백업 대기'}
                {pendingCount > 0 && <> · 대기 <strong style={{ color: '#d93025' }}>{pendingCount}건</strong></>}
              </div>
            </div>

            {/* 설정 */}
            <div className="drive-section">
              <div className="drive-section-title"><Settings size={12} /> 폴더 설정</div>
              <div className="drive-form-row">
                <label>루트 폴더 ID</label>
                <input className="form-input" value={folderId}
                  onChange={(e) => setFolderId(extractFolderId(e.target.value))}
                  onBlur={async () => {
                    await saveSettings({ root_folder_id: folderId });
                    if (folderId) {
                      try {
                        const token = await requestToken();
                        const v = await verifyFolder(token, folderId);
                        if (!v.ok) alert('루트 폴더 검증 실패: ' + v.error);
                        else if (v.name && !folderName) {
                          setFolderName(v.name);
                          saveSettings({ root_folder_name: v.name });
                        }
                      } catch { /* 토큰 없을 수도 있음, 실행 시 검증 재시도 */ }
                    }
                  }}
                  placeholder="Drive 폴더 URL 통째로 붙여넣어도 됨" />
              </div>
              <div className="drive-form-row">
                <label>폴더 이름</label>
                <input className="form-input" value={folderName} onChange={(e) => setFolderName(e.target.value)}
                  onBlur={() => saveSettings({ root_folder_name: folderName })}
                  placeholder="예: 마이옥션 문서보관함" />
              </div>
              <div className="drive-form-row">
                <label>폴더 구조</label>
                <select className="form-input" value={folderPattern}
                  onChange={(e) => { setFolderPattern(e.target.value); saveSettings({ folder_pattern: e.target.value }); }}>
                  {PRESETS.map(p => <option key={p.pattern} value={p.pattern}>{p.label} — {p.pattern}</option>)}
                </select>
              </div>
              <div className="drive-form-row">
                <label>파일명</label>
                <select className="form-input" value={filenamePattern}
                  onChange={(e) => { setFilenamePattern(e.target.value); saveSettings({ filename_pattern: e.target.value }); }}>
                  {FILENAME_PRESETS.map(p => <option key={p.pattern} value={p.pattern}>{p.label} — {p.pattern}</option>)}
                </select>
              </div>
              <div className="drive-preview">
                <FolderOpen size={12} color="#64748b" /> 미리보기:
                <span className="drive-preview-text">
                  {folderName || '(루트)'}/<strong>{preview.path || '(루트)'}</strong>/<strong>{preview.file}</strong>
                </span>
              </div>
            </div>

            {/* 실행 */}
            {runResult ? (
              <div className="drive-result" style={runResult.cancelled ? { background: '#fff7ed', borderColor: '#fdba74' } : undefined}>
                {runResult.cancelled ? <StopCircle size={16} color="#c2410c" /> : <CheckCircle size={16} color="#188038" />}
                {runResult.cancelled ? '백업 중단됨' : '백업 완료'} · 성공 <strong>{runResult.success}</strong>건
                {runResult.failed > 0 && <>, 실패 <strong style={{ color: '#d93025' }}>{runResult.failed}</strong>건</>}
                {runResult.cancelled && <span style={{ color: '#9a3412', marginLeft: 4 }}>(중간 취소)</span>}
                <button className="drive-link-btn" onClick={() => setRunResult(null)}>[닫기]</button>
              </div>
            ) : running ? (
              <div className="drive-running">
                <Loader className="drive-spin" size={16} />
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: '0.82rem', fontWeight: 600 }}>
                    {cancelRef.current ? '취소 중...' : `${progress.current}/${progress.total} · ${progress.currentTitle}`}
                  </div>
                  <div className="drive-progress-bar">
                    <div className="drive-progress-fill" style={{ width: `${progress.total ? (progress.current / progress.total) * 100 : 0}%` }} />
                  </div>
                </div>
                <button className="drive-cancel-btn" onClick={() => { cancelRef.current = true; }}
                  disabled={cancelRef.current} title="현재 업로드 완료 후 중단">
                  <StopCircle size={13} /> 취소
                </button>
              </div>
            ) : (
              <button
                className="drive-primary-btn drive-primary-btn-lg"
                disabled={needsFolder || pendingCount === 0}
                onClick={handleRunBackup}
                title={needsFolder ? '루트 폴더 ID를 입력하세요' : pendingCount === 0 ? '백업할 문서가 없습니다' : ''}>
                <Play size={14} />
                {pendingCount === 0 ? '백업 대기 없음' : `지금 백업 (${pendingCount}건)`}
              </button>
            )}

            {/* 로그 토글 */}
            <div className="drive-section">
              <button className="drive-toggle-btn" onClick={() => {
                setLogsOpen(!logsOpen); if (!logsOpen) loadLogs();
              }}>
                <History size={12} /> 최근 백업 로그 {logsOpen ? '▲' : '▼'}
              </button>
              {logsOpen && (
                <div className="drive-logs">
                  {logs.length === 0 ? (
                    <div style={{ color: '#9aa0a6', fontSize: '0.78rem', padding: 8 }}>기록 없음</div>
                  ) : logs.map(l => (
                    <div key={l.id} className={`drive-log-row ${l.status === 'failed' ? 'failed' : ''}`}>
                      {l.status === 'success' ? <CheckCircle size={11} color="#188038" /> : <AlertCircle size={11} color="#d93025" />}
                      <span style={{ fontFamily: 'monospace', fontSize: '0.7rem', color: '#64748b' }}>{(l.run_at || '').slice(5, 16)}</span>
                      <span style={{ flex: 1 }}>{l.document_title || l.document_id}</span>
                      {l.status === 'failed' && <span style={{ color: '#d93025', fontSize: '0.72rem' }}>{l.error_message?.slice(0, 40)}</span>}
                    </div>
                  ))}
                </div>
              )}
            </div>

            {pendingDocs.length === 0 && pendingCount > 0 && (
              <button className="drive-link-btn" onClick={loadPending}>대기 목록 보기</button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
