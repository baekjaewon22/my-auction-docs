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
}

export default function JournalForm({ targetDate, onCreated, onClose }: Props) {
  const [tasks, setTasks] = useState<TaskItem[]>([]);
  const [saving, setSaving] = useState(false);

  // 공통
  const [activityType, setActivityType] = useState<ActivityType>('입찰');
  const [fieldCheckIn, setFieldCheckIn] = useState(false);
  const [fieldCheckOut, setFieldCheckOut] = useState(false);
  const [timeFrom, setTimeFrom] = useState('');
  const [timeTo, setTimeTo] = useState('');

  // 브리핑자료 (별도 섹션)
  const [briefingSubmit, setBriefingSubmit] = useState(false);
  const [briefingYear, setBriefingYear] = useState('2026');
  const [briefingCaseNo, setBriefingCaseNo] = useState('');
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
  const [bidDeviationReason, setBidDeviationReason] = useState('');
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

  // 임장
  const [inspYear, setInspYear] = useState('2026');
  const [inspCaseNo, setInspCaseNo] = useState('');
  const [inspCourt, setInspCourt] = useState('');
  const [inspPlace, setInspPlace] = useState('');

  // 미팅
  const [meetingType, setMeetingType] = useState('고객상담');
  const [meetingEtc, setMeetingEtc] = useState('');
  const [meetingPlace, setMeetingPlace] = useState('');

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
    if (activityType === '입찰' && !bidCourt) { alert('법원을 선택해주세요.'); return null; }
    if (activityType === '임장' && !inspCourt) { alert('법원을 선택해주세요.'); return null; }
    if (activityType === '미팅' && !meetingPlace.trim()) { alert('장소를 입력해주세요.'); return null; }
    if (activityType === '입찰' && showDeviationWarning && !bidDeviationReason.trim()) {
      alert('제시입찰가 대비 실제입찰가가 5% 이상 낮습니다. 사유를 입력해주세요.');
      return null;
    }

    let data: Record<string, unknown> = { timeFrom, timeTo, fieldCheckIn, fieldCheckOut,
      briefingSubmit, ...(briefingSubmit ? { briefingCaseNo: `${briefingYear}타경${briefingCaseNo}`, briefingCourt } : {}) };
    let subtype = '';
    let label = '';

    switch (activityType) {
      case '입찰':
        data = { ...data, caseNo: `${bidYear}타경${bidCaseNo}`, bidder: bidBidder, court: bidCourt,
          suggestedPrice: bidSuggestedPrice, bidPrice, winPrice: bidWon ? bidPrice : bidWinPrice,
          bidWon, deviationReason: bidDeviationReason };
        subtype = `${bidYear}타경${bidCaseNo}`;
        label = `입찰 — ${subtype}`;
        break;
      case '임장':
        data = { ...data, caseNo: `${inspYear}타경${inspCaseNo}`, court: inspCourt, place: inspPlace };
        subtype = `${inspYear}타경${inspCaseNo}`;
        label = `임장 — ${subtype}`;
        break;
      case '미팅':
        data = { ...data, meetingType, etcReason: meetingEtc, place: meetingPlace };
        subtype = meetingType === '기타' ? meetingEtc : meetingType;
        label = `미팅 — ${subtype}`;
        break;
      case '사무':
        data = { ...data, officeType, etcReason: officeEtc };
        subtype = officeType === '기타' ? officeEtc : officeType;
        label = `사무 — ${subtype}`;
        break;
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

  // 브리핑자료만 단독 추가
  const handleAddBriefing = () => {
    if (!briefingCaseNo.trim()) { alert('사건번호를 입력해주세요.'); return; }
    if (!briefingCourt) { alert('법원을 선택해주세요.'); return; }
    const caseNo = `${briefingYear}타경${briefingCaseNo}`;
    const task: TaskItem = {
      activityType: '사무',
      timeFrom: '', timeTo: '',
      fieldCheckIn: false, fieldCheckOut: false,
      data: { briefingSubmit: true, briefingCaseNo: caseNo, briefingCourt },
      subtype: '브리핑자료 제출',
      label: `브리핑자료 — ${caseNo}`,
    };
    setTasks([...tasks, task]);
    setBriefingSubmit(false); setBriefingCaseNo(''); setBriefingCourt('');
  };

  // 필드 초기화 (공통 필드는 유지)
  const resetFields = () => {
    setBidCaseNo(''); setBidBidder(''); setBidSuggestedPrice(''); setBidPrice('');
    setBidWinPrice(''); setBidWon(false); setBidDeviationReason('');
    setInspCaseNo(''); setInspPlace('');
    setMeetingEtc(''); setMeetingPlace('');
    setOfficeEtc('');
    setPersonalReason('');
    setBriefingSubmit(false); setBriefingCaseNo(''); setBriefingCourt('');
  };

  const removeTask = (idx: number) => {
    setTasks(tasks.filter((_, i) => i !== idx));
  };

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
      for (const task of finalTasks) {
        await api.journal.create({
          target_date: targetDate,
          activity_type: task.activityType,
          activity_subtype: task.subtype,
          data: task.data,
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
          {/* 업무 유형 */}
          <div className="form-group">
            <label>업무 유형</label>
            <div className="activity-type-tabs">
              {ACTIVITY_TYPES.map((t) => (
                <button key={t} type="button" className={`activity-tab ${activityType === t ? 'active' : ''}`} onClick={() => setActivityType(t)}>{t}</button>
              ))}
            </div>
          </div>

          {/* 현장출근/퇴근 + 브리핑자료 — 별도 행 */}
          {activityType !== '개인' && (
            <div className="form-group">
              <div className="field-check-group">
                <label className={`field-check-label ${fieldCheckIn ? 'checked' : ''}`}>
                  <input type="checkbox" checked={fieldCheckIn} onChange={(e) => setFieldCheckIn(e.target.checked)} />현장출근
                </label>
                <label className={`field-check-label ${fieldCheckOut ? 'checked' : ''}`}>
                  <input type="checkbox" checked={fieldCheckOut} onChange={(e) => setFieldCheckOut(e.target.checked)} />현장퇴근
                </label>
                <span style={{ width: 1, height: 20, background: 'var(--gray-200)', margin: '0 4px' }} />
                <label className={`field-check-label briefing ${briefingSubmit ? 'checked' : ''}`}>
                  <input type="checkbox" checked={briefingSubmit} onChange={(e) => setBriefingSubmit(e.target.checked)} />브리핑자료 제출
                </label>
              </div>
            </div>
          )}

          {/* 브리핑자료 상세 */}
          {briefingSubmit && (
            <div className="briefing-fields">
              <label className="form-label-sm">브리핑자료 사건정보</label>
              <div className="form-group">
                <div className="case-no-inline">
                  <Select size="sm" options={YEAR_OPTS} value={YEAR_OPTS.find((o) => o.value === briefingYear)} onChange={(o: any) => setBriefingYear(o.value)} />
                  <span className="case-no-fixed">타경</span>
                  <input type="text" value={briefingCaseNo} onChange={(e) => setBriefingCaseNo(e.target.value.replace(/[^0-9]/g, ''))} placeholder="1234" className="case-no-input" maxLength={6} />
                </div>
              </div>
              <div className="form-group">
                <Select size="sm" options={COURT_OPTIONS} value={COURT_OPTIONS.find((o) => o.value === briefingCourt) || null} onChange={(o: any) => setBriefingCourt(o?.value || '')} placeholder="법원 검색..." isSearchable formatOptionLabel={formatCourtLabel} />
              </div>
              <button type="button" className="btn btn-sm btn-outline" onClick={handleAddBriefing} style={{ width: '100%' }}>
                <Plus size={14} /> 브리핑자료 추가
              </button>
            </div>
          )}

          {/* 시간 */}
          {activityType !== '개인' && (
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
                <div className="form-group" style={{ flex: 1 }}>
                  <label>입찰자</label>
                  <input type="text" value={bidBidder} onChange={(e) => setBidBidder(e.target.value)} required />
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
                <label className={`field-check-label ${bidWon ? 'checked' : ''}`} style={{ display: 'inline-flex', marginBottom: 8 }}>
                  <input type="checkbox" checked={bidWon} onChange={(e) => { setBidWon(e.target.checked); if (e.target.checked) setBidWinPrice(''); }} />낙찰
                </label>
                {bidWon && <span style={{ fontSize: '0.75rem', color: '#188038', marginLeft: 8 }}>실제입찰가가 낙찰가로 자동 적용됩니다.</span>}
              </div>
              {!bidWon && (
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
                <div className="form-group" style={{ flex: 1 }}>
                  <label>장소</label>
                  <input type="text" value={inspPlace} onChange={(e) => setInspPlace(e.target.value)} required />
                </div>
              </div>
              <div className="form-group">
                <label>법원</label>
                <Select size="sm" options={COURT_OPTIONS} value={COURT_OPTIONS.find((o) => o.value === inspCourt) || null} onChange={(o: any) => setInspCourt(o?.value || '')} placeholder="법원 검색..." isSearchable formatOptionLabel={formatCourtLabel} />
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
              <div className="form-group"><label>장소</label><input type="text" value={meetingPlace} onChange={(e) => setMeetingPlace(e.target.value)} required /></div>
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
