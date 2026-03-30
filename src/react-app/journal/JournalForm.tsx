import { useState, useEffect } from 'react';
import { api } from '../api';
import {
  ACTIVITY_TYPES, MEETING_SUBTYPES, OFFICE_SUBTYPES,
  COURTS, generateTimeOptions, generateYears,
  type ActivityType,
} from './types';
import { Plus, X } from 'lucide-react';

const TIME_OPTIONS = generateTimeOptions();
const YEARS = generateYears();

interface Props {
  targetDate: string;
  onCreated: () => void;
  onClose: () => void;
}

export default function JournalForm({ targetDate, onCreated, onClose }: Props) {
  const [activityType, setActivityType] = useState<ActivityType>('입찰');
  const [saving, setSaving] = useState(false);

  // 현장 출퇴근
  const [fieldCheckIn, setFieldCheckIn] = useState(false);
  const [fieldCheckOut, setFieldCheckOut] = useState(false);

  // Common time
  const [timeFrom, setTimeFrom] = useState('09:00');
  const [timeTo, setTimeTo] = useState('10:00');

  // 입찰 fields
  const [bidYear, setBidYear] = useState('2026');
  const [bidCaseNo, setBidCaseNo] = useState('');
  const [bidBidder, setBidBidder] = useState('');
  const [bidCourt, setBidCourt] = useState('');
  const [bidSuggestedPrice, setBidSuggestedPrice] = useState(''); // 제시 입찰가
  const [bidPrice, setBidPrice] = useState(''); // 실제 작성 입찰가
  const [bidWinPrice, setBidWinPrice] = useState('');
  const [bidDeviationReason, setBidDeviationReason] = useState(''); // 5% 이상 차이 사유

  // 5% deviation check
  const [showDeviationWarning, setShowDeviationWarning] = useState(false);

  useEffect(() => {
    const suggested = Number(bidSuggestedPrice.replace(/[^0-9]/g, ''));
    const actual = Number(bidPrice.replace(/[^0-9]/g, ''));
    if (suggested > 0 && actual > 0) {
      const deviation = (suggested - actual) / suggested;
      setShowDeviationWarning(deviation >= 0.05);
    } else {
      setShowDeviationWarning(false);
    }
  }, [bidSuggestedPrice, bidPrice]);

  // 임장 fields
  const [inspYear, setInspYear] = useState('2026');
  const [inspCaseNo, setInspCaseNo] = useState('');
  const [inspPlace, setInspPlace] = useState('');

  // 미팅 fields
  const [meetingType, setMeetingType] = useState('고객상담');
  const [meetingEtc, setMeetingEtc] = useState('');
  const [meetingPlace, setMeetingPlace] = useState('');

  // 사무 fields
  const [officeType, setOfficeType] = useState('고객관리');
  const [officeEtc, setOfficeEtc] = useState('');

  // 개인 fields
  const [personalReason, setPersonalReason] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    // 5% deviation validation
    if (activityType === '입찰' && showDeviationWarning && !bidDeviationReason.trim()) {
      alert('제시입찰가 대비 실제입찰가가 5% 이상 낮습니다. 사유를 입력해주세요.');
      return;
    }

    setSaving(true);

    let data: Record<string, unknown> = { timeFrom, timeTo, fieldCheckIn, fieldCheckOut };
    let subtype = '';

    switch (activityType) {
      case '입찰':
        data = { ...data, caseNo: `${bidYear}타경${bidCaseNo}`, bidder: bidBidder, court: bidCourt,
          suggestedPrice: bidSuggestedPrice, bidPrice, winPrice: bidWinPrice, deviationReason: bidDeviationReason };
        subtype = `${bidYear}타경${bidCaseNo}`;
        break;
      case '임장':
        data = { ...data, caseNo: `${inspYear}타경${inspCaseNo}`, place: inspPlace };
        subtype = `${inspYear}타경${inspCaseNo}`;
        break;
      case '미팅':
        data = { ...data, meetingType, etcReason: meetingEtc, place: meetingPlace };
        subtype = meetingType === '기타' ? meetingEtc : meetingType;
        break;
      case '사무':
        data = { ...data, officeType, etcReason: officeEtc };
        subtype = officeType === '기타' ? officeEtc : officeType;
        break;
      case '개인':
        data = { ...data, reason: personalReason };
        subtype = personalReason;
        break;
    }

    try {
      await api.journal.create({ target_date: targetDate, activity_type: activityType, activity_subtype: subtype, data });
      onCreated();
    } catch (err: any) {
      alert(err.message);
    } finally {
      setSaving(false);
    }
  };

  const formatCurrency = (val: string) => {
    const num = val.replace(/[^0-9]/g, '');
    return num ? Number(num).toLocaleString() : '';
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="journal-form-modal" onClick={(e) => e.stopPropagation()}>
        <div className="journal-form-header">
          <h3>일정 등록 — {targetDate}</h3>
          <button className="btn-close" onClick={onClose}><X size={18} /></button>
        </div>

        <form onSubmit={handleSubmit} className="journal-form-body">
          {/* 업무 유형 + 현장 출퇴근 */}
          <div className="form-group">
            <label>업무 유형</label>
            <div className="activity-type-row">
              <div className="activity-type-tabs">
                {ACTIVITY_TYPES.map((t) => (
                  <button key={t} type="button" className={`activity-tab ${activityType === t ? 'active' : ''}`}
                    onClick={() => setActivityType(t)}>{t}</button>
                ))}
              </div>
              <div className="field-check-group">
                <label className={`field-check-label ${fieldCheckIn ? 'checked' : ''}`}>
                  <input type="checkbox" checked={fieldCheckIn} onChange={(e) => setFieldCheckIn(e.target.checked)} />
                  현장출근
                </label>
                <label className={`field-check-label ${fieldCheckOut ? 'checked' : ''}`}>
                  <input type="checkbox" checked={fieldCheckOut} onChange={(e) => setFieldCheckOut(e.target.checked)} />
                  현장퇴근
                </label>
              </div>
            </div>
          </div>

          {/* 공통: 시간 */}
          {activityType !== '개인' && (
            <div className="form-row">
              <div className="form-group">
                <label>시작 시간</label>
                <select value={timeFrom} onChange={(e) => setTimeFrom(e.target.value)}>
                  {TIME_OPTIONS.map((t) => <option key={t} value={t}>{t}</option>)}
                </select>
              </div>
              <div className="form-group">
                <label>종료 시간</label>
                <select value={timeTo} onChange={(e) => setTimeTo(e.target.value)}>
                  {TIME_OPTIONS.map((t) => <option key={t} value={t}>{t}</option>)}
                </select>
              </div>
            </div>
          )}

          {/* 입찰 */}
          {activityType === '입찰' && (
            <>
              <div className="form-row">
                <div className="form-group" style={{ flex: '0 0 100px' }}>
                  <label>연도</label>
                  <select value={bidYear} onChange={(e) => setBidYear(e.target.value)}>
                    {YEARS.map((y) => <option key={y} value={y}>{y}</option>)}
                  </select>
                </div>
                <div className="form-group" style={{ flex: '0 0 70px' }}>
                  <label>&nbsp;</label>
                  <input type="text" value="타경" disabled className="input-disabled" />
                </div>
                <div className="form-group">
                  <label>사건번호</label>
                  <input type="text" value={bidCaseNo} onChange={(e) => setBidCaseNo(e.target.value)} placeholder="12345" required />
                </div>
              </div>
              <div className="form-group">
                <label>입찰자 이름</label>
                <input type="text" value={bidBidder} onChange={(e) => setBidBidder(e.target.value)} required />
              </div>
              <div className="form-group">
                <label>법원</label>
                <select value={bidCourt} onChange={(e) => setBidCourt(e.target.value)} required>
                  <option value="">법원 선택</option>
                  {COURTS.map((c) => <option key={c} value={c}>{c}</option>)}
                </select>
              </div>
              <div className="form-group">
                <label>제시 입찰가 (원) <span style={{ color: '#9aa0a6', fontWeight: 400 }}>ex) 브리핑 시 제시금액</span></label>
                <input type="text" value={bidSuggestedPrice} onChange={(e) => setBidSuggestedPrice(formatCurrency(e.target.value))} placeholder="0" />
              </div>
              <div className="form-group">
                <label>실제 작성 입찰가 (원)</label>
                <input type="text" value={bidPrice} onChange={(e) => setBidPrice(formatCurrency(e.target.value))} placeholder="0" />
              </div>
              {showDeviationWarning && (
                <div className="form-group">
                  <label style={{ color: '#d93025' }}>제시입찰가 대비 5% 이상 차이 — 사유 입력 필수</label>
                  <textarea value={bidDeviationReason} onChange={(e) => setBidDeviationReason(e.target.value)}
                    placeholder="제시금액보다 낮게 입찰한 사유를 입력하세요" rows={2} required />
                </div>
              )}
              <div className="form-group">
                <label>낙찰가 (원, 추후입력)</label>
                <input type="text" value={bidWinPrice} onChange={(e) => setBidWinPrice(formatCurrency(e.target.value))} placeholder="추후 작성" />
              </div>
            </>
          )}

          {/* 임장 */}
          {activityType === '임장' && (
            <>
              <div className="form-row">
                <div className="form-group" style={{ flex: '0 0 100px' }}>
                  <label>연도</label>
                  <select value={inspYear} onChange={(e) => setInspYear(e.target.value)}>
                    {YEARS.map((y) => <option key={y} value={y}>{y}</option>)}
                  </select>
                </div>
                <div className="form-group" style={{ flex: '0 0 70px' }}>
                  <label>&nbsp;</label>
                  <input type="text" value="타경" disabled className="input-disabled" />
                </div>
                <div className="form-group">
                  <label>사건번호</label>
                  <input type="text" value={inspCaseNo} onChange={(e) => setInspCaseNo(e.target.value)} placeholder="12345" required />
                </div>
              </div>
              <div className="form-group">
                <label>장소</label>
                <input type="text" value={inspPlace} onChange={(e) => setInspPlace(e.target.value)} required />
              </div>
            </>
          )}

          {/* 미팅 */}
          {activityType === '미팅' && (
            <>
              <div className="form-group">
                <label>미팅 유형</label>
                <select value={meetingType} onChange={(e) => setMeetingType(e.target.value)}>
                  {MEETING_SUBTYPES.map((s) => <option key={s} value={s}>{s}</option>)}
                </select>
              </div>
              {meetingType === '기타' && (
                <div className="form-group">
                  <label>사유</label>
                  <input type="text" value={meetingEtc} onChange={(e) => setMeetingEtc(e.target.value)} required />
                </div>
              )}
              <div className="form-group">
                <label>장소</label>
                <input type="text" value={meetingPlace} onChange={(e) => setMeetingPlace(e.target.value)} />
              </div>
            </>
          )}

          {/* 사무 */}
          {activityType === '사무' && (
            <>
              <div className="form-group">
                <label>업무 유형</label>
                <select value={officeType} onChange={(e) => setOfficeType(e.target.value)}>
                  {OFFICE_SUBTYPES.map((s) => <option key={s} value={s}>{s}</option>)}
                </select>
              </div>
              {officeType === '기타' && (
                <div className="form-group">
                  <label>내용</label>
                  <input type="text" value={officeEtc} onChange={(e) => setOfficeEtc(e.target.value)} required />
                </div>
              )}
            </>
          )}

          {/* 개인 */}
          {activityType === '개인' && (
            <div className="form-group">
              <label>사유 (예: 연차, 월차 등)</label>
              <input type="text" value={personalReason} onChange={(e) => setPersonalReason(e.target.value)} required />
            </div>
          )}

          <button type="submit" className="btn btn-primary btn-full" disabled={saving}>
            <Plus size={16} /> {saving ? '등록중...' : '일정 등록'}
          </button>
        </form>
      </div>
    </div>
  );
}
