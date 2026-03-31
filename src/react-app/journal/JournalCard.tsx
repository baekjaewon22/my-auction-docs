import { useState } from 'react';
import type { JournalEntry } from './types';
import { ACTIVITY_COLORS, formatShortDate, type ActivityType } from './types';
import { ROLE_LABELS } from '../types';
import type { Role } from '../types';
import { Trash2, CheckCircle, XCircle, MapPin } from 'lucide-react';

interface Props {
  entries: JournalEntry[];
  userName: string;
  userRole?: string;
  date: string;
  readonly?: boolean;
  onDelete?: (id: string) => void;
  onToggleComplete?: (id: string, completed: boolean, failReason?: string) => void;
}

export default function JournalCard({ entries, userName, userRole, date, readonly, onDelete, onToggleComplete }: Props) {
  const [showPopup, setShowPopup] = useState(false);
  const [failId, setFailId] = useState<string | null>(null);
  const [failReason, setFailReason] = useState('');

  const types = [...new Set(entries.map((e) => e.activity_type))];
  const roleLabel = userRole ? ROLE_LABELS[userRole as Role] || '' : '';

  const parseData = (data: string) => {
    try { return JSON.parse(data); } catch { return {}; }
  };

  // Check if any entry has field check-in/out
  const hasFieldCheck = entries.some((e) => {
    const d = parseData(e.data);
    return d.fieldCheckIn || d.fieldCheckOut || d.briefingSubmit;
  });

  const handleFail = (id: string) => {
    if (!failReason) { alert('사유를 입력하세요.'); return; }
    onToggleComplete?.(id, false, failReason);
    setFailId(null);
    setFailReason('');
  };

  return (
    <>
      <div className="journal-card" onClick={() => setShowPopup(true)}>
        {/* 현장 출퇴근 뱃지 */}
        {hasFieldCheck && (
          <div className="journal-field-badges">
            {entries.some((e) => parseData(e.data).fieldCheckIn) && (
              <span className="journal-field-badge"><MapPin size={10} /> 현장출근</span>
            )}
            {entries.some((e) => parseData(e.data).fieldCheckOut) && (
              <span className="journal-field-badge"><MapPin size={10} /> 현장퇴근</span>
            )}
            {entries.some((e) => parseData(e.data).briefingSubmit) && (
              <span className="journal-field-badge briefing-badge">브리핑</span>
            )}
          </div>
        )}
        <div className="journal-card-date">{formatShortDate(date)}</div>
        <div className="journal-card-name">{userName} <span className="journal-card-role">{roleLabel}</span></div>
        <div className="journal-card-types">
          {types.map((t) => (
            <span key={t} className="journal-type-tag" style={{ backgroundColor: ACTIVITY_COLORS[t as ActivityType] + '18', color: ACTIVITY_COLORS[t as ActivityType], borderColor: ACTIVITY_COLORS[t as ActivityType] + '40' }}>
              {t}
            </span>
          ))}
        </div>
        <div className="journal-card-count">{entries.length}건</div>
      </div>

      {/* Detail Popup */}
      {showPopup && (
        <div className="modal-overlay" onClick={() => setShowPopup(false)}>
          <div className="journal-popup" onClick={(e) => e.stopPropagation()}>
            <div className="journal-popup-header">
              <div>
                <h3>{userName} {roleLabel}</h3>
                <span className="journal-popup-date">{formatShortDate(date)}</span>
              </div>
              <button className="btn-close" onClick={() => setShowPopup(false)}>×</button>
            </div>

            <div className="journal-popup-body">
              {entries.map((entry) => {
                const d = parseData(entry.data);
                return (
                  <div key={entry.id} className={`journal-entry-item ${entry.completed ? 'completed' : ''}`}>
                    <div className="journal-entry-header">
                      <span className="journal-type-tag" style={{ backgroundColor: ACTIVITY_COLORS[entry.activity_type as ActivityType] + '18', color: ACTIVITY_COLORS[entry.activity_type as ActivityType], borderColor: ACTIVITY_COLORS[entry.activity_type as ActivityType] + '40' }}>
                        {entry.activity_type}
                      </span>
                      {entry.activity_subtype && <span className="journal-entry-sub">{entry.activity_subtype}</span>}
                      {(d.fieldCheckIn || d.fieldCheckOut || d.briefingSubmit) && (
                        <div className="journal-field-badges-inline">
                          {d.fieldCheckIn && <span className="journal-field-badge"><MapPin size={10} /> 현장출근</span>}
                          {d.fieldCheckOut && <span className="journal-field-badge"><MapPin size={10} /> 현장퇴근</span>}
                          {d.briefingSubmit && <span className="journal-field-badge briefing-badge">브리핑</span>}
                        </div>
                      )}
                      {!readonly && (
                        <div className="journal-entry-actions">
                          {entry.activity_type === '임장' && (
                            <>
                              <button className="btn-icon success" title="완료" onClick={() => onToggleComplete?.(entry.id, true)}>
                                <CheckCircle size={16} />
                              </button>
                              <button className="btn-icon danger" title="미완료" onClick={() => setFailId(entry.id)}>
                                <XCircle size={16} />
                              </button>
                            </>
                          )}
                          <button className="btn-icon danger" title="삭제" onClick={() => { if (confirm('삭제하시겠습니까?')) onDelete?.(entry.id); }}>
                            <Trash2 size={14} />
                          </button>
                        </div>
                      )}
                    </div>

                    {failId === entry.id && (
                      <div className="journal-fail-input">
                        <input type="text" value={failReason} onChange={(e) => setFailReason(e.target.value)} placeholder="미완료 사유" />
                        <button className="btn btn-sm btn-danger" onClick={() => handleFail(entry.id)}>확인</button>
                        <button className="btn btn-sm" onClick={() => setFailId(null)}>취소</button>
                      </div>
                    )}

                    <div className="journal-entry-details">
                      {d.timeFrom && <div className="journal-detail-row"><span className="journal-detail-label">시간</span><span>{d.timeFrom} ~ {d.timeTo}</span></div>}

                      {entry.activity_type === '입찰' && (
                        <>
                          <div className="journal-detail-row"><span className="journal-detail-label">사건번호</span><span>{d.caseNo}</span></div>
                          <div className="journal-detail-row"><span className="journal-detail-label">입찰자</span><span>{d.bidder}</span></div>
                          <div className="journal-detail-row"><span className="journal-detail-label">법원</span><span>{d.court}</span></div>
                          {d.suggestedPrice && <div className="journal-detail-row"><span className="journal-detail-label">제시입찰가</span><span>{d.suggestedPrice}원</span></div>}
                          {d.bidPrice && <div className="journal-detail-row"><span className="journal-detail-label">작성입찰가</span><span>{d.bidPrice}원</span></div>}
                          {d.winPrice && <div className="journal-detail-row"><span className="journal-detail-label">낙찰가</span><span>{d.winPrice}원</span></div>}
                          {d.deviationReason && (
                            <div className="journal-detail-row">
                              <span className="journal-detail-label" style={{ color: '#d93025' }}>차이사유</span>
                              <span style={{ color: '#d93025' }}>{d.deviationReason}</span>
                            </div>
                          )}
                        </>
                      )}
                      {entry.activity_type === '임장' && (
                        <>
                          <div className="journal-detail-row"><span className="journal-detail-label">사건번호</span><span>{d.caseNo}</span></div>
                          {d.court && <div className="journal-detail-row"><span className="journal-detail-label">법원</span><span>{d.court}</span></div>}
                          <div className="journal-detail-row"><span className="journal-detail-label">장소</span><span>{d.place}</span></div>
                          {entry.completed === 1 && <div className="journal-detail-row"><span className="journal-detail-label">상태</span><span style={{ color: '#188038' }}>완료</span></div>}
                          {entry.completed === 0 && entry.fail_reason && <div className="journal-detail-row"><span className="journal-detail-label">미완료 사유</span><span style={{ color: '#d93025' }}>{entry.fail_reason}</span></div>}
                        </>
                      )}
                      {entry.activity_type === '미팅' && (
                        <>
                          <div className="journal-detail-row"><span className="journal-detail-label">유형</span><span>{d.meetingType}{d.etcReason ? ` - ${d.etcReason}` : ''}</span></div>
                          {d.place && <div className="journal-detail-row"><span className="journal-detail-label">장소</span><span>{d.place}</span></div>}
                        </>
                      )}
                      {entry.activity_type === '사무' && (
                        <div className="journal-detail-row"><span className="journal-detail-label">유형</span><span>{d.officeType}{d.etcReason ? ` - ${d.etcReason}` : ''}</span></div>
                      )}
                      {entry.activity_type === '개인' && (
                        <div className="journal-detail-row"><span className="journal-detail-label">사유</span><span>{d.reason}</span></div>
                      )}
                      {d.briefingSubmit && d.briefingCaseNo && (
                        <>
                          <div className="journal-detail-row" style={{ marginTop: 6, paddingTop: 6, borderTop: '1px dashed #e8eaed' }}>
                            <span className="journal-detail-label" style={{ color: '#1a73e8' }}>브리핑</span>
                            <span>{d.briefingCaseNo}</span>
                          </div>
                          {d.briefingCourt && <div className="journal-detail-row"><span className="journal-detail-label">법원</span><span>{d.briefingCourt}</span></div>}
                        </>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
