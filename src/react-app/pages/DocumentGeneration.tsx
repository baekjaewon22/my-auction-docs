import { useEffect, useMemo, useRef, useState } from 'react';
import { Archive, CheckCircle2, Copy, Download, FileText, History, Pencil, Play, Plus, RefreshCw, Save, ShieldCheck, Trash2 } from 'lucide-react';
import { api } from '../api';
import { automationApi, type DownloadFormat, type DownloadHistoryItem, type OutputType, type ProgressUpdate } from '../automationApi';
import { DEFAULT_AUCTION_REFERENCES, type AuctionReferenceItem, type AuctionReferenceType } from '../data/auctionReference';
import { useAuthStore } from '../store';

type View = 'select' | 'input' | 'progress' | 'result' | 'history';
type DocumentToolTab = 'briefing' | 'rightsReference' | 'checklistReference' | 'plannerReference';

const BRIEFING_STEPS = ['브라우저 준비', '사이트 파싱', 'PPT 기본값 입력', '문서 캡처', 'PPT 이미지 삽입', '저장 완료'];
const RIGHTS_STEPS = ['브라우저 준비', '물건정보 확인', '매각물건명세서 확인', '권리분석 문구 구성', '보증서 템플릿 입력', 'PDF/PPTX 변환', '저장 완료'];

interface Props {
  initialType?: OutputType;
}

