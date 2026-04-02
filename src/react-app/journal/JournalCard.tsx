import { useState } from 'react';
import type { JournalEntry } from './types';
import { ACTIVITY_COLORS, formatShortDate, type ActivityType } from './types';
import { ROLE_LABELS } from '../types';
import type { Role } from '../types';
import { api } from '../api';
import { Trash2, CheckCircle, XCircle, MapPin, Pencil, Save, X, Trophy } from 'lucide-react';

interface Props {
  entries: JournalEntry[];
  userName: string;
  userRole?: string;
  positionTitle?: string;
  date: string;
  readonly?: boolean;
  currentUserRole?: string;
  onDelete?: (id: string) => void;
  onToggleComplete?: (id: string, completed: boolean, failReason?: string) => void;
  onUpdate?: () => void;
}

export default function JournalCard({ entries, userName, userRole, positionTitle, date, readonly, currentUserRole, onDelete, onToggleComplete, onUpdate }: Props) {
  const canEditBidFields = entries.some(e => e.activity_type === '입찰') && (
    !readonly || ['master', 'ceo', 'cc_ref', 'admin'].includes(currentUserRole || '')
  );
  const [showPopup, setShowPopup] = useState(false);
  const [failId, setFailId] = useState<string | null>(null);
  const [failReason, setFailReason] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editData, setEditData] = useState<Record<string, any>>({});

  const types = [...new Set(entries.map((e) => e.activity_type))];
  const roleLabel = positionTitle || (userRole ? ROLE_LABELS[userRole as Role] || '' : '');

  const parseData = (data: string) => {
    try { return JSON.parse(data); } catch { return {}; }
  };

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

  const startEdit = (entry: JournalEntry) => {
    setEditingId(entry.id);
    setEditData({ ...parseData(entry.data) });
  };

  const cancelEdit = () => { setEditingId(null); setEditData({}); };

  const saveEdit = async (entry: JournalEntry) => {
    try {
      await api.journal.update(entry.id, { data: editData });
      setEditingId(null);
      onUpdate?.();
    } catch (err: any) { alert(err.message); }
  };

  const toggleBidWon = async (entry: JournalEntry) => {
    const d = parseData(entry.data);
    const newWon = !d.bidWon;
    const updated = { ...d, bidWon: newWon };
    // 낙찰 시 실제입찰가를 낙찰가로 자동 적용
    if (newWon) updated.winPrice = d.bidPrice || '';
    try {
      await api.journal.update(entry.id, { data: updated });
      onUpdate?.();
    } catch (err: any) { alert(err.message); }
  };

  const fmtCurrency = (val: string) => {
    const num = (val || '').replace(/[^0-9]/g, '');
    return num ? Number(num).toLocaleString() : '';
  };

  const ed = (key: string) => editData[key] || '';
  const setEd = (key: string, val: any) => setEditData({ ...editData, [key]: val });

  // 읽기 모드에서 값 표시
  const showVal = (val: string, unit?: string) => {
    if (val && val !== '0') return <span>{val}{unit || ''}</span>;
    return <span style={{ color: '#bdc1c6' }}>미입력</span>;
  };

  return (
    <>
      <div className="journal-card" onClick={() => setShowPopup(true)}>
        {hasFieldCheck && (
          <div className="journal-field-badges">
            {entries.some((e) => parseData(e.data).fieldCheckIn) && <span className="journal-field-badge"><MapPin size={10} /> 현장출근</span>}
            {entries.some((e) => parseData(e.data).fieldCheckOut) && <span className="journal-field-badge"><MapPin size={10} /> 현장퇴근</span>}
            {entries.some((e) => parseData(e.data).briefingSubmit) && <span className="journal-field-badge briefing-badge">브리핑</span>}
          </div>
        )}
        <div className="journal-card-date">{formatShortDate(date)}</div>
        <div className="journal-card-name">{userName} <span className="journal-card-role">{roleLabel}</span></div>
        <div className="journal-card-types">
          {types.map((t) => (
            <span key={t} className="journal-type-tag" style={{ backgroundColor: ACTIVITY_COLORS[t as ActivityType] + '18', color: ACTIVITY_COLORS[t as ActivityType], borderColor: ACTIVITY_COLORS[t as ActivityType] + '40' }}>{t}</span>
          ))}
        </div>
        <div className="journal-card-bottom">
          <span className="journal-card-count">{entries.length}건</span>
          {entries.some((e) => e.activity_type === '입찰' && parseData(e.data).bidWon) && (
            <span className="journal-won-badge"><Trophy size={11} /> 낙찰</span>
          )}
        </div>
      </div>

      {showPopup && (
        <div className="modal-overlay" onClick={() => { setShowPopup(false); cancelEdit(); }}>
          <div className="journal-popup" onClick={(e) => e.stopPropagation()}>
            <div className="journal-popup-header">
              <div>
                <h3>{userName} {roleLabel}</h3>
                <span className="journal-popup-date">{formatShortDate(date)}</span>
                {!readonly && <span className="journal-popup-editable">수정 가능</span>}
              </div>
              <button className="btn-close" onClick={() => { setShowPopup(false); cancelEdit(); }}>×</button>
            </div>

            <div className="journal-popup-body">
              {entries.map((entry) => {
                const d = parseData(entry.data);
                const isEditing = editingId === entry.id;

                return (
                  <div key={entry.id} className={`journal-entry-item ${entry.completed ? 'completed' : ''} ${isEditing ? 'editing' : ''}`}>
                    <div className="journal-entry-header">
                      <span className="journal-type-tag" style={{ backgroundColor: ACTIVITY_COLORS[entry.activity_type as ActivityType] + '18', color: ACTIVITY_COLORS[entry.activity_type as ActivityType], borderColor: ACTIVITY_COLORS[entry.activity_type as ActivityType] + '40' }}>{entry.activity_type}</span>
                      {!isEditing && entry.activity_subtype && <span className="journal-entry-sub">{entry.activity_subtype}</span>}
                      {(d.fieldCheckIn || d.fieldCheckOut || d.briefingSubmit) && !isEditing && (
                        <div className="journal-field-badges-inline">
                          {d.fieldCheckIn && <span className="journal-field-badge"><MapPin size={10} /> 현장출근</span>}
                          {d.fieldCheckOut && <span className="journal-field-badge"><MapPin size={10} /> 현장퇴근</span>}
                          {d.briefingSubmit && <span className="journal-field-badge briefing-badge">브리핑</span>}
                        </div>
                      )}
                      {!readonly && (
                        <div className="journal-entry-actions">
                          {!isEditing && <button className="btn-icon" title="수정" onClick={() => startEdit(entry)}><Pencil size={14} /></button>}
                          {isEditing && <button className="btn-icon success" title="저장" onClick={() => saveEdit(entry)}><Save size={14} /></button>}
                          {isEditing && <button className="btn-icon" title="취소" onClick={cancelEdit}><X size={14} /></button>}
                          {entry.activity_type === '임장' && !isEditing && (
                            <>
                              <button className="btn-icon success" title="완료" onClick={() => onToggleComplete?.(entry.id, true)}><CheckCircle size={16} /></button>
                              <button className="btn-icon danger" title="미완료" onClick={() => setFailId(entry.id)}><XCircle size={16} /></button>
                            </>
                          )}
                          {!isEditing && <button className="btn-icon danger" title="삭제" onClick={() => { if (confirm('삭제하시겠습니까?')) onDelete?.(entry.id); }}><Trash2 size={14} /></button>}
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
                      {/* === 입찰 === */}
                      {entry.activity_type === '입찰' && (
                        isEditing ? (
                          <BidEditForm ed={ed} setEd={setEd} fmtCurrency={fmtCurrency} />
                        ) : (
                          <>
                            {d.timeFrom && <div className="journal-detail-row"><span className="journal-detail-label">시간</span><span>{d.timeFrom} ~ {d.timeTo}</span></div>}
                            <div className="journal-detail-row"><span className="journal-detail-label">사건번호</span>{showVal(d.caseNo)}</div>
                            <div className="journal-detail-row"><span className="journal-detail-label">고객명</span>{showVal(d.bidder)}</div>
                            <div className="journal-detail-row"><span className="journal-detail-label">법원</span>{showVal(d.court)}</div>
                            <div className="journal-detail-row"><span className="journal-detail-label">제시입찰가</span>{showVal(d.suggestedPrice, '원')}</div>
                            <div className="journal-detail-row"><span className="journal-detail-label">작성입찰가</span>{showVal(d.bidPrice, '원')}</div>
                            <div className="journal-detail-row">
                              <span className="journal-detail-label">낙찰가</span>
                              {d.bidWon
                                ? <span style={{ color: '#188038', fontWeight: 600 }}>{d.winPrice || d.bidPrice}원</span>
                                : showVal(d.winPrice, '원')}
                            </div>
                            {d.deviationReason && <div className="journal-detail-row"><span className="journal-detail-label" style={{ color: '#d93025' }}>차이사유</span><span style={{ color: '#d93025' }}>{d.deviationReason}</span></div>}
                            {(!readonly || canEditBidFields) && (
                              <button
                                type="button"
                                className={`btn btn-sm journal-bid-won-btn ${d.bidWon ? 'active' : ''}`}
                                onClick={() => toggleBidWon(entry)}
                              >
                                <Trophy size={13} /> {d.bidWon ? '낙찰 취소' : '낙찰'}
                              </button>
                            )}
                            {canEditBidFields && readonly && (
                              <button type="button" className="btn btn-sm" style={{ marginTop: 4 }}
                                onClick={() => startEdit(entry)}>
                                <Pencil size={11} /> 입찰가/낙찰가 수정
                              </button>
                            )}
                          </>
                        )
                      )}

                      {/* === 임장 === */}
                      {entry.activity_type === '임장' && (
                        isEditing ? (
                          <div className="journal-edit-form">
                            <div className="journal-edit-row"><label>시간</label><input value={ed('timeFrom')} onChange={(e) => setEd('timeFrom', e.target.value)} /> ~ <input value={ed('timeTo')} onChange={(e) => setEd('timeTo', e.target.value)} /></div>
                            <div className="journal-edit-row"><label>사건번호</label><input value={ed('caseNo')} onChange={(e) => setEd('caseNo', e.target.value)} /></div>
                            <div className="journal-edit-row"><label>법원</label><input value={ed('court')} onChange={(e) => setEd('court', e.target.value)} /></div>
                            <div className="journal-edit-row"><label>장소</label><input value={ed('place')} onChange={(e) => setEd('place', e.target.value)} /></div>
                          </div>
                        ) : (
                          <>
                            {d.timeFrom && <div className="journal-detail-row"><span className="journal-detail-label">시간</span><span>{d.timeFrom} ~ {d.timeTo}</span></div>}
                            <div className="journal-detail-row"><span className="journal-detail-label">사건번호</span>{showVal(d.caseNo)}</div>
                            {d.client && <div className="journal-detail-row"><span className="journal-detail-label">고객명</span>{showVal(d.client)}</div>}
                            {d.court && <div className="journal-detail-row"><span className="journal-detail-label">법원</span>{showVal(d.court)}</div>}
                            <div className="journal-detail-row"><span className="journal-detail-label">장소</span>{showVal(d.place)}</div>
                            {entry.completed === 1 && <div className="journal-detail-row"><span className="journal-detail-label">상태</span><span style={{ color: '#188038' }}>완료</span></div>}
                            {entry.completed === 0 && entry.fail_reason && <div className="journal-detail-row"><span className="journal-detail-label">미완료</span><span style={{ color: '#d93025' }}>{entry.fail_reason}</span></div>}
                          </>
                        )
                      )}

                      {/* === 미팅 === */}
                      {entry.activity_type === '미팅' && (
                        isEditing ? (
                          <div className="journal-edit-form">
                            <div className="journal-edit-row"><label>시간</label><input value={ed('timeFrom')} onChange={(e) => setEd('timeFrom', e.target.value)} /> ~ <input value={ed('timeTo')} onChange={(e) => setEd('timeTo', e.target.value)} /></div>
                            <div className="journal-edit-row"><label>유형</label><input value={ed('meetingType')} onChange={(e) => setEd('meetingType', e.target.value)} /></div>
                            <div className="journal-edit-row"><label>장소</label><input value={ed('place')} onChange={(e) => setEd('place', e.target.value)} /></div>
                          </div>
                        ) : (
                          <>
                            {d.timeFrom && <div className="journal-detail-row"><span className="journal-detail-label">시간</span><span>{d.timeFrom} ~ {d.timeTo}</span></div>}
                            <div className="journal-detail-row"><span className="journal-detail-label">유형</span><span>{d.meetingType}{d.etcReason ? ` - ${d.etcReason}` : ''}</span></div>
                            {d.client && <div className="journal-detail-row"><span className="journal-detail-label">고객명</span>{showVal(d.client)}</div>}
                            {d.place && <div className="journal-detail-row"><span className="journal-detail-label">장소</span>{showVal(d.place)}</div>}
                          </>
                        )
                      )}

                      {/* === 사무 === */}
                      {entry.activity_type === '사무' && (
                        isEditing ? (
                          <div className="journal-edit-form">
                            <div className="journal-edit-row"><label>시간</label><input value={ed('timeFrom')} onChange={(e) => setEd('timeFrom', e.target.value)} /> ~ <input value={ed('timeTo')} onChange={(e) => setEd('timeTo', e.target.value)} /></div>
                            <div className="journal-edit-row"><label>유형</label><input value={ed('officeType')} onChange={(e) => setEd('officeType', e.target.value)} /></div>
                          </div>
                        ) : (
                          <>
                            {d.timeFrom && <div className="journal-detail-row"><span className="journal-detail-label">시간</span><span>{d.timeFrom} ~ {d.timeTo}</span></div>}
                            <div className="journal-detail-row"><span className="journal-detail-label">유형</span><span>{d.officeType}{d.etcReason ? ` - ${d.etcReason}` : ''}</span></div>
                          </>
                        )
                      )}

                      {/* === 개인 === */}
                      {entry.activity_type === '개인' && (
                        isEditing ? (
                          <div className="journal-edit-form">
                            <div className="journal-edit-row"><label>사유</label><input value={ed('reason')} onChange={(e) => setEd('reason', e.target.value)} /></div>
                          </div>
                        ) : (
                          <div className="journal-detail-row"><span className="journal-detail-label">사유</span>{showVal(d.reason)}</div>
                        )
                      )}

                      {/* === 브리핑 (독립 타입) === */}
                      {entry.activity_type === '브리핑' && !isEditing && (
                        <>
                          <div className="journal-detail-row"><span className="journal-detail-label">사건번호</span>{showVal(d.briefingCaseNo)}</div>
                          {d.briefingCourt && <div className="journal-detail-row"><span className="journal-detail-label">법원</span><span>{d.briefingCourt}</span></div>}
                          {d.client && <div className="journal-detail-row"><span className="journal-detail-label">고객명</span>{showVal(d.client)}</div>}
                        </>
                      )}

                      {/* 브리핑 (다른 타입 하위 체크박스) */}
                      {entry.activity_type !== '브리핑' && !isEditing && d.briefingSubmit && d.briefingCaseNo && (
                        <>
                          <div className="journal-detail-row" style={{ marginTop: 6, paddingTop: 6, borderTop: '1px dashed #e8eaed' }}>
                            <span className="journal-detail-label" style={{ color: '#1a73e8' }}>브리핑</span><span>{d.briefingCaseNo}</span>
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

// 입찰 수정 폼 (5% 차이 사유 포함)
function BidEditForm({ ed, setEd, fmtCurrency }: { ed: (k: string) => any; setEd: (k: string, v: any) => void; fmtCurrency: (v: string) => string }) {
  const s = Number((ed('suggestedPrice') || '').replace(/[^0-9]/g, ''));
  const a = Number((ed('bidPrice') || '').replace(/[^0-9]/g, ''));
  const hasDeviation = s > 0 && a > 0 && (s - a) / s >= 0.05;

  return (
    <div className="journal-edit-form">
      <div className="journal-edit-row"><label>시간</label><input value={ed('timeFrom')} onChange={(e) => setEd('timeFrom', e.target.value)} /> ~ <input value={ed('timeTo')} onChange={(e) => setEd('timeTo', e.target.value)} /></div>
      <div className="journal-edit-row"><label>사건번호</label><input value={ed('caseNo')} onChange={(e) => setEd('caseNo', e.target.value)} /></div>
      <div className="journal-edit-row"><label>고객명</label><input value={ed('bidder')} onChange={(e) => setEd('bidder', e.target.value)} /></div>
      <div className="journal-edit-row"><label>법원</label><input value={ed('court')} onChange={(e) => setEd('court', e.target.value)} /></div>
      <div className="journal-edit-row"><label>제시입찰가</label><input value={ed('suggestedPrice')} onChange={(e) => setEd('suggestedPrice', fmtCurrency(e.target.value))} /></div>
      <div className="journal-edit-row"><label>작성입찰가</label><input value={ed('bidPrice')} onChange={(e) => setEd('bidPrice', fmtCurrency(e.target.value))} /></div>
      {hasDeviation && (
        <div className="journal-edit-row" style={{ background: '#fef2f2', borderRadius: 6, padding: '6px 8px' }}>
          <label style={{ color: '#d93025' }}>5% 이상 차이 — 사유</label>
          <input value={ed('deviationReason')} onChange={(e) => setEd('deviationReason', e.target.value)} placeholder="사유를 입력하세요" style={{ borderColor: '#d93025' }} />
        </div>
      )}
      <div className="journal-edit-row"><label>낙찰가</label><input value={ed('winPrice')} onChange={(e) => setEd('winPrice', fmtCurrency(e.target.value))} /></div>
    </div>
  );
}
