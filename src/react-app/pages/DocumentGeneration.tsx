import { useEffect, useMemo, useRef, useState } from 'react';
import { AlertCircle, Archive, CheckCircle2, Copy, Download, FileText, History, Pencil, Play, Plus, RefreshCw, Save, ShieldCheck, Trash2, X } from 'lucide-react';
import { api } from '../api';
import { automationApi, REQUIRED_AUTOMATION_AGENT_VERSION, type AutomationAgentStatus, type AutomationDiagnostic, type DownloadFormat, type DownloadHistoryItem, type OutputType, type ProgressUpdate } from '../automationApi';
import { DEFAULT_AUCTION_REFERENCES, type AuctionReferenceItem, type AuctionReferenceType } from '../data/auctionReference';
import { clearPlannerDraft, loadPlannerDraft, savePlannerDraft } from '../plannerDraftStorage';
import { useAuthStore } from '../store';

type View = 'select' | 'input' | 'progress' | 'result' | 'history';
type DocumentToolTab = 'briefing' | 'rightsReference' | 'checklistReference' | 'plannerReference';
type AgentState = 'checking' | 'connected' | 'missing' | 'outdated' | 'unverified';
type PlannerSnapshot = {
  id: string;
  calculator: string;
  label: string;
  captured_at: string;
  message: unknown;
  image_data_url?: string;
  include: boolean;
};
type PlannerWorkspace = {
  selectedCalculator?: string;
  calculatorDrafts?: Record<string, PlannerMessage>;
};