export default function DocumentGeneration({ initialType = 'auction_report' }: Props) {
  const { user } = useAuthStore();
  const [view, setView] = useState<View>('select');
  const [outputType, setOutputType] = useState<OutputType>(initialType);
  const [briefingUrl, setBriefingUrl] = useState('');
  const [rightsUrlsText, setRightsUrlsText] = useState('');
  const [rememberLogin, setRememberLogin] = useState(true);
  const [startAt, setStartAt] = useState('');
  const [intervalSeconds, setIntervalSeconds] = useState(5);
  const [reportPermission] = useState<'basic' | 'special'>(user?.report_permission || 'basic');
  const [starting, setStarting] = useState(false);
  const [taskId, setTaskId] = useState('');
  const [updates, setUpdates] = useState<ProgressUpdate[]>([]);
  const [wsConnected, setWsConnected] = useState(false);
  const [result, setResult] = useState<{ success: boolean; message: string; outputType: OutputType; taskId: string; isBatch: boolean } | null>(null);
  const [historyItems, setHistoryItems] = useState<DownloadHistoryItem[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [error, setError] = useState('');
  const [toolTab, setToolTab] = useState<DocumentToolTab>('briefing');

  const canUseRights = user?.role === 'master' || reportPermission === 'special';
  const isRights = outputType === 'rights_certificate';
  const rightsUrls = useMemo(() => rightsUrlsText.split(/[\n,]+/).map((item) => item.trim()).filter(Boolean), [rightsUrlsText]);
  const stepLabels = isRights ? RIGHTS_STEPS : BRIEFING_STEPS;
  const logEndRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    setOutputType(initialType);
  }, [initialType]);

  useEffect(() => {
    if (!taskId || view !== 'progress') return;
    let socket: WebSocket | null = null;
    let stopped = false;
    let terminal = false;

    const sameUpdate = (a?: ProgressUpdate, b?: ProgressUpdate) => (
      !!a && !!b
      && a.step === b.step
      && a.total_steps === b.total_steps
      && a.title === b.title
      && a.message === b.message
      && a.status === b.status
      && Math.round(a.percent) === Math.round(b.percent)
    );

    const mergeUpdates = (incoming: ProgressUpdate[]) => {
      setUpdates((prev) => {
        const next = [...prev];
        for (const update of incoming) {
          const last = next[next.length - 1];
          if (!sameUpdate(last, update)) next.push(update);
        }
        return next.slice(-120);
      });
    };

    const finishFrom = (last?: ProgressUpdate) => {
      if (!last || (last.status !== 'completed' && last.status !== 'error')) return;
      terminal = true;
      setResult({
        success: last.status === 'completed',
        message: last.message,
        outputType,
        taskId,
        isBatch: outputType === 'rights_certificate' && rightsUrls.length > 1,
      });
    };

    try {
      socket = new WebSocket(automationApi.progressWsUrl(taskId));
      socket.onopen = () => setWsConnected(true);
      socket.onclose = () => setWsConnected(false);
      socket.onerror = () => setWsConnected(false);
      socket.onmessage = (event) => {
        try {
          const update = JSON.parse(event.data);
          if (update?.type === 'ping') return;
          mergeUpdates([update]);
          finishFrom(update);
        } catch {
          // Ignore malformed progress frames; polling below remains the fallback.
        }
      };
    } catch {
      setWsConnected(false);
    }

    const poll = async () => {
      try {
        const res = await automationApi.progress(taskId);
        if (stopped) return;
        mergeUpdates(res.updates || []);
        const last = res.updates?.[res.updates.length - 1];
        finishFrom(last);
        if (terminal) {
          return;
        }
      } catch (err: any) {
        setError(err.message || '진행 상태를 조회하지 못했습니다.');
      }
    };
    poll();
    const timer = window.setInterval(poll, 1500);
    return () => {
      stopped = true;
      socket?.close();
      window.clearInterval(timer);
    };
  }, [taskId, view, outputType, rightsUrls.length]);

  useEffect(() => {
    if (view !== 'progress') return;
    logEndRef.current?.scrollIntoView({ block: 'end' });
  }, [updates, view]);

  const selectWork = (next: OutputType) => {
    if (next === 'rights_certificate' && !canUseRights) {
      setError('권리분석 보증서는 master 또는 special 권한만 생성할 수 있습니다.');
      return;
    }
    setError('');
    setOutputType(next);
    setView('input');
  };

  const commonPayload = () => ({
    remember_login: rememberLogin,
    requester_permission: reportPermission,
  });

  const validateInput = () => {
    if (!user?.has_myauction_credentials) return '내 정보 수정에서 마이옥션 아이디와 비밀번호를 먼저 저장해 주세요.';
    if (!user?.name?.trim() || !user?.position_title?.trim() || !user?.phone?.trim()) return '내 정보 수정에서 이름, 직책, 전화번호를 먼저 저장해 주세요.';
    if (isRights && !canUseRights) return '권리분석 보증서는 master 또는 special 권한만 생성할 수 있습니다.';
    if (isRights && rightsUrls.length === 0) return '권리분석 보증서 URL을 1개 이상 입력하세요.';
    if (!isRights && !briefingUrl.trim()) return '브리핑자료 사건 URL을 입력하세요.';
    return '';
  };

  const startGeneration = async () => {
    const validation = validateInput();
    if (validation) {
      setError(validation);
      return;
    }
    setStarting(true);
    setError('');
    try {
      const payload = commonPayload();
      const res = isRights && rightsUrls.length > 1
        ? await automationApi.startBatch({
            output_type: 'rights_certificate',
            urls: rightsUrls,
            ...payload,
            start_at: startAt,
            interval_seconds: Math.max(0, Number(intervalSeconds) || 0),
          })
        : await automationApi.startReport({
            output_type: outputType,
            url: isRights ? rightsUrls[0] : briefingUrl.trim(),
            ...payload,
          });
      setTaskId(res.task_id);
      setUpdates([]);
      setResult(null);
      setWsConnected(false);
      setView('progress');
    } catch (err: any) {
      setError(err.message || '생성 요청에 실패했습니다.');
    } finally {
      setStarting(false);
    }
  };

  const loadHistory = async () => {
    setHistoryLoading(true);
    setError('');
    try {
      const res = await automationApi.history();
      setHistoryItems(res.items || []);
      setView('history');
    } catch (err: any) {
      setError(err.message || '다운로드 이력을 불러오지 못했습니다.');
    } finally {
      setHistoryLoading(false);
    }
  };

  const currentProgress = updates[updates.length - 1];
  const currentPercent = Math.max(0, Math.min(100, currentProgress?.percent || 0));
  const referenceType: AuctionReferenceType | null = toolTab === 'checklistReference' ? 'checklist' : null;

  return (
    <div className={`page${toolTab === 'plannerReference' ? ' document-page-planner' : ''}`}>
      <div className="page-header">
        <h2><FileText size={24} style={{ marginRight: 8, verticalAlign: 'middle' }} /> 자료 생성</h2>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button className="btn btn-sm" onClick={() => setView('select')}>작업 선택</button>
          <button className="btn btn-sm" onClick={loadHistory}><History size={14} /> 이력</button>
        </div>
      </div>

      {error && (
        <div className="card" style={{ marginBottom: 16, borderLeft: '3px solid #d93025', color: '#d93025', padding: 14 }}>
          {error}
        </div>
      )}

      <div className="document-tool-tabs">
        <button className={toolTab === 'briefing' ? 'active' : ''} onClick={() => setToolTab('briefing')}>업무 자동화</button>
        <button className={toolTab === 'rightsReference' ? 'active' : ''} onClick={() => setToolTab('rightsReference')}>권리분석</button>
        <button className={toolTab === 'checklistReference' ? 'active' : ''} onClick={() => setToolTab('checklistReference')}>물건별 체크리스트</button>
        <button className={toolTab === 'plannerReference' ? 'active' : ''} onClick={() => setToolTab('plannerReference')}>옥션플래너</button>
      </div>

      {toolTab === 'rightsReference' ? (
        <RightsLegalReferencePanel canManage={user?.role === 'master'} />
      ) : toolTab === 'plannerReference' ? (
        <PlannerReferencePanel />
      ) : referenceType ? (
        <ChecklistReferencePanel canManage={user?.role === 'master'} />
      ) : (
        <>
      {view === 'select' && (
        <div className="document-work-grid">
          <button className="document-work-button briefing" type="button" onClick={() => selectWork('auction_report')}>
            <span className="document-work-icon"><FileText size={24} /></span>
            <span className="document-work-copy">
              <strong>브리핑자료</strong>
              <small>사건 URL 1개로 PPT/PDF 출력물을 생성합니다.</small>
            </span>
            <span className="document-work-action">시작</span>
          </button>
          <button className={`document-work-button rights ${canUseRights ? '' : 'disabled'}`} type="button" onClick={() => selectWork('rights_certificate')} aria-disabled={!canUseRights}>
            <span className="document-work-icon"><ShieldCheck size={24} /></span>
            <span className="document-work-copy">
              <strong>권리분석 보증서</strong>
              <small>{canUseRights ? '여러 URL을 순차 처리하고 ZIP 다운로드를 제공합니다.' : 'special 권한 이상 사용 가능합니다.'}</small>
            </span>
            <span className="document-work-action">{canUseRights ? '시작' : '권한 필요'}</span>
          </button>
        </div>
      )}

      {view === 'input' && (
        <div className="card" style={{ padding: 20 }}>
          <h3 style={{ marginTop: 0 }}>{isRights ? '권리분석 보증서 생성' : '브리핑자료 생성'}</h3>
          <div style={{ display: 'grid', gap: 16 }}>
            {isRights ? (
              <div>
                <label className="label">사건 URL 여러 개</label>
                <textarea className="form-input" value={rightsUrlsText} onChange={(e) => setRightsUrlsText(e.target.value)} rows={7} placeholder={'https://www.my-auction.co.kr/view/1111111\nhttps://www.my-auction.co.kr/view/2222222'} style={{ width: '100%', resize: 'vertical' }} />
                <div style={{ marginTop: 6, fontSize: '0.78rem', color: '#5f6368' }}>{rightsUrls.length}개 URL 입력됨</div>
              </div>
            ) : (
              <div>
                <label className="label">사건 URL</label>
                <input className="form-input" value={briefingUrl} onChange={(e) => setBriefingUrl(e.target.value)} placeholder="https://www.my-auction.co.kr/view/사건번호" style={{ width: '100%' }} />
              </div>
            )}

            {isRights && (
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 12 }}>
                <div>
                  <label className="label">시작 예약</label>
                  <input className="form-input" type="datetime-local" value={startAt} onChange={(e) => setStartAt(e.target.value)} style={{ width: '100%' }} />
                </div>
                <div>
                  <label className="label">URL 간 대기 초</label>
                  <input className="form-input" type="number" min={0} value={intervalSeconds} onChange={(e) => setIntervalSeconds(Number(e.target.value) || 0)} style={{ width: '100%' }} />
                </div>
              </div>
            )}

            <ProfileSummary user={user} />

            <label style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: '0.86rem' }}>
              <input type="checkbox" checked={rememberLogin} onChange={(e) => setRememberLogin(e.target.checked)} />
              자동 로그인 세션 유지
            </label>

            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <button className="btn btn-primary" onClick={startGeneration} disabled={starting}>
                <Play size={14} /> {starting ? '시작중...' : '생성 시작'}
              </button>
              <button className="btn" onClick={() => setView('select')}>작업 다시 선택</button>
            </div>
          </div>
        </div>
      )}

      {view === 'progress' && (
        <div style={{ display: 'grid', gap: 16 }}>
          <div className="card" style={{ padding: 20 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, marginBottom: 12 }}>
              <h3 style={{ margin: 0 }}>{isRights ? '권리분석 보증서 진행' : '브리핑자료 진행'}</h3>
              <strong>{Math.round(currentPercent)}%</strong>
            </div>
            <div style={{ height: 10, borderRadius: 8, background: '#edf2f7', overflow: 'hidden' }}>
              <div style={{ height: '100%', width: `${currentPercent}%`, background: currentProgress?.status === 'error' ? '#d93025' : '#1a73e8', transition: 'width .3s' }} />
            </div>
            <div style={{ marginTop: 14, color: '#5f6368' }}>{currentProgress?.message || '작업을 준비하고 있습니다.'}</div>
          </div>
          <div className="document-progress-grid">
          <div className="card document-step-card">
            <h4 style={{ marginTop: 0, marginBottom: 14 }}>진행 단계</h4>
            <div className="document-step-list">
              {stepLabels.map((label, idx) => (
                <div key={label} className={`document-step-row ${idx < (currentProgress?.step || 0) ? 'done' : idx === (currentProgress?.step || 0) ? 'active' : ''}`}>
                  <CheckCircle2 size={16} color={idx < (currentProgress?.step || 0) ? '#188038' : '#cbd5e1'} />
                  <span>{label}</span>
                </div>
              ))}
            </div>
          </div>
          <div className="card document-log-card">
            <div className="document-log-header">
              <h4>실시간 로그</h4>
              <span className={wsConnected ? 'connected' : ''}>{wsConnected ? '연결됨' : '폴링 중'}</span>
            </div>
            <div className="document-live-log" aria-live="polite">
              {updates.length === 0 ? (
                <div className="document-log-line muted">[대기] 작업 시작 신호를 기다리는 중...</div>
              ) : updates.map((update, idx) => (
                <div key={`${idx}-${update.step}-${update.percent}-${update.message}`} className={`document-log-line ${update.status}`}>
                  <span>[{update.title}]</span> {update.message}
                </div>
              ))}
              <div ref={logEndRef} />
            </div>
          </div>
          </div>
          {result && (
            <div className="card" style={{ padding: 20, borderLeft: `3px solid ${result.success ? '#188038' : '#d93025'}` }}>
              <h3 style={{ marginTop: 0 }}>{result.success ? '생성 완료' : '생성 실패'}</h3>
              <p style={{ color: result.success ? '#188038' : '#d93025' }}>{result.message}</p>
              {result.success && (
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                  {!result.isBatch && <DownloadButton taskId={result.taskId} format="pptx" label="PPT 다운로드" />}
                  {!result.isBatch && <DownloadButton taskId={result.taskId} format="pdf" label="PDF 다운로드" />}
                  {result.isBatch && <DownloadButton taskId={result.taskId} format="zip" label="ZIP 다운로드" />}
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {view === 'result' && result && (
        <div className="card" style={{ padding: 24 }}>
          <h3 style={{ marginTop: 0 }}>{result.success ? '생성 완료' : '생성 실패'}</h3>
          <p style={{ color: result.success ? '#188038' : '#d93025' }}>{result.message}</p>
          {result.success && (
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              {!result.isBatch && <DownloadButton taskId={result.taskId} format="pptx" label="PPT 다운로드" />}
              {!result.isBatch && <DownloadButton taskId={result.taskId} format="pdf" label="PDF 다운로드" />}
              {result.isBatch && <DownloadButton taskId={result.taskId} format="zip" label="ZIP 다운로드" />}
            </div>
          )}
        </div>
      )}

      {view === 'history' && (
        <div className="card" style={{ padding: 20 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'center', marginBottom: 12 }}>
            <div>
              <h3 style={{ margin: 0 }}>다운로드 이력</h3>
              <p style={{ margin: '4px 0 0', color: '#5f6368', fontSize: '0.8rem' }}>최근 20개까지 보관되며, 초과 시 오래된 항목부터 자동 삭제됩니다.</p>
            </div>
            <button className="btn btn-sm" onClick={loadHistory} disabled={historyLoading}><RefreshCw size={14} /> 새로고침</button>
          </div>
          {historyItems.length === 0 ? (
            <div className="empty-state">다운로드 이력이 없습니다.</div>
          ) : (
            <div className="table-wrapper">
              <table className="data-table">
                <thead><tr><th>파일</th><th>종류</th><th>생성일</th><th>다운로드</th></tr></thead>
                <tbody>
                  {historyItems.map((item) => (
                    <tr key={item.id}>
                      <td>{item.file_name || item.title}</td>
                      <td>{item.output_type === 'rights_certificate' ? '권리분석 보증서' : '브리핑자료'}</td>
                      <td>{item.created_at ? new Date(item.created_at).toLocaleString('ko-KR') : '-'}</td>
                      <td>
                        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                          {item.formats.map((format) => (
                            <button key={format} className="btn btn-sm" onClick={() => automationApi.downloadHistoryFile(item.id, format).catch((err) => setError(err.message))}>{format.toUpperCase()}</button>
                          ))}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

        </>
      )}

    </div>
  );
}

function normalizeReferenceTitle(value: string): string {
  return value
    .replace(/\([^)]*\)/g, '')
    .replace(/\[[^\]]*\]/g, '')
    .replace(/[·ㆍ/()\s-]+/g, '')
    .replace(/있는|관련|부동산|활용|내물건|내|형/g, '')
    .toLowerCase()
    .trim();
}

function mergeReferenceItems(type: AuctionReferenceType, customItems: AuctionReferenceItem[]) {
  const map = new Map<string, AuctionReferenceItem>();
  for (const item of DEFAULT_AUCTION_REFERENCES[type] || []) map.set(item.id, item);
  for (const item of customItems) map.set(item.id, { ...item, source: 'custom' });
  return [...map.values()].sort((a, b) => {
    if (a.source !== b.source) return a.source === 'default' ? -1 : 1;
    return a.title.localeCompare(b.title, 'ko');
  });
}

function findRelatedReference(items: AuctionReferenceItem[], title: string) {
  const normalized = normalizeReferenceTitle(title);
  return items.find((item) => normalizeReferenceTitle(item.title) === normalized)
    || items.find((item) => {
      const other = normalizeReferenceTitle(item.title);
      return !!normalized && !!other && (other.includes(normalized) || normalized.includes(other));
    });
}

function RightsLegalReferencePanel({ canManage }: { canManage: boolean }) {
  const [customRights, setCustomRights] = useState<AuctionReferenceItem[]>([]);
  const [customLegal, setCustomLegal] = useState<AuctionReferenceItem[]>([]);
  const [selectedKey, setSelectedKey] = useState('');
  const [editing, setEditing] = useState<{ type: AuctionReferenceType; id?: string; title: string; content: string } | null>(null);
  const [message, setMessage] = useState('');
  const [loading, setLoading] = useState(false);

  const rightsItems = useMemo(() => mergeReferenceItems('rights', customRights), [customRights]);
  const legalItems = useMemo(() => mergeReferenceItems('legal', customLegal), [customLegal]);

  const options = useMemo(() => {
    const map = new Map<string, { key: string; title: string; rights?: AuctionReferenceItem; legal?: AuctionReferenceItem }>();
    for (const item of rightsItems) {
      const key = normalizeReferenceTitle(item.title) || item.id;
      const current = map.get(key) || { key, title: item.title };
      current.rights = item;
      current.title = item.title;
      map.set(key, current);
    }
    for (const item of legalItems) {
      const key = normalizeReferenceTitle(item.title) || item.id;
      const current = map.get(key) || { key, title: item.title };
      current.legal = item;
      if (!current.rights) current.title = item.title;
      map.set(key, current);
    }
    return [...map.values()].sort((a, b) => a.title.localeCompare(b.title, 'ko'));
  }, [legalItems, rightsItems]);

  const selected = options.find((item) => item.key === selectedKey) || options[0];
  const selectedRights = selected?.rights || (selected ? findRelatedReference(rightsItems, selected.title) : undefined);
  const selectedLegal = selected?.legal || (selected ? findRelatedReference(legalItems, selected.title) : undefined);

  useEffect(() => {
    let stopped = false;
    const load = async () => {
      setLoading(true);
      setMessage('');
      try {
        const [rightsRes, legalRes] = await Promise.all([
          api.auctionReference.list('rights'),
          api.auctionReference.list('legal'),
        ]);
        if (stopped) return;
        setCustomRights((rightsRes.items || []).map((item) => ({ ...item, source: 'custom' as const })));
        setCustomLegal((legalRes.items || []).map((item) => ({ ...item, source: 'custom' as const })));
      } catch (err: any) {
        if (!stopped) setMessage(err.message || '저장된 문구를 불러오지 못했습니다.');
      } finally {
        if (!stopped) setLoading(false);
      }
    };
    load();
    return () => { stopped = true; };
  }, []);

  useEffect(() => {
    if (!options.length) return;
    if (!options.some((item) => item.key === selectedKey)) setSelectedKey(options[0].key);
  }, [options, selectedKey]);

  const copyText = async (text: string, label: string) => {
    await navigator.clipboard.writeText(text);
    setMessage(`${label} 복사되었습니다.`);
  };

  const startAdd = (type: AuctionReferenceType) => {
    setEditing({ type, title: selected?.title || '', content: '' });
    setMessage('');
  };

  const startEdit = (type: AuctionReferenceType, item?: AuctionReferenceItem) => {
    setEditing({
      type,
      id: item?.id,
      title: item?.title || selected?.title || '',
      content: item?.content || '',
    });
    setMessage('');
  };

  const saveEditing = async () => {
    if (!editing) return;
    const titleValue = editing.title.trim();
    const contentValue = editing.content.trim();
    if (!titleValue || !contentValue) {
      setMessage('제목과 내용을 모두 입력해 주세요.');
      return;
    }
    setLoading(true);
    try {
      const res = await api.auctionReference.save({
        id: editing.id,
        type: editing.type,
        title: titleValue,
        content: contentValue,
      });
      const nextItem = { ...res.item, source: 'custom' as const };
      const setter = editing.type === 'rights' ? setCustomRights : setCustomLegal;
      setter((prev) => [nextItem, ...prev.filter((item) => item.id !== nextItem.id)]);
      setSelectedKey(normalizeReferenceTitle(nextItem.title) || nextItem.id);
      setEditing(null);
      setMessage('저장되었습니다.');
    } catch (err: any) {
      setMessage(err.message || '저장하지 못했습니다.');
    } finally {
      setLoading(false);
    }
  };

  const removeItem = async (item?: AuctionReferenceItem) => {
    if (!item || item.source !== 'custom') return;
    if (!window.confirm('선택한 사용자 추가/수정 항목을 삭제할까요?')) return;
    setLoading(true);
    try {
      await api.auctionReference.remove(item.id);
      const setter = item.type === 'rights' ? setCustomRights : setCustomLegal;
      setter((prev) => prev.filter((entry) => entry.id !== item.id));
      setMessage('삭제되었습니다.');
    } catch (err: any) {
      setMessage(err.message || '삭제하지 못했습니다.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="card auction-reference-panel">
      <div className="auction-reference-head">
        <div>
          <h3>권리분석</h3>
          <p>한 항목을 선택하면 위에는 브리핑용 권리분석 문구, 아래에는 법률의견(브리핑자료용) 근거 문구가 함께 표시됩니다.</p>
        </div>
      </div>

      <div className="auction-reference-controls combined">
        <select className="form-input" value={selected?.key || ''} onChange={(e) => { setSelectedKey(e.target.value); setEditing(null); }}>
          {options.map((item) => (
            <option key={item.key} value={item.key}>{item.title}</option>
          ))}
        </select>
        <button
          className="btn btn-sm"
          disabled={!selectedRights && !selectedLegal}
          onClick={() => copyText([
            selectedRights ? `(권리분석)\n${selectedRights.content}` : '',
            selectedLegal ? `법률의견(브리핑자료용)\n${selectedLegal.content}` : '',
          ].filter(Boolean).join('\n\n'), '전체 문구가')}
        >
          <Copy size={14} /> 전체 복사
        </button>
      </div>

      {message && <div className="auction-reference-message">{message}</div>}

      {editing ? (
        <div className="auction-reference-editor">
          <div className="auction-reference-edit-label">
            {editing.type === 'rights' ? '권리분석 문구' : '법률의견(브리핑자료용)'}
          </div>
          <input
            className="form-input"
            value={editing.title}
            onChange={(e) => setEditing((prev) => prev ? { ...prev, title: e.target.value } : prev)}
            placeholder="셀렉트박스 옵션명"
          />
          <textarea
            className="form-input"
            value={editing.content}
            onChange={(e) => setEditing((prev) => prev ? { ...prev, content: e.target.value } : prev)}
            rows={12}
            placeholder="표시할 문구"
          />
          <div className="auction-reference-actions">
            <button className="btn btn-primary" onClick={saveEditing} disabled={loading}><Save size={14} /> 저장</button>
            <button className="btn" onClick={() => setEditing(null)}>취소</button>
          </div>
        </div>
      ) : (
        <div className="auction-combined-sections">
          <ReferenceSection
            title="(권리분석)"
            item={selectedRights}
            loading={loading}
            canManage={canManage}
            onCopy={() => selectedRights && copyText(selectedRights.content, '권리분석 문구가')}
            onAdd={() => startAdd('rights')}
            onEdit={() => startEdit('rights', selectedRights)}
            onRemove={() => removeItem(selectedRights)}
          />
          <ReferenceSection
            title="법률의견(브리핑자료용)"
            item={selectedLegal}
            loading={loading}
            canManage={canManage}
            onCopy={() => selectedLegal && copyText(selectedLegal.content, '법률의견 문구가')}
            onAdd={() => startAdd('legal')}
            onEdit={() => startEdit('legal', selectedLegal)}
            onRemove={() => removeItem(selectedLegal)}
          />
        </div>
      )}
    </div>
  );
}

function ReferenceSection({
  title,
  item,
  loading,
  canManage,
  onCopy,
  onAdd,
  onEdit,
  onRemove,
}: {
  title: string;
  item?: AuctionReferenceItem;
  loading: boolean;
  canManage: boolean;
  onCopy: () => void;
  onAdd: () => void;
  onEdit: () => void;
  onRemove: () => void;
}) {
  return (
    <section className="auction-reference-section">
      <div className="auction-reference-section-head">
        <h4>{title}</h4>
        <div>
          <button className="btn btn-sm" onClick={onCopy} disabled={!item}><Copy size={14} /> 복사</button>
          {canManage && <button className="btn btn-sm" onClick={item ? onEdit : onAdd}><Pencil size={14} /> {item ? '수정' : '추가'}</button>}
          {canManage && item?.source === 'custom' && <button className="btn btn-sm danger" onClick={onRemove}><Trash2 size={14} /> 삭제</button>}
        </div>
      </div>
      <div className="auction-reference-content">
        {loading && !item ? '불러오는 중...' : item?.content || '해당 항목에 연결된 문구가 없습니다.'}
      </div>
    </section>
  );
}

function stripInternalCodes(value: string): string {
  return value
    .replace(/\s*`?\[[A-Z]{2,4}-\d{2}\]`?/g, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function ChecklistReferencePanel({ canManage }: { canManage: boolean }) {
  const defaultItems = DEFAULT_AUCTION_REFERENCES.checklist || [];
  const [customItems, setCustomItems] = useState<AuctionReferenceItem[]>([]);
  const [selectedCategory, setSelectedCategory] = useState(defaultItems[0]?.category || '공통');
  const [selectedId, setSelectedId] = useState(defaultItems[0]?.id || '');
  const [editing, setEditing] = useState<{ id?: string; category: string; title: string; content: string } | null>(null);
  const [message, setMessage] = useState('');
  const [loading, setLoading] = useState(false);

  const items = useMemo(() => mergeReferenceItems('checklist', customItems), [customItems]);
  const categories = useMemo(() => {
    const values = items.map((item) => item.category || '사용자 추가').filter(Boolean);
    const unique = [...new Set(values)];
    const order = ['공통', '주거용', '상업·업무용', '산업용', '토지', '권리 특수형 (물건종류 불문 추가 점검)', '사용자 추가'];
    return unique.sort((a, b) => {
      const ai = order.indexOf(a);
      const bi = order.indexOf(b);
      if (ai !== -1 || bi !== -1) return (ai === -1 ? 999 : ai) - (bi === -1 ? 999 : bi);
      return a.localeCompare(b, 'ko');
    });
  }, [items]);
  const filteredItems = useMemo(
    () => items.filter((item) => (item.category || '사용자 추가') === selectedCategory),
    [items, selectedCategory]
  );
  const selected = filteredItems.find((item) => item.id === selectedId) || filteredItems[0];

  useEffect(() => {
    let stopped = false;
    const load = async () => {
      setLoading(true);
      setMessage('');
      try {
        const res = await api.auctionReference.list('checklist');
        if (stopped) return;
        setCustomItems((res.items || []).map((item) => ({
          ...item,
          category: item.category || '사용자 추가',
          source: 'custom' as const,
        })));
      } catch (err: any) {
        if (!stopped) setMessage(err.message || '저장된 체크리스트를 불러오지 못했습니다.');
      } finally {
        if (!stopped) setLoading(false);
      }
    };
    load();
    return () => { stopped = true; };
  }, []);

  useEffect(() => {
    if (!categories.length) return;
    if (!categories.includes(selectedCategory)) setSelectedCategory(categories[0]);
  }, [categories, selectedCategory]);

  useEffect(() => {
    if (!filteredItems.length) {
      setSelectedId('');
      return;
    }
    if (!filteredItems.some((item) => item.id === selectedId)) setSelectedId(filteredItems[0].id);
  }, [filteredItems, selectedId]);

  const copySelected = async () => {
    if (!selected) return;
    await navigator.clipboard.writeText(stripInternalCodes(selected.content));
    setMessage('체크리스트가 복사되었습니다.');
  };

  const startAdd = () => {
    setEditing({ category: selectedCategory || '사용자 추가', title: '', content: '' });
    setMessage('');
  };

  const startEdit = () => {
    if (!selected) return;
    setEditing({
      id: selected.id,
      category: selected.category || selectedCategory || '사용자 추가',
      title: selected.title,
      content: stripInternalCodes(selected.content),
    });
    setMessage('');
  };

  const saveEditing = async () => {
    if (!editing) return;
    const categoryValue = editing.category.trim() || '사용자 추가';
    const titleValue = editing.title.trim();
    const contentValue = stripInternalCodes(editing.content);
    if (!titleValue || !contentValue) {
      setMessage('카테고리, 제목, 내용을 입력해 주세요.');
      return;
    }
    setLoading(true);
    try {
      const res = await api.auctionReference.save({
        id: editing.id,
        type: 'checklist',
        category: categoryValue,
        title: titleValue,
        content: contentValue,
      });
      const nextItem = { ...res.item, category: categoryValue, source: 'custom' as const };
      setCustomItems((prev) => [nextItem, ...prev.filter((item) => item.id !== nextItem.id)]);
      setSelectedCategory(categoryValue);
      setSelectedId(nextItem.id);
      setEditing(null);
      setMessage('저장되었습니다.');
    } catch (err: any) {
      setMessage(err.message || '저장하지 못했습니다.');
    } finally {
      setLoading(false);
    }
  };

  const removeSelected = async () => {
    if (!selected || selected.source !== 'custom') return;
    if (!window.confirm('선택한 사용자 추가/수정 항목을 삭제할까요?')) return;
    setLoading(true);
    try {
      await api.auctionReference.remove(selected.id);
      setCustomItems((prev) => prev.filter((item) => item.id !== selected.id));
      setMessage('삭제되었습니다.');
    } catch (err: any) {
      setMessage(err.message || '삭제하지 못했습니다.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="card auction-reference-panel">
      <div className="auction-reference-head">
        <div>
          <h3>물건별 체크리스트</h3>
          <p>대분류와 물건종류를 순서대로 선택해 필요한 검토 항목을 확인합니다. 내부 관리용 코드 표기는 표시하지 않습니다.</p>
        </div>
        {canManage && (
          <button className="btn btn-sm" onClick={startAdd}>
            <Plus size={14} /> 추가
          </button>
        )}
      </div>

      <div className="checklist-reference-controls">
        <div>
          <label className="label">카테고리</label>
          <select className="form-input" value={selectedCategory} onChange={(e) => { setSelectedCategory(e.target.value); setEditing(null); }}>
            {categories.map((category) => <option key={category} value={category}>{category}</option>)}
          </select>
        </div>
        <div>
          <label className="label">물건종류</label>
          <select className="form-input" value={selected?.id || ''} onChange={(e) => { setSelectedId(e.target.value); setEditing(null); }}>
            {filteredItems.map((item) => (
              <option key={item.id} value={item.id}>
                {item.source === 'custom' ? '[수정/추가] ' : ''}{item.title}
              </option>
            ))}
          </select>
        </div>
        <button className="btn btn-sm" onClick={copySelected} disabled={!selected}><Copy size={14} /> 복사</button>
        {canManage && <button className="btn btn-sm" onClick={startEdit} disabled={!selected}><Pencil size={14} /> 수정</button>}
        {canManage && selected?.source === 'custom' && <button className="btn btn-sm danger" onClick={removeSelected} disabled={loading}><Trash2 size={14} /> 삭제</button>}
      </div>

      {message && <div className="auction-reference-message">{message}</div>}

      {editing ? (
        <div className="auction-reference-editor">
          <input
            className="form-input"
            value={editing.category}
            onChange={(e) => setEditing((prev) => prev ? { ...prev, category: e.target.value } : prev)}
            placeholder="카테고리"
            list="checklist-categories"
          />
          <datalist id="checklist-categories">
            {categories.map((category) => <option key={category} value={category} />)}
          </datalist>
          <input
            className="form-input"
            value={editing.title}
            onChange={(e) => setEditing((prev) => prev ? { ...prev, title: e.target.value } : prev)}
            placeholder="물건종류"
          />
          <textarea
            className="form-input"
            value={editing.content}
            onChange={(e) => setEditing((prev) => prev ? { ...prev, content: e.target.value } : prev)}
            rows={12}
            placeholder="체크리스트"
          />
          <div className="auction-reference-actions">
            <button className="btn btn-primary" onClick={saveEditing} disabled={loading}><Save size={14} /> 저장</button>
            <button className="btn" onClick={() => setEditing(null)}>취소</button>
          </div>
        </div>
      ) : (
        <div className="auction-reference-content">
          {loading && !selected ? '불러오는 중...' : selected ? stripInternalCodes(selected.content) : '표시할 체크리스트가 없습니다.'}
        </div>
      )}
    </div>
  );
}

type PlannerCalculatorKey = 'acquisition-tax' | 'brokerage-fee' | 'profit' | 'bid-price' | 'cost-analysis' | 'tenant-registry';

const PLANNER_CALCULATORS: { key: PlannerCalculatorKey; label: string; description: string; frameHeight: number }[] = [
  { key: 'acquisition-tax', label: '취득세 계산기', description: '부동산 취득 시 납부해야 할 취득세 계산', frameHeight: 1320 },
  { key: 'brokerage-fee', label: '중개수수료', description: '부동산 임대, 매매 시 중개수수료 계산', frameHeight: 1220 },
  { key: 'profit', label: '수익률 계산기', description: '투자 수익률 예상 수치 제공', frameHeight: 1500 },
  { key: 'bid-price', label: '적정입찰가', description: '최적의 입찰가로 낙찰 확률 증가', frameHeight: 1420 },
  { key: 'cost-analysis', label: '원가분석계산', description: '총 투입 원가 분석', frameHeight: 1560 },
  { key: 'tenant-registry', label: '임차인등록표', description: '임차인 현황 정리', frameHeight: 1640 },
];

const AUCTION_PLANNER_EMBED_BASE = (
  (import.meta as any).env?.VITE_AUCTION_PLANNER_EMBED_BASE || 'https://auction-planner.kr'
).replace(/\/+$/, '');

type PlannerMessage = {
  source?: string;
  type?: string;
  calculator?: PlannerCalculatorKey | string;
  payload?: {
    input?: unknown;
    inputs?: unknown;
    [key: string]: unknown;
  };
  input?: unknown;
  inputs?: unknown;
  timestamp?: string;
};

function PlannerReferencePanel() {
  const [selectedCalculator, setSelectedCalculator] = useState<PlannerCalculatorKey>('acquisition-tax');
  const [message, setMessage] = useState('');
  const [result, setResult] = useState<PlannerMessage | null>(null);
  const [refreshToken, setRefreshToken] = useState(() => Date.now());

  const selected = PLANNER_CALCULATORS.find((item) => item.key === selectedCalculator) || PLANNER_CALCULATORS[0];
  const plannerVersion = selectedCalculator === 'profit' ? '20260702-1' : String(refreshToken);
  const queryEmbedUrl = `${AUCTION_PLANNER_EMBED_BASE}/embed?calculator=${encodeURIComponent(selectedCalculator)}&v=${plannerVersion}`;
  const pathEmbedUrl = selectedCalculator === 'profit'
    ? `${AUCTION_PLANNER_EMBED_BASE}/embed/calculators/profit?calculator=profit&v=${plannerVersion}`
    : `${AUCTION_PLANNER_EMBED_BASE}/embed/calculators/${selectedCalculator}`;
  const embedUrl = selectedCalculator === 'profit' ? pathEmbedUrl : queryEmbedUrl;
  const externalUrl = selectedCalculator === 'profit'
    ? pathEmbedUrl
    : `${AUCTION_PLANNER_EMBED_BASE}/embed?calculator=${encodeURIComponent(selectedCalculator)}`;
  const plannerOrigin = (() => {
    try {
      return new URL(AUCTION_PLANNER_EMBED_BASE).origin;
    } catch {
      return '';
    }
  })();

  useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
      if (plannerOrigin && event.origin !== plannerOrigin) return;
      const data = event.data as PlannerMessage;
      if (!data || data.source !== 'auction-planner') return;
      if (data.type !== 'calculator-result') return;
      const normalizedInput = data.input || data.inputs || data.payload?.input || data.payload?.inputs;
      setResult({
        ...data,
        input: normalizedInput || data.input,
        inputs: data.inputs || data.payload?.inputs,
      });
      const label = PLANNER_CALCULATORS.find((item) => item.key === data.calculator)?.label || '옥션플래너';
      setMessage(`${label} 계산값을 가져왔습니다.`);
    };
    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, [plannerOrigin]);

  const copyResult = async () => {
    if (!result) return;
    await navigator.clipboard.writeText(JSON.stringify(result, null, 2));
    setMessage('가져온 계산값이 복사되었습니다.');
  };

  return (
    <div className="card auction-reference-panel planner-reference-panel">
      <div className="auction-reference-head">
        <div>
          <h3>옥션플래너</h3>
          <p>카테고리를 선택하면 해당 옥션플래너 계산기로 바로 이동하고, 계산 완료 값은 브리핑자료에서 활용합니다.</p>
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button className="btn btn-sm" type="button" onClick={() => setRefreshToken(Date.now())}>새로고침</button>
          <a className="btn btn-sm" href={externalUrl} target="_blank" rel="noreferrer">새 창에서 열기</a>
        </div>
      </div>

      <div className="document-tool-tabs" style={{ marginBottom: 12 }}>
        {PLANNER_CALCULATORS.map((calculator) => (
          <button
            key={calculator.key}
            className={selectedCalculator === calculator.key ? 'active' : ''}
            type="button"
            onClick={() => { setSelectedCalculator(calculator.key); setMessage(''); setResult(null); setRefreshToken(Date.now()); }}
          >
            {calculator.label}
          </button>
        ))}
      </div>

      <div className="planner-selected-row">
        <div>
          <strong>{selected.label}</strong>
          <div style={{ fontSize: '0.78rem', color: '#5f6368', marginTop: 3 }}>{selected.description}</div>
        </div>
        {message && <div className="auction-reference-message" style={{ margin: 0 }}>{message}</div>}
      </div>

      <div className="planner-embed-shell">
        <iframe
          key={embedUrl}
          src={embedUrl}
          title={`옥션플래너 ${selected.label}`}
          className="planner-embed-frame"
          style={{ height: selected.frameHeight, minHeight: selected.frameHeight }}
          loading="lazy"
        />
      </div>

      {result !== null && (
        <div className="auction-reference-content planner-result-content">
          <>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 8 }}>
              <strong>가져온 계산값</strong>
              <button className="btn btn-sm" onClick={copyResult}><Copy size={14} /> 계산값 복사</button>
            </div>
            {JSON.stringify(result, null, 2)}
          </>
        </div>
      )}
    </div>
  );
}

function ProfileSummary({ user }: { user: ReturnType<typeof useAuthStore.getState>['user'] }) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 12, padding: 12, background: '#f8fafc', border: '1px solid #e8eaed', borderRadius: 8 }}>
      <Info label="마이옥션 계정" value={user?.has_myauction_credentials ? `${user.myauction_id || ''} 저장됨` : '미저장'} />
      <Info label="가입자 성명" value={user?.name || '-'} />
      <Info label="직책" value={user?.position_title || '-'} />
      <Info label="전화번호" value={user?.phone || '-'} />
    </div>
  );
}

function Info({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div style={{ fontSize: '0.75rem', color: '#5f6368', marginBottom: 4 }}>{label}</div>
      <div style={{ fontWeight: 700 }}>{value}</div>
    </div>
  );
}

function DownloadButton({ taskId, format, label }: { taskId: string; format: DownloadFormat; label: string }) {
  return (
    <button className="btn btn-primary" onClick={() => automationApi.downloadFile(taskId, format).catch((err) => alert(err.message))}>
      {format === 'zip' ? <Archive size={14} /> : <Download size={14} />} {label}
    </button>
  );
}
