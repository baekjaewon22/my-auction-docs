import { useState, useEffect } from 'react';
import { api } from '../api';
import {
  ACTIVITY_TYPES, MEETING_SUBTYPES, OFFICE_SUBTYPES,
  COURT_OPTIONS, generateTimeOptions, generateYears,
  type ActivityType, type CourtOption,
} from './types';
import Select, { toOptions } from '../components/Select';
import { Plus, X, Trash2 } from 'lucide-react';

const TIME_OPTS = toOptions(generateTimeOptions());
const YEAR_OPTS = generateYears().map((y) => ({ value: String(y), label: String(y) }));
const MEETING_OPTS = toOptions(MEETING_SUBTYPES as unknown as string[]);
const OFFICE_OPTS = toOptions(OFFICE_SUBTYPES as unknown as string[]);

const formatCourtLabel = (opt: CourtOption) => (
  <span style={{ fontWeight: opt.isMain ? 700 : 400 }}>{opt.label}</span>
);

interface TaskItem {
  activityType: ActivityType;
  timeFrom: string;
  timeTo: string;
  fieldCheckIn: boolean;
  fieldCheckOut: boolean;
  data: Record<string, unknown>;
  subtype: string;
  label: string; // 리스트 표시용
}

interface Props {
  targetDate: string;
  onCreated: () => void;
  onClose: () => void;
  assignableMembers?: { id: string; name: string; role: string; branch: string; department: string; position_title?: string }[];
  defaultAssigneeId?: string;
  canChooseAssignee?: boolean;
}