const BRIEFING_STEPS = ['브라우저 준비', '사이트 파싱', 'PPT 기본값 입력', '문서 캡처', 'PPT 이미지 삽입', '저장 완료'];
const RIGHTS_STEPS = ['브라우저 준비', '물건정보 확인', '매각물건명세서 확인', '권리분석 문구 구성', '보증서 템플릿 입력', 'PDF/PPTX 변환', '저장 완료'];
const AUCTION_REFERENCE_MANAGER_IDS = ['2b6b3606-e425-4361-a115-9283cfef842f']; // 정민호 지사장

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
  const [diagnostics, setDiagnostics] = useState<AutomationDiagnostic[]>([]);
  const [historyItems, setHistoryItems] = useState<DownloadHistoryItem[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [error, setError] = useState('');
  const [toolTab, setToolTab] = useState<DocumentToolTab>('briefing');
  const [agentState, setAgentState] = useState<AgentState>('checking');
  const [agentStatus, setAgentStatus] = useState<AutomationAgentStatus | null>(null);
  const [agentModalOpen, setAgentModalOpen] = useState(false);
  const [plannerOptionalNotice, setPlannerOptionalNotice] = useState<string[] | null>(null);
  const [plannerSnapshots, setPlannerSnapshots] = useState<PlannerSnapshot[]>([]);
  const [plannerWorkspace, setPlannerWorkspace] = useState<PlannerWorkspace>({});
  const plannerHydratedUserRef = useRef('');
  const plannerExportAllRef = useRef<(() => Promise<PlannerSnapshot[]>) | null>(null);
  const plannerOptionalResolveRef = useRef<((proceed: boolean) => void) | null>(null);
  const diagnosticSyncRef = useRef('');

  const canUseRights = user?.role === 'master' || reportPermission === 'special';
  const canManageAuctionReferences = Boolean(
    user && (['master', 'ceo'].includes(user.role) || AUCTION_REFERENCE_MANAGER_IDS.includes(user.id))
  );
  const isRights = outputType === 'rights_certificate';
  const rightsUrls = useMemo(() => rightsUrlsText.split(/[\n,]+/).map((item) => item.trim()).filter(Boolean), [rightsUrlsText]);
  const stepLabels = isRights ? RIGHTS_STEPS : BRIEFING_STEPS;
  const logEndRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    setOutputType(initialType);
  }, [initialType]);

  useEffect(() => {
    if (!canManageAuctionReferences && (toolTab === 'rightsReference' || toolTab === 'checklistReference')) {
      setToolTab('briefing');
    }
  }, [canManageAuctionReferences, toolTab]);

  useEffect(() => {
    const userId = user?.id || '';
    if (!userId || plannerHydratedUserRef.current === userId) return;
    const saved = loadPlannerDraft(userId);
    setPlannerSnapshots((saved?.snapshots || []) as PlannerSnapshot[]);
    setPlannerWorkspace((saved?.workspace || {}) as PlannerWorkspace);
    plannerHydratedUserRef.current = userId;
  }, [user?.id]);

  useEffect(() => {
    const userId = user?.id || '';
    if (!userId || plannerHydratedUserRef.current !== userId) return;
    savePlannerDraft(userId, { snapshots: plannerSnapshots, workspace: plannerWorkspace });
  }, [plannerSnapshots, plannerWorkspace, user?.id]);

  const resetPlannerDraft = () => {
    if (!window.confirm('옥션플래너에 임시 저장된 입력값과 브리핑 저장자료를 모두 초기화할까요?')) return;
    setPlannerSnapshots([]);
    setPlannerWorkspace({});
    if (user?.id) clearPlannerDraft(user.id);
  };

  const refreshAgentStatus = async (showWhenMissing = false, showChecking = true, showDetails = false) => {
    if (showChecking) setAgentState('checking');
    const status = await automationApi.checkAgent();
    setAgentStatus(status);
    const nextState: AgentState = status.ok
      ? (!status.latestVersionVerified ? 'unverified' : status.updateRequired ? 'outdated' : 'connected')
      : 'missing';
    setAgentState(nextState);
    if (showDetails || (nextState !== 'connected' && showWhenMissing)) setAgentModalOpen(true);
    else if (nextState === 'connected') setAgentModalOpen(false);
    return nextState === 'connected';
  };

  useEffect(() => {
    refreshAgentStatus(true);
    const timer = window.setInterval(() => refreshAgentStatus(false, false), 30000);
    return () => window.clearInterval(timer);
  }, []);

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
        if (Array.isArray(res.diagnostics) && res.diagnostics.length > 0) setDiagnostics(res.diagnostics);
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
    const logEl = logEndRef.current?.parentElement;
    if (logEl) logEl.scrollTop = logEl.scrollHeight;
  }, [updates, view]);

  useEffect(() => {
    if (!result?.taskId) return;
    const syncKey = `${result.taskId}:${diagnostics.length}:${diagnostics.map((item) => item.status).join(',')}`;
    if (diagnosticSyncRef.current === syncKey) return;
    diagnosticSyncRef.current = syncKey;
    let cancelled = false;
    const sync = async () => {
      try {
        const history = await automationApi.history();
        const localItem = (history.items || []).find((item) => item.task_id === result.taskId);
        if (cancelled) return;
        await api.automationDiagnostics.save({
          task_id: result.taskId,
          output_type: result.outputType,
          file_name: localItem?.file_name || '',
          success: result.success,
          message: result.message,
          agent_version: agentStatus?.version || '',
          diagnostics,
        });
      } catch {
        // 중앙 진단 저장 실패가 로컬 파일 생성과 다운로드를 막지 않도록 한다.
      }
    };
    sync();
    return () => { cancelled = true; };
  }, [result, diagnostics, agentStatus?.version]);

  const selectWork = (next: OutputType) => {
    if (agentState !== 'connected') {
      setAgentModalOpen(true);
      return;
    }
    if (next === 'rights_certificate' && !canUseRights) {
      setError('권리분석 보증서는 master 또는 special 권한만 생성할 수 있습니다.');
      return;
    }
    setError('');
    setOutputType(next);
    setView('input');
  };

  const loadAutomationReferences = async () => {
    let customChecklist: AuctionReferenceItem[] = [];
    try {
      const res = await api.auctionReference.list('checklist');
      customChecklist = (res.items || []).map((item) => ({ ...item, source: 'custom' as const }));
    } catch {
      customChecklist = [];
    }
    return {
      checklist: mergeReferenceItems('checklist', customChecklist).map((item) => ({
        id: item.id,
        type: 'checklist' as const,
        category: item.category || '',
        title: item.title,
        content: stripInternalCodes(item.content),
        source: item.source,
      })),
    };
  };

  const commonPayload = async (snapshots = plannerSnapshots) => ({
    remember_login: rememberLogin,
    requester_permission: reportPermission,
    planner_snapshots: snapshots.filter((item) => item.include),
    auction_references: await loadAutomationReferences(),
  });

  const confirmWithoutPlanner = (missingLabels: string[]) => new Promise<boolean>((resolve) => {
    plannerOptionalResolveRef.current = resolve;
    setPlannerOptionalNotice(missingLabels);
  });

  const closePlannerOptionalNotice = (proceed: boolean) => {
    setPlannerOptionalNotice(null);
    const resolve = plannerOptionalResolveRef.current;
    plannerOptionalResolveRef.current = null;
    resolve?.(proceed);
  };

  const collectLatestPlannerSnapshots = async (): Promise<PlannerSnapshot[] | null> => {
    const required = ['acquisition-tax', 'loan-bid-estimator', 'acquisition-cost-sheet'];
    const hasPlannerInput = Object.keys(plannerWorkspace.calculatorDrafts || {}).some((key) => required.includes(key));
    if (!hasPlannerInput) {
      const proceed = await confirmWithoutPlanner(required.map((key) => PLANNER_CALCULATORS.find((item) => item.key === key)?.label || key));
      return proceed ? [] : null;
    }

    const exported = plannerExportAllRef.current ? await plannerExportAllRef.current() : [];
    const missing = required.filter((calculator) => !exported.some((item) => item.calculator === calculator && item.image_data_url));
    if (missing.length > 0) {
      const labels = missing.map((key) => PLANNER_CALCULATORS.find((item) => item.key === key)?.label || key);
      const proceed = await confirmWithoutPlanner(labels);
      if (!proceed) return null;
    }
    setPlannerSnapshots(exported);
    return exported;
  };

  const validateInput = () => {
    if (!user?.has_myauction_credentials) return '내 정보 수정에서 마이옥션 아이디와 비밀번호를 먼저 저장해 주세요.';
    if (!user?.name?.trim() || !user?.position_title?.trim() || !user?.phone?.trim()) return '내 정보 수정에서 이름, 직책, 전화번호를 먼저 저장해 주세요.';
    if (isRights && !canUseRights) return '권리분석 보증서는 master 또는 special 권한만 생성할 수 있습니다.';
    if (isRights && rightsUrls.length === 0) return '권리분석 보증서 URL을 1개 이상 입력하세요.';
    if (!isRights && !briefingUrl.trim()) return '브리핑자료 사건 URL을 입력하세요.';
    return '';
  };

  const startGeneration = async () => {
    const agentOk = await refreshAgentStatus(true);
    if (!agentOk) return;
    const validation = validateInput();
    if (validation) {
      setError(validation);
      return;
    }
    setStarting(true);
    setError('');
    setDiagnostics([]);
    try {
      const latestPlannerSnapshots = isRights ? plannerSnapshots : await collectLatestPlannerSnapshots();
      if (latestPlannerSnapshots === null) return;
      const payload = await commonPayload(latestPlannerSnapshots);
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
      <div className="page-header document-page-header">
        <div className="document-page-title">
          <span className="document-page-title-icon"><FileText size={22} /></span>
          <div>
            <h2>자료 생성</h2>
            <p>사건 정보부터 완성 문서까지, 한 화면에서 안전하게 생성합니다.</p>
          </div>
        </div>
        <div className="document-page-actions">
          <button className={`automation-agent-badge ${agentState}`} onClick={() => refreshAgentStatus(false, true, true)} type="button">
            {agentState === 'connected' ? <CheckCircle2 size={14} /> : <AlertCircle size={14} />}
            {agentState === 'checking'
              ? '실행기 확인 중'
              : agentState === 'connected'
                ? '자동화 실행기 최신'
                : agentState === 'outdated'
                  ? '자동화 실행기 업데이트 필요'
                  : agentState === 'unverified'
                    ? '최신 버전 확인 필요'
                  : '자동화 실행기 필요'}
          </button>
          <button className="btn btn-sm" onClick={() => setView('select')}>작업 선택</button>
          <button className="btn btn-sm" onClick={loadHistory}><History size={14} /> 이력</button>
        </div>
      </div>

      {toolTab === 'plannerReference' && plannerSnapshots.length > 0 && (
        <PlannerSnapshotList
          snapshots={plannerSnapshots}
          onToggleSnapshot={(id) => setPlannerSnapshots((prev) => prev.map((item) => item.id === id ? { ...item, include: !item.include } : item))}
          onRemoveSnapshot={(id) => setPlannerSnapshots((prev) => prev.filter((item) => item.id !== id))}
        />
      )}

      {agentModalOpen && (
        <AutomationAgentModal
          state={agentState}
          status={agentStatus}
          onClose={() => setAgentModalOpen(false)}
          onRecheck={() => refreshAgentStatus(false, true, true)}
        />
      )}

      {plannerOptionalNotice && (
        <div className="automation-agent-modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="planner-optional-title">
          <div className="automation-agent-modal planner-optional-modal">
            <div className="automation-agent-modal-head">
              <div>
                <span className="automation-agent-kicker">선택 자료 안내</span>
                <h3 id="planner-optional-title">옥션플래너 자료를 추가하지 않았습니다</h3>
              </div>
            </div>
            <div className="automation-agent-modal-body">
              <p>옥션플래너 자료는 필수값이 아닙니다. 아래 자료 없이 브리핑 자료를 계속 생성할 수 있습니다.</p>
              <div className="planner-optional-missing-list">
                {plannerOptionalNotice.map((label) => <span key={label}>{label}</span>)}
              </div>
            </div>
            <div className="automation-agent-modal-actions">
              <button className="btn btn-secondary" type="button" onClick={() => closePlannerOptionalNotice(false)}>닫기</button>
              <button className="btn btn-primary" type="button" onClick={() => closePlannerOptionalNotice(true)}>계속</button>
            </div>
          </div>
        </div>
      )}

      {error && (
        <div className="card" style={{ marginBottom: 16, borderLeft: '3px solid #d93025', color: '#d93025', padding: 14 }}>
          {error}
        </div>
      )}

      <div className="document-tool-tabs">
        <button className={toolTab === 'briefing' ? 'active' : ''} onClick={() => setToolTab('briefing')}>업무 자동화</button>
        {canManageAuctionReferences && (
          <button className={toolTab === 'rightsReference' ? 'active' : ''} onClick={() => setToolTab('rightsReference')}>권리분석 관리</button>
        )}
        {canManageAuctionReferences && (
          <button className={toolTab === 'checklistReference' ? 'active' : ''} onClick={() => setToolTab('checklistReference')}>물건별 체크리스트 관리</button>
        )}
        <button className={toolTab === 'plannerReference' ? 'active' : ''} onClick={() => setToolTab('plannerReference')}>옥션플래너</button>
      </div>

      <div style={{ display: toolTab === 'plannerReference' ? 'block' : 'none' }} aria-hidden={toolTab !== 'plannerReference'}>
        <PlannerReferencePanel
          workspace={plannerWorkspace}
          onWorkspaceChange={setPlannerWorkspace}
          onReset={resetPlannerDraft}
          onSaveSnapshot={(snapshot) => setPlannerSnapshots((prev) => [snapshot, ...prev.filter((item) => item.calculator !== snapshot.calculator)].slice(0, 12))}
          registerExportAll={(exporter) => { plannerExportAllRef.current = exporter; }}
        />
      </div>

      {toolTab === 'rightsReference' ? (
        canManageAuctionReferences ? <RightsLegalReferencePanel canManage /> : null
      ) : toolTab === 'plannerReference' ? (
        null
      ) : referenceType ? (
        canManageAuctionReferences ? <ChecklistReferencePanel canManage /> : null
      ) : (
        <>
      {view === 'select' && (
        <div className="document-select-wrap">
          <section className="document-automation-hero">
            <div>
              <span className="document-section-kicker">DOCUMENT AUTOMATION</span>
              <h3>어떤 자료를 준비할까요?</h3>
              <p>작업 유형을 선택하면 필요한 입력 항목과 생성 과정을 순서대로 안내합니다.</p>
            </div>
            <div className="document-hero-points">
              <span><CheckCircle2 size={14} /> 자동 수집</span>
              <span><CheckCircle2 size={14} /> 템플릿 반영</span>
              <span><CheckCircle2 size={14} /> 즉시 다운로드</span>
            </div>
          </section>
          <div className="document-work-grid">
          <button className="document-work-button briefing" type="button" onClick={() => selectWork('auction_report')}>
            <span className="document-work-icon"><FileText size={24} /></span>
            <span className="document-work-copy">
              <span className="document-work-label">AUCTION BRIEF</span>
              <strong>브리핑자료</strong>
              <small>사건 URL 1개로 PPT/PDF 출력물을 생성합니다.</small>
              <span className="document-work-formats"><b>PPTX</b><b>PDF</b><b>옥션플래너 연동</b></span>
            </span>
            <span className="document-work-action">시작</span>
          </button>
          <button className={`document-work-button rights ${canUseRights ? '' : 'disabled'}`} type="button" onClick={() => selectWork('rights_certificate')} aria-disabled={!canUseRights}>
            <span className="document-work-icon"><ShieldCheck size={24} /></span>
            <span className="document-work-copy">
              <span className="document-work-label">RIGHTS REPORT</span>
              <strong>권리분석 보증서</strong>
              <small>{canUseRights ? '여러 URL을 순차 처리하고 ZIP 다운로드를 제공합니다.' : 'special 권한 이상 사용 가능합니다.'}</small>
              <span className="document-work-formats"><b>PPTX</b><b>PDF</b><b>일괄 ZIP</b></span>
            </span>
            <span className="document-work-action">{canUseRights ? '시작' : '권한 필요'}</span>
          </button>
          </div>
        </div>
      )}

      {view === 'input' && (
        <div className="card document-generator-card">
          <div className="document-generator-head">
            <div className={`document-generator-icon ${isRights ? 'rights' : 'briefing'}`}>
              {isRights ? <ShieldCheck size={22} /> : <FileText size={22} />}
            </div>
            <div>
              <span className="document-section-kicker">{isRights ? 'RIGHTS CERTIFICATE' : 'BRIEFING MATERIALS'}</span>
              <h3>{isRights ? '권리분석 보증서 생성' : '브리핑자료 생성'}</h3>
              <p>{isRights ? '여러 사건 URL을 한 줄에 하나씩 입력해 주세요.' : '마이옥션 사건 상세 URL 하나만 입력하면 됩니다.'}</p>
            </div>
          </div>
          <div className="document-generator-body">
            {isRights ? (
              <div className="document-primary-field">
                <label className="label">사건 URL 여러 개</label>
                <textarea className="form-input" value={rightsUrlsText} onChange={(e) => setRightsUrlsText(e.target.value)} rows={7} placeholder={'https://www.my-auction.co.kr/view/1111111\nhttps://www.my-auction.co.kr/view/2222222'} style={{ width: '100%', resize: 'vertical' }} />
                <div className="document-field-hint"><CheckCircle2 size={13} /> {rightsUrls.length}개 URL 입력됨</div>
              </div>
            ) : (
              <div className="document-primary-field">
                <label className="label">사건 URL</label>
                <input className="form-input" value={briefingUrl} onChange={(e) => setBriefingUrl(e.target.value)} placeholder="https://www.my-auction.co.kr/view/사건번호" style={{ width: '100%' }} />
                {plannerSnapshots.length > 0 && (
                  <div className="document-planner-note">
                    <Save size={14} /> 옥션플래너 저장자료 <strong>{plannerSnapshots.filter((item) => item.include).length}/{plannerSnapshots.length}건</strong>이 함께 반영됩니다.
                  </div>
                )}
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

            <label className="document-session-option">
              <input type="checkbox" checked={rememberLogin} onChange={(e) => setRememberLogin(e.target.checked)} />
              <span><strong>자동 로그인 세션 유지</strong><small>다음 작업에서도 저장된 마이옥션 로그인을 사용합니다.</small></span>
            </label>

            <div className="document-generator-actions">
              <button className="btn btn-primary document-start-button" onClick={startGeneration} disabled={starting}>
                <Play size={15} /> {starting ? '생성을 준비하고 있습니다...' : `${isRights ? '보증서' : '브리핑자료'} 생성 시작`}
              </button>
              <button className="btn" onClick={() => setView('select')}>작업 다시 선택</button>
            </div>
          </div>
        </div>
      )}

      {view === 'progress' && (
        <div className="document-progress-wrap">
          <div className="card document-progress-overview">
            <div className="document-progress-heading">
              <div>
                <span className="document-section-kicker">GENERATING DOCUMENT</span>
                <h3>{isRights ? '권리분석 보증서를 만들고 있습니다' : '브리핑자료를 만들고 있습니다'}</h3>
              </div>
              <strong>{Math.round(currentPercent)}<small>%</small></strong>
            </div>
            <div className="document-progress-track">
              <div className={currentProgress?.status === 'error' ? 'error' : ''} style={{ width: `${currentPercent}%` }} />
            </div>
            <div className="document-progress-message">{currentProgress?.message || '작업을 준비하고 있습니다.'}</div>
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
            <div className={`card document-result-card ${result.success ? 'success' : 'error'}`}>
              <div className="document-result-head">
                <span>{result.success ? <CheckCircle2 size={23} /> : <AlertCircle size={23} />}</span>
                <div><h3>{result.success ? '자료 생성이 완료되었습니다' : '자료 생성에 실패했습니다'}</h3><p>{result.message}</p></div>
              </div>
              {result.success && (
                <div className="document-download-grid">
                  {!result.isBatch && <DownloadButton taskId={result.taskId} format="pptx" label="PPT 다운로드" />}
                  {!result.isBatch && <DownloadButton taskId={result.taskId} format="pdf" label="PDF 다운로드" />}
                  {result.isBatch && <DownloadButton taskId={result.taskId} format="zip" label="ZIP 다운로드" />}
                </div>
              )}
              {diagnostics.length > 0 && <AutomationDiagnostics diagnostics={diagnostics} />}
            </div>
          )}
        </div>
      )}

      {view === 'result' && result && (
        <div className={`card document-result-card ${result.success ? 'success' : 'error'}`}>
          <div className="document-result-head">
            <span>{result.success ? <CheckCircle2 size={23} /> : <AlertCircle size={23} />}</span>
            <div><h3>{result.success ? '자료 생성이 완료되었습니다' : '자료 생성에 실패했습니다'}</h3><p>{result.message}</p></div>
          </div>
          {result.success && (
            <div className="document-download-grid">
              {!result.isBatch && <DownloadButton taskId={result.taskId} format="pptx" label="PPT 다운로드" />}
              {!result.isBatch && <DownloadButton taskId={result.taskId} format="pdf" label="PDF 다운로드" />}
              {result.isBatch && <DownloadButton taskId={result.taskId} format="zip" label="ZIP 다운로드" />}
            </div>
          )}
          {diagnostics.length > 0 && <AutomationDiagnostics diagnostics={diagnostics} />}
        </div>
      )}

      {view === 'history' && (
        <div className="card document-history-card">
          <div className="document-history-head">
            <div>
              <h3 style={{ margin: 0 }}>다운로드 이력</h3>
              <p style={{ margin: '4px 0 0', color: '#5f6368', fontSize: '0.8rem' }}>기간 제한 없이 로컬 파일이 남아 있는 동안 재다운로드할 수 있으며, 목록에는 최근 20건까지 표시됩니다.</p>
            </div>
            <button className="btn btn-sm" onClick={loadHistory} disabled={historyLoading}><RefreshCw size={14} /> 목록 새로고침</button>
          </div>
          {historyItems.length === 0 ? (
            <div className="empty-state">다운로드 이력이 없습니다.</div>
          ) : (
            <div className="table-wrapper">
              <table className="data-table">
                <thead><tr><th>파일</th><th>종류</th><th>생성일</th><th>진단</th><th>다운로드</th></tr></thead>
                <tbody>
                  {historyItems.map((item) => (
                    <tr key={item.id}>
                      <td>{item.file_name || item.title}</td>
                      <td>{item.output_type === 'rights_certificate' ? '권리분석 보증서' : '브리핑자료'}</td>
                      <td>{item.created_at ? new Date(item.created_at).toLocaleString('ko-KR') : '-'}</td>
                      <td>
                        {item.diagnostics?.length
                          ? <AutomationDiagnostics diagnostics={item.diagnostics} compact />
                          : <span style={{ color: '#94a3b8', fontSize: '0.78rem' }}>진단정보 없음</span>}
                      </td>
                      <td>
                        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                          {item.formats.map((format) => (
                            <button key={format} className="btn btn-sm" onClick={() => automationApi.downloadHistoryFile(item.id, format, item.file_name).catch((err) => setError(err.message))}>{format.toUpperCase()}</button>
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
    const order = ['공통', '주거용 부동산', '상업용 부동산', '토지', '기타', '사용자 추가'];
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
    const baseTitle = selected?.title && selectedCategory !== '공통' ? `${selected.title} 추가점검` : '';
    setEditing({ category: selectedCategory || '사용자 추가', title: baseTitle, content: '' });
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

type PlannerCalculatorKey = 'acquisition-tax' | 'brokerage-fee' | 'profit' | 'bid-price' | 'cost-analysis' | 'tenant-registry' | 'acquisition-cost-sheet' | 'loan-bid-estimator';

const PLANNER_CALCULATORS: { key: PlannerCalculatorKey; label: string; description: string; frameHeight: number }[] = [
  { key: 'acquisition-tax', label: '취득세 계산기', description: '부동산 취득 시 납부해야 할 취득세 계산', frameHeight: 1320 },
  { key: 'brokerage-fee', label: '중개수수료', description: '부동산 임대, 매매 시 중개수수료 계산', frameHeight: 1220 },
  { key: 'profit', label: '수익률 계산기', description: '투자 수익률 예상 수치 제공', frameHeight: 1500 },
  { key: 'bid-price', label: '적정입찰가', description: '최적의 입찰가로 낙찰 확률 증가', frameHeight: 1420 },
  { key: 'cost-analysis', label: '원가분석계산', description: '총 투입 원가 분석', frameHeight: 1560 },
  { key: 'tenant-registry', label: '임차인등록표', description: '임차인 현황 정리', frameHeight: 1640 },
  { key: 'loan-bid-estimator', label: '예상입찰가', description: '대출 조건을 반영한 예상 입찰가 산정', frameHeight: 1600 },
  { key: 'acquisition-cost-sheet', label: '비용계산표', description: '취득 비용계산표 작성', frameHeight: 1600 },
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

function findPlannerImageDataUrl(value: unknown): string | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const record = value as Record<string, unknown>;
  for (const key of ['imageDataUrl', 'image_data_url', 'screenshotDataUrl', 'screenshot', 'capture', 'thumbnail']) {
    const item = record[key];
    if (typeof item === 'string' && item.startsWith('data:image/')) return item;
  }
  for (const key of ['payload', 'result', 'results', 'data']) {
    const found = findPlannerImageDataUrl(record[key]);
    if (found) return found;
  }
  return undefined;
}

function PlannerSnapshotList({
  snapshots,
  onToggleSnapshot,
  onRemoveSnapshot,
}: {
  snapshots: PlannerSnapshot[];
  onToggleSnapshot: (id: string) => void;
  onRemoveSnapshot: (id: string) => void;
}) {
  if (snapshots.length === 0) return null;
  return (
    <div className="card planner-top-snapshot-list">
      <div style={{ fontWeight: 700, marginBottom: 8 }}>브리핑자료 저장목록</div>
      <div style={{ display: 'grid', gap: 6 }}>
        {snapshots.map((item) => (
          <div key={item.id} style={{ display: 'flex', alignItems: 'center', gap: 8, justifyContent: 'space-between', borderBottom: '1px solid #eef2f7', paddingBottom: 6 }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
              <input type="checkbox" checked={item.include} onChange={() => onToggleSnapshot(item.id)} />
              <span>{item.label}</span>
              <span style={{ fontSize: '0.72rem', color: '#5f6368' }}>{item.image_data_url ? '이미지 포함' : '값만 저장'}</span>
            </label>
            <button className="btn btn-sm danger" type="button" onClick={() => onRemoveSnapshot(item.id)}>삭제</button>
          </div>
        ))}
      </div>
    </div>
  );
}

function PlannerReferencePanel({
  workspace,
  onWorkspaceChange,
  onReset,
  onSaveSnapshot,
  registerExportAll,
}: {
  workspace: PlannerWorkspace;
  onWorkspaceChange: (workspace: PlannerWorkspace) => void;
  onReset: () => void;
  onSaveSnapshot: (snapshot: PlannerSnapshot) => void;
  registerExportAll: (exporter: () => Promise<PlannerSnapshot[]>) => void;
}) {
  const initialCalculator = PLANNER_CALCULATORS.some((item) => item.key === workspace.selectedCalculator)
    ? workspace.selectedCalculator as PlannerCalculatorKey
    : 'acquisition-tax';
  const [selectedCalculator, setSelectedCalculator] = useState<PlannerCalculatorKey>(initialCalculator);
  const [message, setMessage] = useState('');
  const [result, setResult] = useState<PlannerMessage | null>(() => workspace.calculatorDrafts?.[initialCalculator] || null);
  const [refreshToken, setRefreshToken] = useState(() => Date.now());
  const iframeRef = useRef<HTMLIFrameElement | null>(null);

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
      if (event.source !== iframeRef.current?.contentWindow) return;
      const data = event.data as PlannerMessage;
      if (!data || typeof data !== 'object') return;
      const knownCalculator = PLANNER_CALCULATORS.some((item) => item.key === data.calculator);
      if (data.source !== 'auction-planner' && !knownCalculator) return;
      if (data.type && ![
        'calculator-result', 'calculator-export', 'auction-planner-result', 'snapshot',
        'calculator-draft', 'calculator-change', 'form-change', 'draft',
      ].includes(data.type)) return;
      const normalizedInput = data.input || data.inputs || data.payload?.input || data.payload?.inputs;
      const normalized = {
        ...data,
        input: normalizedInput || data.input,
        inputs: data.inputs || data.payload?.inputs,
      };
      const calculator = String(data.calculator || selectedCalculator);
      setResult(normalized);
      onWorkspaceChange({
        selectedCalculator: calculator,
        calculatorDrafts: { ...(workspace.calculatorDrafts || {}), [calculator]: normalized },
      });
      const label = PLANNER_CALCULATORS.find((item) => item.key === data.calculator)?.label || '옥션플래너';
      const isDraft = ['calculator-draft', 'calculator-change', 'form-change', 'draft'].includes(String(data.type || ''));
      setMessage(isDraft ? `${label} 작성 중 내용을 임시 저장했습니다.` : `${label} 계산값을 가져왔습니다.`);
    };
    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, [onWorkspaceChange, plannerOrigin, selectedCalculator, workspace.calculatorDrafts]);

  useEffect(() => {
    const restored = workspace.calculatorDrafts?.[selectedCalculator] || null;
    setResult(restored);
  }, [selectedCalculator, workspace.calculatorDrafts]);

  useEffect(() => {
    const clearEmbeddedDraft = () => {
      iframeRef.current?.contentWindow?.postMessage({
        source: 'my-auction-docs',
        type: 'planner-clear-draft',
      }, plannerOrigin || '*');
    };
    window.addEventListener('myauction:planner-clear', clearEmbeddedDraft);
    return () => window.removeEventListener('myauction:planner-clear', clearEmbeddedDraft);
  }, [plannerOrigin]);

  const restoreIframeDraft = () => {
    const draft = workspace.calculatorDrafts?.[selectedCalculator];
    if (!draft || !iframeRef.current?.contentWindow) return;
    iframeRef.current.contentWindow.postMessage({
      source: 'my-auction-docs',
      type: 'planner-restore',
      calculator: selectedCalculator,
      payload: draft,
    }, plannerOrigin || '*');
    setMessage(`${selected.label} 임시 저장자료를 불러왔습니다.`);
  };

  const requestPlannerExport = () => new Promise<PlannerMessage>((resolve, reject) => {
    const timeout = window.setTimeout(() => {
      window.removeEventListener('message', handleExport);
      reject(new Error('옥션플래너 이미지 생성 응답 시간이 초과되었습니다.'));
    }, 20000);
    function handleExport(event: MessageEvent) {
      if (plannerOrigin && event.origin !== plannerOrigin) return;
      const data = event.data as PlannerMessage;
      if (!data || typeof data !== 'object') return;
      if (String(data.calculator || '') !== selectedCalculator) return;
      if (!findPlannerImageDataUrl(data)) return;
      window.clearTimeout(timeout);
      window.removeEventListener('message', handleExport);
      resolve(data);
    }
    window.addEventListener('message', handleExport);
    iframeRef.current?.contentWindow?.postMessage({
      source: 'my-auction-docs',
      type: 'calculator-export-request',
      calculator: selectedCalculator,
    }, plannerOrigin || '*');
  });

  const requestCalculatorImage = (calculator: PlannerCalculatorKey) => new Promise<PlannerSnapshot | null>((resolve) => {
    const iframe = document.createElement('iframe');
    const requestId = `${calculator}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    let settled = false;
    const finish = (snapshot: PlannerSnapshot | null) => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timeout);
      retryTimers.forEach(window.clearTimeout);
      window.removeEventListener('message', handleExport);
      iframe.remove();
      resolve(snapshot);
    };
    const handleExport = (event: MessageEvent) => {
      if (plannerOrigin && event.origin !== plannerOrigin) return;
      if (event.source !== iframe.contentWindow) return;
      const message = event.data as PlannerMessage & Record<string, unknown>;
      if (!message || String(message.calculator || '') !== calculator) return;
      const imageDataUrl = findPlannerImageDataUrl(message);
      if (!imageDataUrl) return;
      const label = PLANNER_CALCULATORS.find((item) => item.key === calculator)?.label || calculator;
      finish({
        id: requestId,
        calculator,
        label,
        captured_at: String(message.timestamp || new Date().toISOString()),
        message,
        image_data_url: imageDataUrl,
        include: true,
      });
    };
    const requestExport = () => {
      const target = iframe.contentWindow;
      if (!target) return;
      const draft = workspace.calculatorDrafts?.[calculator];
      if (draft) {
        target.postMessage({
          source: 'my-auction-docs',
          type: 'planner-restore',
          calculator,
          payload: draft,
        }, plannerOrigin || '*');
      }
      target.postMessage({
        source: 'my-auction-docs',
        type: 'calculator-export-request',
        calculator,
        request_id: requestId,
      }, plannerOrigin || '*');
    };
    const retryTimers: number[] = [];
    const timeout = window.setTimeout(() => finish(null), 20000);
    window.addEventListener('message', handleExport);
    iframe.title = `${calculator} 이미지 내보내기`;
    iframe.src = `${AUCTION_PLANNER_EMBED_BASE}/embed?calculator=${encodeURIComponent(calculator)}&v=${Date.now()}`;
    iframe.setAttribute('aria-hidden', 'true');
    Object.assign(iframe.style, {
      position: 'fixed',
      left: '-20000px',
      top: '0',
      width: '1280px',
      height: '1400px',
      opacity: '0',
      pointerEvents: 'none',
    });
    iframe.addEventListener('load', () => {
      retryTimers.push(window.setTimeout(requestExport, 500));
      retryTimers.push(window.setTimeout(requestExport, 4000));
      retryTimers.push(window.setTimeout(requestExport, 9000));
    }, { once: true });
    document.body.appendChild(iframe);
  });

  const requestPlannerExportAll = async () => {
    const calculators = (Object.keys(workspace.calculatorDrafts || {}) as PlannerCalculatorKey[])
      .filter((key) => PLANNER_CALCULATORS.some((item) => item.key === key));
    if (calculators.length === 0) return [];
    const snapshots = await Promise.all(calculators.map(requestCalculatorImage));
    return snapshots.filter((item): item is PlannerSnapshot => Boolean(item?.image_data_url));
  };

  useEffect(() => {
    registerExportAll(requestPlannerExportAll);
  }, [plannerOrigin, registerExportAll, workspace.calculatorDrafts]);

  const saveSnapshot = async () => {
    if (!result) return;
    let exportResult = result;
    let imageDataUrl = findPlannerImageDataUrl(exportResult);
    if (!imageDataUrl) {
      setMessage(`${selected.label} 이미지를 생성하고 있습니다...`);
      try {
        exportResult = await requestPlannerExport();
        imageDataUrl = findPlannerImageDataUrl(exportResult);
      } catch (err: any) {
        setMessage(err?.message || `${selected.label} 이미지를 생성하지 못했습니다. 다시 시도해 주세요.`);
        return;
      }
    }
    const label = PLANNER_CALCULATORS.find((item) => item.key === exportResult.calculator)?.label || selected.label;
    onSaveSnapshot({
      id: `${exportResult.calculator || selectedCalculator}-${Date.now()}`,
      calculator: String(exportResult.calculator || selectedCalculator),
      label,
      captured_at: new Date().toISOString(),
      message: exportResult,
      image_data_url: imageDataUrl,
      include: true,
    });
    setMessage(`${label} 자료를 브리핑자료에 저장했습니다.`);
  };

  const renderCalculatorButton = (calculator: { key: PlannerCalculatorKey; label: string }) => (
    <button
      key={calculator.key}
      className={selectedCalculator === calculator.key ? 'active' : ''}
      type="button"
      onClick={() => {
        setSelectedCalculator(calculator.key);
        setMessage('');
        setResult(workspace.calculatorDrafts?.[calculator.key] || null);
        onWorkspaceChange({ ...workspace, selectedCalculator: calculator.key });
        setRefreshToken(Date.now());
      }}
    >
      {calculator.label}
    </button>
  );

  return (
    <div className="card auction-reference-panel planner-reference-panel">
      <div className="auction-reference-head">
        <div>
          <h3>옥션플래너</h3>
          <p>카테고리를 선택하면 해당 옥션플래너 계산기로 바로 이동하고, 계산 완료 값은 브리핑자료에서 활용합니다.</p>
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button className="btn btn-sm" type="button" onClick={() => setRefreshToken(Date.now())}>새로고침</button>
          <button className="btn btn-sm danger" type="button" onClick={onReset}><Trash2 size={14} /> 임시저장 초기화</button>
          <a className="btn btn-sm" href={externalUrl} target="_blank" rel="noreferrer">새 창에서 열기</a>
        </div>
      </div>

      <div className="document-tool-tabs" style={{ marginBottom: 12 }}>
        {PLANNER_CALCULATORS.slice(0, 6).map(renderCalculatorButton)}
        <span className="planner-tab-section-label">입찰/비용</span>
        {PLANNER_CALCULATORS.slice(6).map(renderCalculatorButton)}
      </div>

      <div className="planner-selected-row">
        <div>
          <strong>{selected.label}</strong>
          <div style={{ fontSize: '0.78rem', color: '#5f6368', marginTop: 3 }}>{selected.description}</div>
        </div>
        <div className="planner-selected-actions">
          {message && <div className="auction-reference-message" style={{ margin: 0 }}>{message}</div>}
          {result && (
            <button className="btn btn-primary planner-save-action" onClick={saveSnapshot} type="button">
              <Save size={15} /> 브리핑자료에 저장
            </button>
          )}
        </div>
      </div>

      <div className="planner-embed-shell">
        <iframe
          ref={iframeRef}
          key={embedUrl}
          src={embedUrl}
          title={`옥션플래너 ${selected.label}`}
          className="planner-embed-frame"
          style={{ height: selected.frameHeight, minHeight: selected.frameHeight }}
          loading="eager"
          onLoad={restoreIframeDraft}
        />
      </div>

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

function AutomationDiagnostics({ diagnostics, compact = false }: { diagnostics: AutomationDiagnostic[]; compact?: boolean }) {
  const issueCount = diagnostics.filter((item) => item.status === 'warning' || item.status === 'error').length;
  const summary = issueCount > 0 ? `확인 필요 ${issueCount}건` : '전체 정상';
  const copyDiagnostics = async () => {
    const text = diagnostics
      .map((item) => `[${item.status.toUpperCase()}] ${item.label}: ${item.message}`)
      .join('\n');
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      window.prompt('아래 진단 내용을 복사해 주세요.', text);
    }
  };

  const list = (
    <div className="automation-diagnostic-list">
      {diagnostics.map((item) => (
        <div key={item.key} className={`automation-diagnostic-item ${item.status}`}>
          <span>{item.status === 'ok' ? '정상' : item.status === 'skipped' ? '생략' : '확인'}</span>
          <div><strong>{item.label}</strong><small>{item.message}</small></div>
        </div>
      ))}
    </div>
  );

  if (compact) {
    return (
      <details className={`automation-diagnostic-details ${issueCount ? 'has-issues' : ''}`}>
        <summary>{summary}</summary>
        {list}
        <button className="btn btn-sm" type="button" onClick={copyDiagnostics}><Copy size={13} /> 진단 복사</button>
      </details>
    );
  }

  return (
    <section className={`automation-diagnostics ${issueCount ? 'has-issues' : ''}`}>
      <div className="automation-diagnostics-head">
        <div><strong>자동 생성 진단 결과</strong><span>{summary}</span></div>
        <button className="btn btn-sm" type="button" onClick={copyDiagnostics}><Copy size={13} /> 진단내용 복사</button>
      </div>
      {list}
    </section>
  );
}

function AutomationAgentModal({ state, status, onClose, onRecheck }: { state: AgentState; status: AutomationAgentStatus | null; onClose: () => void; onRecheck: () => void }) {
  const isOutdated = state === 'outdated';
  const isConnected = state === 'connected';
  const isUnverified = state === 'unverified';
  const isPermissionDenied = status?.connectionIssue === 'permission_denied';
  const isBrowserBlocked = status?.connectionIssue === 'browser_blocked';
  const title = isConnected
    ? '자동화 실행기 버전 확인'
    : isOutdated
      ? '자동화 실행기 업데이트가 필요합니다'
      : isUnverified
        ? '최신 버전을 확인하지 못했습니다'
        : '자동화 실행기 설치가 필요합니다';
  const statusText = state === 'connected'
    ? '자동화 실행기가 최신 버전으로 연결되었습니다.'
    : state === 'checking'
      ? '자동화 실행기 연결을 확인하고 있습니다.'
      : isOutdated
        ? `현재 버전 ${status?.version || '확인 불가'} · 필요 버전 ${status?.requiredVersion || REQUIRED_AUTOMATION_AGENT_VERSION}`
        : isUnverified
          ? '이 PC의 실행기는 연결됐지만 서버 최신 버전을 확인하지 못했습니다.'
        : isPermissionDenied
          ? 'Chrome에서 이 사이트의 로컬 네트워크 접근이 차단되어 있습니다.'
          : isBrowserBlocked
            ? '실행기가 꺼져 있거나 Chrome의 로컬 네트워크 연결 허용이 필요합니다.'
            : '현재 PC에서 자동화 실행기를 찾지 못했습니다.';
  const description = isConnected
      ? '서버의 최신 배포 버전과 이 PC에 설치된 실행기 버전을 캐시 없이 직접 비교한 결과입니다.'
      : isOutdated
        ? '이 PC에 설치된 자동화 실행기가 구버전입니다. 최신 설치관리자를 다시 받아 실행하면 기존 실행기를 종료하고 새 버전으로 업데이트합니다.'
        : isUnverified
          ? '캐시된 기준값만으로 최신이라고 표시하지 않습니다. 네트워크 연결을 확인한 뒤 지금 다시 확인해 주세요.'
        : isPermissionDenied
          ? '주소창 왼쪽의 사이트 설정을 열어 “로컬 네트워크 액세스”를 허용한 뒤 페이지를 새로고침하고 다시 확인해 주세요. 실행기를 다시 설치할 필요는 없습니다.'
          : isBrowserBlocked
            ? '먼저 바탕화면의 “마이옥션 업무자동화 실행기”를 실행해 주세요. 계속 연결되지 않으면 주소창 왼쪽의 사이트 설정에서 로컬 네트워크 액세스를 허용한 뒤 다시 확인해 주세요.'
            : '브리핑자료와 권리분석 보증서 자동 생성을 사용하려면 이 PC에 자동화 실행기가 설치되어 있어야 합니다. 설치관리자 실행 후 다시 확인을 눌러 주세요.';
  const checkedAt = status?.checkedAt
    ? new Date(status.checkedAt).toLocaleString('ko-KR', { hour12: false })
    : '확인 전';

  return (
    <div className="automation-agent-modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="automation-agent-title">
      <div className="automation-agent-modal">
        <div className="automation-agent-modal-head">
          <div>
            <span className="automation-agent-kicker">업무 자동화 실행기</span>
            <h3 id="automation-agent-title">{title}</h3>
          </div>
          <button className="modal-close" onClick={onClose} type="button" aria-label="닫기"><X size={18} /></button>
        </div>
        <div className="automation-agent-modal-body">
          <div className={`automation-agent-status ${state}`}>
            {state === 'connected' ? <CheckCircle2 size={18} /> : <AlertCircle size={18} />}
            <span>{statusText}</span>
          </div>
          <p>{description}</p>
          <div className="automation-agent-version-grid">
            <div>
              <span>이 PC 설치 버전</span>
              <strong>{status?.version || (isPermissionDenied ? '브라우저에서 확인 차단' : isBrowserBlocked ? '실행기 연결 전' : state === 'missing' ? '설치되지 않음' : '확인 중')}</strong>
            </div>
            <div>
              <span>최신 배포 버전</span>
              <strong>{status?.latestVersionVerified ? status.requiredVersion : '서버 확인 필요'}</strong>
            </div>
            <div className="automation-agent-version-checked">
              <span>마지막 확인 시각</span>
              <strong>{checkedAt}</strong>
            </div>
          </div>
          {(isOutdated || (state === 'missing' && !isPermissionDenied && !isBrowserBlocked)) && (
            <div className="automation-agent-steps">
              <span>1. 최신 설치관리자 다운로드</span>
              <span>2. MyAuctionAutomationAgentSetup.exe 실행</span>
              <span>3. 지금 다시 확인</span>
            </div>
          )}
        </div>
        <div className="automation-agent-modal-actions">
          {(isOutdated || (state === 'missing' && !isPermissionDenied && !isBrowserBlocked)) && (
            <button
              className="btn btn-primary"
              onClick={() => automationApi.downloadAgentInstaller().catch((err) => alert(err.message))}
              type="button"
            >
              <Download size={14} /> 설치관리자 다운로드
            </button>
          )}
          <button className="btn" onClick={onRecheck} type="button">
            <RefreshCw size={14} /> 지금 다시 확인
          </button>
          <button className="btn btn-secondary" onClick={onClose} type="button">닫기</button>
        </div>
      </div>
    </div>
  );
}

function DownloadButton({ taskId, format, label }: { taskId: string; format: DownloadFormat; label: string }) {
  const detail = format === 'pptx' ? '편집 가능한 원본 문서' : format === 'pdf' ? '공유·인쇄용 완성 문서' : '일괄 생성 파일 묶음';
  return (
    <button className={`document-download-button ${format}`} onClick={() => automationApi.downloadFile(taskId, format).catch((err) => alert(err.message))}>
      <span className="document-download-icon">{format === 'zip' ? <Archive size={21} /> : format === 'pptx' ? <FileText size={21} /> : <Download size={21} />}</span>
      <span className="document-download-copy"><strong>{label}</strong><small>{detail}</small></span>
      <Download size={17} className="document-download-arrow" />
    </button>
  );
}