export default function JournalForm({ targetDate, onCreated, onClose, assignableMembers = [], defaultAssigneeId, canChooseAssignee = false }: Props) {
  const [tasks, setTasks] = useState<TaskItem[]>([]);
  const [saving, setSaving] = useState(false);
  const [assigneeId, setAssigneeId] = useState(defaultAssigneeId || assignableMembers[0]?.id || '');

  useEffect(() => {
    setAssigneeId(defaultAssigneeId || assignableMembers[0]?.id || '');
  }, [defaultAssigneeId, assignableMembers]);

  const assigneeOptions = assignableMembers.map((m) => ({
    value: m.id,
    label: `${m.name}${m.position_title ? ` · ${m.position_title}` : ''}${m.department ? ` · ${m.department}` : ''}`,
  }));

  // 공통
  const [activityType, setActivityType] = useState<ActivityType>('입찰');
  const [fieldCheckIn, setFieldCheckIn] = useState(false);
  const [fieldCheckOut, setFieldCheckOut] = useState(false);
  const [timeFrom, setTimeFrom] = useState('');
  const [timeTo, setTimeTo] = useState('');
  const [companion, setCompanion] = useState(false);

  // 브리핑자료 (별도 섹션)
  const [, setBriefingSubmit] = useState(false);
  const [briefingYear, setBriefingYear] = useState('2026');
  const [briefingCaseNo, setBriefingCaseNo] = useState('');
  const [briefingItemNo, setBriefingItemNo] = useState('');
  const [briefingCourt, setBriefingCourt] = useState('');

  // 입찰
  const [bidYear, setBidYear] = useState('2026');
  const [bidCaseNo, setBidCaseNo] = useState('');
  const [bidBidder, setBidBidder] = useState('');
  const [bidCourt, setBidCourt] = useState('');
  const [bidSuggestedPrice, setBidSuggestedPrice] = useState('');
  const [bidPrice, setBidPrice] = useState('');
  const [bidWinPrice, setBidWinPrice] = useState('');
  const [bidWon, setBidWon] = useState(false);
  const [bidProxy, setBidProxy] = useState(false); // 대리입찰
  const [bidCancelled, setBidCancelled] = useState(false); // 취하/변경 — 작성입찰가/낙찰가 미작성 허용
  const [bidDeviationReason, setBidDeviationReason] = useState('');
  const [bidItemNo, setBidItemNo] = useState('');
  const [bidBidderName, setBidBidderName] = useState(''); // 입찰자명 (고객명과 다를 때)
  const [showDeviationWarning, setShowDeviationWarning] = useState(false);

  useEffect(() => {
    const suggested = Number(bidSuggestedPrice.replace(/[^0-9]/g, ''));
    const actual = Number(bidPrice.replace(/[^0-9]/g, ''));
    if (suggested > 0 && actual > 0) {
      setShowDeviationWarning((suggested - actual) / suggested >= 0.05);
    } else {
      setShowDeviationWarning(false);
    }
  }, [bidSuggestedPrice, bidPrice]);

  // [3-1] 현장출근 자동 활성화: 입찰/미팅/임장 09:00 시작 → 자동 체크 (대리입찰 제외)
  useEffect(() => {
    const isFieldType = ['입찰', '미팅', '임장'].includes(activityType);
    if (isFieldType && timeFrom === '09:00') {
      // 대리입찰이면 비활성화
      if (activityType === '입찰' && bidProxy) {
        setFieldCheckIn(false);
      } else {
        setFieldCheckIn(true);
      }
    }
  }, [timeFrom, activityType, bidProxy]);

  // 업무 유형 변경 시: 사무/개인/브리핑은 현장출퇴근 불필요 → 해제
  useEffect(() => {
    if (['사무', '개인', '브리핑자료제출'].includes(activityType)) {
      setFieldCheckIn(false);
      setFieldCheckOut(false);
    }
  }, [activityType]);

  // [3-2] 현장퇴근 자동 활성화: 입찰/미팅/임장 18:00 종결 → 자동 체크
  useEffect(() => {
    const isFieldType = ['입찰', '미팅', '임장'].includes(activityType);
    if (isFieldType && timeTo === '18:00') {
      if (activityType === '입찰' && bidProxy) {
        setFieldCheckOut(false);
      } else {
        setFieldCheckOut(true);
      }
    }
  }, [timeTo, activityType, bidProxy]);

  // 대리입찰 체크 시 현장출퇴근 해제
  useEffect(() => {
    if (bidProxy && activityType === '입찰') {
      setFieldCheckIn(false);
      setFieldCheckOut(false);
      setTimeFrom('');
      setTimeTo('');
    }
  }, [bidProxy]);

  // 동행은 담당자 보조 기록이므로 외근/통계 대상에서 제외한다.
  useEffect(() => {
    if (activityType !== '임장' && activityType !== '미팅') {
      setCompanion(false);
      return;
    }
    if (companion) {
      setFieldCheckIn(false);
      setFieldCheckOut(false);
      if (activityType === '임장') setInspClientType('고객명');
    }
  }, [activityType, companion]);

  // 임장
  const [inspYear, setInspYear] = useState('2026');
  const [inspCaseNo, setInspCaseNo] = useState('');
  const [inspCourt, setInspCourt] = useState('');
  const [inspItemNo, setInspItemNo] = useState('');
  const [inspPlace, setInspPlace] = useState('');
  const [inspClientType, setInspClientType] = useState<'고객명' | '기타'>('고객명');
  const [inspClient, setInspClient] = useState('');
  const [inspEtcReason, setInspEtcReason] = useState('');
  // 임장 중복 경고
  const [inspDupWarning, setInspDupWarning] = useState<{ user_name: string; target_date: string }[] | null>(null);

  // 임장 사건번호+법원 중복 체크 (debounce). 동행은 담당자 보조 기록이라 중복 사건으로 보지 않는다.
  useEffect(() => {
    if (activityType !== '임장' || companion || !inspCaseNo.trim() || inspCaseNo.length < 3 || !inspCourt) {
      setInspDupWarning(null);
      return;
    }
    const fullCase = `${inspYear}타경${inspCaseNo}`;
    const timer = setTimeout(() => {
      api.journal.checkCaseNo(fullCase, inspCourt)
        .then(res => {
          setInspDupWarning(res.exists ? res.entries : null);
        })
        .catch(() => setInspDupWarning(null));
    }, 500);
    return () => clearTimeout(timer);
  }, [inspYear, inspCaseNo, inspCourt, activityType, companion]);

  // 브리핑 고객명
  const [briefingClient, setBriefingClient] = useState('');

  // 미팅
  const [meetingType, setMeetingType] = useState('브리핑');
  const [meetingEtc, setMeetingEtc] = useState('');
  const [meetingPlace, setMeetingPlace] = useState('');
  const [meetingClient, setMeetingClient] = useState('');
  const [meetingCaseYear, setMeetingCaseYear] = useState('2026');
  const [meetingCaseNo, setMeetingCaseNo] = useState('');
  const [meetingItemNo, setMeetingItemNo] = useState('');
  const [meetingInternal, setMeetingInternal] = useState(false); // 회사 미팅 — 외근 X, 외근보고서 매칭 제외

  // 사무
  const [officeType, setOfficeType] = useState('고객관리');
  const [officeEtc, setOfficeEtc] = useState('');

  // 개인
  const [personalReason, setPersonalReason] = useState('');

  const fmtCurrency = (val: string) => {
    const num = val.replace(/[^0-9]/g, '');
    return num ? Number(num).toLocaleString() : '';
  };

  // 현재 폼 내용으로 TaskItem 생성
  const buildTask = (): TaskItem | null => {
    if (activityType === '입찰' && !bidCaseNo.trim()) { alert('사건번호를 입력해주세요.'); return null; }
    if (activityType === '입찰' && !bidCourt) { alert('법원을 선택해주세요.'); return null; }
    if (activityType === '입찰' && !bidBidder.trim()) { alert('계약자명을 입력해주세요.'); return null; }
    if (activityType === '임장' && !inspCaseNo.trim()) { alert('사건번호를 입력해주세요.'); return null; }
    if (activityType === '임장' && !inspCourt) { alert('법원을 선택해주세요.'); return null; }
    if (activityType === '임장' && inspClientType === '고객명' && !inspClient.trim()) { alert(`${companion ? '담당자' : '계약자명'}을 입력해주세요.`); return null; }
    if (activityType === '임장' && inspClientType === '기타' && !inspEtcReason.trim()) { alert('사유를 입력해주세요.'); return null; }
    if (activityType === '미팅' && !meetingClient.trim()) { alert(`${companion ? '담당자' : '계약자명'}을 입력해주세요.`); return null; }
    if (activityType === '미팅' && !meetingInternal && !meetingPlace.trim()) { alert('장소를 입력해주세요.'); return null; }
    if (activityType === '미팅' && meetingType === '브리핑' && !meetingCaseNo.trim()) { alert('사건번호를 입력해주세요.'); return null; }
    if (activityType === '브리핑자료제출' && !briefingCaseNo.trim()) { alert('사건번호를 입력해주세요.'); return null; }
    if (activityType === '브리핑자료제출' && !briefingCourt) { alert('법원을 선택해주세요.'); return null; }
    if (activityType === '브리핑자료제출' && !briefingClient.trim()) { alert('계약자명을 입력해주세요.'); return null; }
    if (activityType === '입찰' && !bidCancelled && showDeviationWarning && !bidDeviationReason.trim()) {
      alert('제시입찰가 대비 실제입찰가가 5% 이상 낮습니다. 사유를 입력해주세요.');
      return null;
    }

    let data: Record<string, unknown> = {
      timeFrom: activityType === '입찰' && bidProxy ? '' : timeFrom,
      timeTo: activityType === '입찰' && bidProxy ? '' : timeTo,
      fieldCheckIn,
      fieldCheckOut,
    };
    let subtype = '';
    let label = '';

    switch (activityType) {
      case '입찰': {
        const actualBidder = bidBidderName.trim() || bidBidder;
        data = { ...data, caseNo: `${bidYear}타경${bidCaseNo}`, itemNo: bidItemNo, bidder: actualBidder, client: bidBidder, court: bidCourt,
          suggestedPrice: bidSuggestedPrice, bidPrice, winPrice: bidWon ? bidPrice : bidWinPrice,
          bidWon, bidProxy, bidCancelled, deviationReason: bidDeviationReason };
        subtype = `${bidYear}타경${bidCaseNo}`;
        label = `입찰 — ${subtype}${bidItemNo ? ` | ${bidItemNo}` : ''} | ${bidBidder}${actualBidder !== bidBidder ? `(입찰자:${actualBidder})` : ''}${bidProxy ? ' (대리)' : ''}${bidCancelled ? ' (취하/변경)' : ''}`;
        break;
      }
      case '임장':
        data = { ...data, caseNo: `${inspYear}타경${inspCaseNo}`, itemNo: inspItemNo, court: inspCourt, place: inspPlace,
          client: inspClientType === '고객명' ? inspClient : '', companion, companionPerson: companion ? inspClient : '',
          inspClientType, inspEtcReason: inspClientType === '기타' ? inspEtcReason : '' };
        subtype = `${inspYear}타경${inspCaseNo}`;
        label = `임장${companion ? ' [동행]' : ''} — ${subtype}${inspItemNo ? ` | ${inspItemNo}` : ''} | ${inspClientType === '고객명' ? inspClient : inspEtcReason}`;
        break;
      case '미팅':
        data = { ...data, meetingType, etcReason: meetingEtc, place: meetingPlace, client: meetingClient,
          companion, companionPerson: companion ? meetingClient : '',
          internalMeeting: meetingInternal, // 회사 미팅 플래그 — 외근 X, 외근보고서 매칭 제외
          ...(meetingType === '브리핑' ? { caseNo: `${meetingCaseYear}타경${meetingCaseNo}`, itemNo: meetingItemNo } : {}) };
        subtype = meetingType === '기타' ? meetingEtc : meetingType;
        label = `미팅(${subtype})${meetingInternal ? ' [회사]' : ''}${companion ? ' [동행]' : ''} — ${meetingClient}${meetingType === '브리핑' ? ` | ${meetingCaseYear}타경${meetingCaseNo}${meetingItemNo ? ` | ${meetingItemNo}` : ''}` : ''}`;
        break;
      case '사무':
        data = { ...data, officeType, etcReason: officeEtc };
        subtype = officeType === '기타' ? officeEtc : officeType;
        label = `사무 — ${subtype}`;
        break;
      case '브리핑자료제출': {
        const caseNo = `${briefingYear}타경${briefingCaseNo}`;
        data = { briefingSubmit: true, briefingCaseNo: caseNo, itemNo: briefingItemNo, briefingCourt, client: briefingClient };
        subtype = '브리핑자료 제출';
        label = `브리핑 — ${caseNo}${briefingItemNo ? ` | ${briefingItemNo}` : ''} | ${briefingClient}`;
        break;
      }
      case '개인':
        data = { ...data, reason: personalReason };
        subtype = personalReason;
        label = `개인 — ${personalReason}`;
        break;
    }

    return { activityType, timeFrom, timeTo, fieldCheckIn, fieldCheckOut, data, subtype, label };
  };

  // 리스트에 추가
  const handleAddTask = () => {
    const task = buildTask();
    if (!task) return;
    setTasks([...tasks, task]);
    resetFields();
  };



  // 필드 초기화 (공통 필드 포함)
  const resetFields = () => {
    setFieldCheckIn(false); setFieldCheckOut(false);
    setTimeFrom(''); setTimeTo('');
    setBidCaseNo(''); setBidItemNo(''); setBidBidder(''); setBidBidderName(''); setBidSuggestedPrice(''); setBidPrice('');
    setBidWinPrice(''); setBidWon(false); setBidProxy(false); setBidCancelled(false); setBidDeviationReason('');
    setInspCaseNo(''); setInspItemNo(''); setInspPlace(''); setInspClient('');
    setMeetingEtc(''); setMeetingPlace(''); setMeetingClient(''); setMeetingCaseNo(''); setMeetingItemNo(''); setMeetingInternal(false);
    setCompanion(false);
    setOfficeEtc('');
    setPersonalReason('');
    setBriefingSubmit(false); setBriefingCaseNo(''); setBriefingItemNo(''); setBriefingCourt(''); setBriefingClient('');
  };

  const removeTask = (idx: number) => {
    setTasks(tasks.filter((_, i) => i !== idx));
  };

  const isProxyBid = activityType === '입찰' && bidProxy;
  const supportsCompanion = activityType === '임장' || activityType === '미팅';

  // 전체 등록
  const handleSubmitAll = async () => {
    // 리스트가 비어있으면 현재 폼도 추가 시도
    let finalTasks = [...tasks];
    if (finalTasks.length === 0) {
      const task = buildTask();
      if (!task) return;
      finalTasks = [task];
    }

    setSaving(true);
    try {
      if (canChooseAssignee && !assigneeId) {
        alert('담당자를 선택해주세요.');
        return;
      }
      for (const task of finalTasks) {
        await api.journal.create({
          target_date: targetDate,
          activity_type: task.activityType,
          activity_subtype: task.subtype,
          data: task.data,
          ...(canChooseAssignee && assigneeId ? { user_id: assigneeId } : {}),
        });
      }
      onCreated();
    } catch (err: any) { alert(err.message); }
    finally { setSaving(false); }
  };

  return (
    <div className="modal-overlay">
      <div className="journal-form-modal" onClick={(e) => e.stopPropagation()}>
        <div className="journal-form-header">
          <h3>일정 등록 — {targetDate}</h3>
          <button className="btn-close" onClick={onClose}><X size={18} /></button>
        </div>

        {/* 추가된 업무 리스트 */}
        {tasks.length > 0 && (
          <div className="task-queue">
            <div className="task-queue-label">등록 대기 ({tasks.length}건)</div>
            {tasks.map((task, i) => (
              <div key={i} className="task-queue-item">
                <span className="task-queue-text">
                  {task.label}
                  {task.timeFrom && <span className="task-queue-time"> {task.timeFrom}~{task.timeTo}</span>}
                </span>
                <button type="button" className="task-queue-remove" onClick={() => removeTask(i)}>
                  <Trash2 size={13} />
                </button>
              </div>
            ))}
          </div>
        )}

        <form onSubmit={(e) => { e.preventDefault(); handleSubmitAll(); }} className="journal-form-body">
          {canChooseAssignee && (
            <div className="form-group">
              <label>담당자</label>
              <Select
                options={assigneeOptions}
                value={assigneeOptions.find((o) => o.value === assigneeId) || null}
                onChange={(o: any) => setAssigneeId(o?.value || '')}
                placeholder="담당자 선택"
                isSearchable
              />
            </div>
          )}

          {/* 업무 유형 */}
          <div className="form-group">
            <label>업무 유형</label>
            <div className="activity-type-tabs">
              {ACTIVITY_TYPES.map((t) => (
                <button key={t} type="button" className={`activity-tab ${activityType === t ? 'active' : ''}`} onClick={() => setActivityType(t)}>{t}</button>
              ))}
            </div>
          </div>

          {supportsCompanion && (
            <div className="form-group">
              <button
                type="button"
                className={`field-check-label ${companion ? 'checked' : ''}`}
                style={{ width: '100%', cursor: 'pointer', padding: '7px 10px', borderRadius: 6, border: '1px solid #dadce0', background: companion ? '#e8f0fe' : '#fff', color: companion ? '#1a73e8' : '#3c4043', fontWeight: companion ? 700 : 400 }}
                onClick={() => setCompanion((v) => !v)}
              >
                {companion ? '✓ 동행 (통계/중복 제외)' : '동행'}
              </button>
            </div>
          )}

          {/* 현장출근/퇴근 */}
          {activityType !== '개인' && activityType !== '브리핑자료제출' && !isProxyBid && !companion && (
            <div className="form-group">
              <div className="field-check-group">
                <label className={`field-check-label ${fieldCheckIn ? 'checked' : ''}`}>
                  <input type="checkbox" checked={fieldCheckIn} onChange={(e) => setFieldCheckIn(e.target.checked)} />현장출근
                </label>
                <label className={`field-check-label ${fieldCheckOut ? 'checked' : ''}`}>
                  <input type="checkbox" checked={fieldCheckOut} onChange={(e) => setFieldCheckOut(e.target.checked)} />현장퇴근
                </label>
              </div>
            </div>
          )}

          {/* 시간 (브리핑/개인은 불필요) */}
          {activityType !== '개인' && activityType !== '브리핑자료제출' && !isProxyBid && (
            <div className="form-group">
              <label>시간</label>
              <div className="inline-row">
                <Select size="sm" options={TIME_OPTS} value={TIME_OPTS.find((o) => o.value === timeFrom)} onChange={(o: any) => setTimeFrom(o.value)} placeholder="업무 시간" />
                <span className="inline-sep">~</span>
                <Select size="sm" options={TIME_OPTS} value={TIME_OPTS.find((o) => o.value === timeTo)} onChange={(o: any) => setTimeTo(o.value)} placeholder="업무 시간" />
              </div>
            </div>
          )}

          {/* === 입찰 === */}
          {activityType === '입찰' && (
            <>
              <div className="form-row form-row-inline">
                <div className="form-group" style={{ flex: 'none' }}>
                  <label>사건번호</label>
                  <div className="case-no-inline">
                    <Select size="sm" options={YEAR_OPTS} value={YEAR_OPTS.find((o) => o.value === bidYear)} onChange={(o: any) => setBidYear(o.value)} />
                    <span className="case-no-fixed">타경</span>
                    <input type="text" value={bidCaseNo} onChange={(e) => setBidCaseNo(e.target.value.replace(/[^0-9]/g, ''))} placeholder="1234" required className="case-no-input" maxLength={6} />
                  </div>
                </div>
                <div className="form-group" style={{ flex: 'none', width: 72 }}>
                  <label>물건번호</label>
                  <input type="text" value={bidItemNo} onChange={(e) => setBidItemNo(e.target.value.replace(/[^0-9]/g, ''))} placeholder="" className="case-no-input" maxLength={3} style={{ width: 52, textAlign: 'center' }} />
                </div>
              </div>
              <div className="form-row form-row-inline">
                <div className="form-group" style={{ flex: 1 }}>
                  <label>계약자명 *</label>
                  <input type="text" value={bidBidder} onChange={(e) => setBidBidder(e.target.value)} placeholder="계약자명" required />
                </div>
                <div className="form-group" style={{ flex: 1 }}>
                  <label>입찰자명 <span style={{ color: '#9aa0a6', fontWeight: 400, fontSize: '0.7rem' }}>계약자와 다를 때</span></label>
                  <input type="text" value={bidBidderName} onChange={(e) => setBidBidderName(e.target.value)} placeholder={bidBidder || '미입력 시 계약자명'} />
                </div>
              </div>
              <div className="form-group">
                <label>법원</label>
                <Select size="sm" options={COURT_OPTIONS} value={COURT_OPTIONS.find((o) => o.value === bidCourt) || null} onChange={(o: any) => setBidCourt(o?.value || '')} placeholder="법원 검색..." isSearchable formatOptionLabel={formatCourtLabel} />
              </div>
              <div className="form-row form-row-inline">
                <div className="form-group" style={{ flex: 1 }}>
                  <label>제시입찰가 <span style={{ color: '#9aa0a6', fontWeight: 400, fontSize: '0.7rem' }}>브리핑 제시금액</span></label>
                  <input type="text" value={bidSuggestedPrice} onChange={(e) => setBidSuggestedPrice(fmtCurrency(e.target.value))} placeholder="0" />
                </div>
                <div className="form-group" style={{ flex: 1 }}>
                  <label>작성입찰가</label>
                  <input type="text" value={bidPrice} onChange={(e) => setBidPrice(fmtCurrency(e.target.value))} placeholder="0" />
                </div>
              </div>
              {showDeviationWarning && (
                <div className="form-group">
                  <label style={{ color: '#d93025' }}>제시입찰가 대비 5% 이상 차이 — 사유 입력 필수</label>
                  <textarea value={bidDeviationReason} onChange={(e) => setBidDeviationReason(e.target.value)} placeholder="제시금액보다 낮게 입찰한 사유를 입력하세요" rows={2} required />
                </div>
              )}
              <div className="form-group">
                <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
                  <label className={`field-check-label ${bidWon ? 'checked' : ''}`} style={{ display: 'inline-flex' }}>
                    <input type="checkbox" checked={bidWon} onChange={(e) => { setBidWon(e.target.checked); if (e.target.checked) setBidWinPrice(''); }} />낙찰
                  </label>
                  <label className={`field-check-label ${bidProxy ? 'checked' : ''}`} style={{ display: 'inline-flex' }}>
                    <input type="checkbox" checked={bidProxy} onChange={(e) => setBidProxy(e.target.checked)} />대리입찰
                  </label>
                  <label className={`field-check-label ${bidCancelled ? 'checked' : ''}`} style={{ display: 'inline-flex', fontSize: '0.78rem', padding: '4px 8px' }}>
                    <input type="checkbox" checked={bidCancelled} onChange={(e) => setBidCancelled(e.target.checked)} />취하/변경
                  </label>
                  {bidWon && <span style={{ fontSize: '0.75rem', color: '#188038' }}>실제입찰가가 낙찰가로 자동 적용됩니다.</span>}
                  {bidProxy && <span style={{ fontSize: '0.75rem', color: '#7b1fa2' }}>외근보고서 제출 불필요</span>}
                  {bidCancelled && <span style={{ fontSize: '0.75rem', color: '#e65100' }}>작성입찰가/낙찰가 미입력 허용</span>}
                </div>
              </div>
              {!bidWon && !bidCancelled && (
                <div className="form-group">
                  <label>낙찰가 (원, 추후입력)</label>
                  <input type="text" value={bidWinPrice} onChange={(e) => setBidWinPrice(fmtCurrency(e.target.value))} placeholder="추후 작성" />
                </div>
              )}
            </>
          )}

          {/* === 임장 === */}
          {activityType === '임장' && (
            <>
              <div className="form-row form-row-inline">
                <div className="form-group" style={{ flex: 'none' }}>
                  <label>사건번호</label>
                  <div className="case-no-inline">
                    <Select size="sm" options={YEAR_OPTS} value={YEAR_OPTS.find((o) => o.value === inspYear)} onChange={(o: any) => setInspYear(o.value)} />
                    <span className="case-no-fixed">타경</span>
                    <input type="text" value={inspCaseNo} onChange={(e) => setInspCaseNo(e.target.value.replace(/[^0-9]/g, ''))} placeholder="1234" required className="case-no-input" maxLength={6} />
                  </div>
                </div>
                <div className="form-group" style={{ flex: 'none', width: 72 }}>
                  <label>물건번호</label>
                  <input type="text" value={inspItemNo} onChange={(e) => setInspItemNo(e.target.value.replace(/[^0-9]/g, ''))} placeholder="" className="case-no-input" maxLength={3} style={{ width: 52, textAlign: 'center' }} />
                </div>
              </div>
              {inspDupWarning && inspDupWarning.length > 0 && (
                <div style={{ background: '#fff3e0', border: '1px solid #ffcc02', borderRadius: 8, padding: '8px 12px', marginBottom: 8, fontSize: '0.78rem', color: '#e65100', display: 'flex', alignItems: 'flex-start', gap: 6 }}>
                  <span style={{ fontSize: '1rem', lineHeight: 1 }}>⚠️</span>
                  <div>
                    <div style={{ fontWeight: 600, marginBottom: 2 }}>동일 사건번호 임장 이력이 있습니다</div>
                    {inspDupWarning.map((d, i) => (
                      <div key={i}>{d.user_name} — {d.target_date}</div>
                    ))}
                    <div style={{ color: '#9e9e9e', marginTop: 2, fontSize: '0.72rem' }}>등록은 정상적으로 진행됩니다.</div>
                  </div>
                </div>
              )}
              <div className="form-row form-row-inline">
                <div className="form-group" style={{ flex: 'none', minWidth: 70 }}>
                  <label>구분</label>
                  <select value={inspClientType} onChange={(e) => setInspClientType(e.target.value as any)} disabled={companion} style={{ padding: '5px 6px', borderRadius: 6, border: '1px solid #dadce0', fontSize: '0.78rem' }}>
                    <option value="고객명">계약자명</option>
                    <option value="기타">기타</option>
                  </select>
                </div>
                <div className="form-group" style={{ flex: 1 }}>
                  {inspClientType === '고객명' ? (
                    <><label>{companion ? '담당자 *' : '계약자명 *'}</label><input type="text" value={inspClient} onChange={(e) => setInspClient(e.target.value)} placeholder={companion ? '도와주는 담당자명' : '계약자명'} /></>
                  ) : (
                    <><label>사유 *</label><input type="text" value={inspEtcReason} onChange={(e) => setInspEtcReason(e.target.value)} placeholder="ex) 사전답사" /></>
                  )}
                </div>
              </div>
              <div className="form-group">
                <label>법원</label>
                <Select size="sm" options={COURT_OPTIONS} value={COURT_OPTIONS.find((o) => o.value === inspCourt) || null} onChange={(o: any) => setInspCourt(o?.value || '')} placeholder="법원 검색..." isSearchable formatOptionLabel={formatCourtLabel} />
              </div>
              <div className="form-group">
                <label>장소</label>
                <input type="text" value={inspPlace} onChange={(e) => setInspPlace(e.target.value)} required />
              </div>
            </>
          )}

          {/* === 미팅 === */}
          {activityType === '미팅' && (
            <>
              <div className="form-group">
                <label>미팅 유형</label>
                <Select options={MEETING_OPTS} value={MEETING_OPTS.find((o) => o.value === meetingType)} onChange={(o: any) => setMeetingType(o.value)} />
              </div>
              {meetingType === '기타' && (
                <div className="form-group"><label>사유</label><input type="text" value={meetingEtc} onChange={(e) => setMeetingEtc(e.target.value)} required /></div>
              )}
              {meetingType === '브리핑' ? (
                <>
                <div className="form-row form-row-inline">
                  <div className="form-group" style={{ flex: 'none' }}>
                    <label>사건번호</label>
                    <div className="case-no-inline">
                      <Select size="sm" options={YEAR_OPTS} value={YEAR_OPTS.find((o) => o.value === meetingCaseYear)} onChange={(o: any) => setMeetingCaseYear(o.value)} />
                      <span className="case-no-fixed">타경</span>
                      <input type="text" value={meetingCaseNo} onChange={(e) => setMeetingCaseNo(e.target.value.replace(/[^0-9]/g, ''))} placeholder="1234" className="case-no-input" maxLength={6} />
                    </div>
                  </div>
                  <div className="form-group" style={{ flex: 'none', width: 72 }}>
                    <label>물건번호</label>
                    <input type="text" value={meetingItemNo} onChange={(e) => setMeetingItemNo(e.target.value.replace(/[^0-9]/g, ''))} placeholder="" className="case-no-input" maxLength={3} style={{ width: 52, textAlign: 'center' }} />
                  </div>
                </div>
                <div className="form-group"><label>{companion ? '담당자 *' : '계약자명 *'}</label><input type="text" value={meetingClient} onChange={(e) => setMeetingClient(e.target.value)} placeholder={companion ? '도와주는 담당자명' : '계약자명'} required /></div>
                </>
              ) : (
                <div className="form-group"><label>{companion ? '담당자 *' : '계약자명 *'}</label><input type="text" value={meetingClient} onChange={(e) => setMeetingClient(e.target.value)} placeholder={companion ? '도와주는 담당자명' : '계약자명'} required /></div>
              )}
              <div className="form-row form-row-inline">
                <div className="form-group" style={{ flex: 1 }}>
                  <label>장소</label>
                  <input type="text" value={meetingPlace} onChange={(e) => setMeetingPlace(e.target.value)}
                    placeholder={meetingInternal ? '회사' : '장소'}
                    disabled={meetingInternal}
                    required={!meetingInternal} />
                </div>
                <div className="form-group" style={{ flex: 1 }}>
                  <label>&nbsp;</label>
                  <button type="button"
                    className={`field-check-label ${meetingInternal ? 'checked' : ''}`}
                    style={{ width: '100%', cursor: 'pointer', padding: '6px 10px', borderRadius: 6, border: '1px solid #dadce0', background: meetingInternal ? '#e8f5e9' : '#fff', color: meetingInternal ? '#188038' : '#3c4043', fontWeight: meetingInternal ? 600 : 400 }}
                    onClick={() => {
                      const next = !meetingInternal;
                      setMeetingInternal(next);
                      if (next) {
                        setMeetingPlace('회사');
                        setFieldCheckIn(false);
                        setFieldCheckOut(false);
                      } else {
                        setMeetingPlace('');
                      }
                    }}>
                    {meetingInternal ? '✓ 회사 미팅 (외근 X)' : '회사 미팅'}
                  </button>
                </div>
              </div>
            </>
          )}

          {/* === 사무 === */}
          {activityType === '사무' && (
            <>
              <div className="form-group">
                <label>업무 유형</label>
                <Select options={OFFICE_OPTS} value={OFFICE_OPTS.find((o) => o.value === officeType)} onChange={(o: any) => setOfficeType(o.value)} />
              </div>
              {officeType === '기타' && (
                <div className="form-group"><label>내용</label><input type="text" value={officeEtc} onChange={(e) => setOfficeEtc(e.target.value)} required /></div>
              )}
            </>
          )}

          {/* === 브리핑 (독립 탭) === */}
          {activityType === '브리핑자료제출' && (
            <>
              <div className="form-row form-row-inline">
                <div className="form-group" style={{ flex: 'none' }}>
                  <label>사건번호</label>
                  <div className="case-no-inline">
                    <Select size="sm" options={YEAR_OPTS} value={YEAR_OPTS.find((o) => o.value === briefingYear)} onChange={(o: any) => setBriefingYear(o.value)} />
                    <span className="case-no-fixed">타경</span>
                    <input type="text" value={briefingCaseNo} onChange={(e) => setBriefingCaseNo(e.target.value.replace(/[^0-9]/g, ''))} placeholder="1234" className="case-no-input" maxLength={6} />
                  </div>
                </div>
                <div className="form-group" style={{ flex: 'none', width: 72 }}>
                  <label>물건번호</label>
                  <input type="text" value={briefingItemNo} onChange={(e) => setBriefingItemNo(e.target.value.replace(/[^0-9]/g, ''))} placeholder="" className="case-no-input" maxLength={3} style={{ width: 52, textAlign: 'center' }} />
                </div>
              </div>
              <div className="form-group">
                <label>계약자명</label>
                <input type="text" value={briefingClient} onChange={(e) => setBriefingClient(e.target.value)} placeholder="계약자명" />
              </div>
              <div className="form-group">
                <label>법원</label>
                <Select size="sm" options={COURT_OPTIONS} value={COURT_OPTIONS.find((o) => o.value === briefingCourt) || null} onChange={(o: any) => setBriefingCourt(o?.value || '')} placeholder="법원 검색..." isSearchable formatOptionLabel={formatCourtLabel} />
              </div>
            </>
          )}

          {/* === 개인 === */}
          {activityType === '개인' && (
            <div className="form-group"><label>사유 (예: 연차, 월차 등)</label><input type="text" value={personalReason} onChange={(e) => setPersonalReason(e.target.value)} required /></div>
          )}

          {/* 하단 버튼 */}
          <div className="journal-form-actions">
            <button type="button" className="btn btn-outline btn-full" onClick={handleAddTask}>
              <Plus size={16} /> 추가하기
            </button>
            <button type="submit" className="btn btn-primary btn-full" disabled={saving}>
              {saving ? '등록중...' : `일정 등록${tasks.length > 0 ? ` (${tasks.length}건)` : ''}`}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
