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
  assignableMembers?: { id: string; name: string; role: string; branch: string; department: string; position_title?: string }[];
  canReassign?: boolean;
}

export default function JournalCard({ entries, userName, userRole, positionTitle, date, readonly, currentUserRole, onDelete, onToggleComplete, onUpdate, assignableMembers = [], canReassign = false }: Props) {
  // 시간순 정렬
  const sortedEntries = [...entries].sort((a, b) => {
    try {
      const da = JSON.parse(a.data), db = JSON.parse(b.data);
      return (da.timeFrom || '99:99').localeCompare(db.timeFrom || '99:99');
    } catch { return 0; }
  });

  const isMaster = currentUserRole === 'master';
  const [showPopup, setShowPopup] = useState(false);
  const [failId, setFailId] = useState<string | null>(null);
  const [failReason, setFailReason] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editData, setEditData] = useState<Record<string, any>>({});

  const types = [...new Set(sortedEntries.map((e) => e.activity_type))];
  const roleLabel = positionTitle || (userRole ? ROLE_LABELS[userRole as Role] || '' : '');

  const parseData = (data: string) => {
    try { return JSON.parse(data); } catch { return {}; }
  };

  const parseMoney = (value: string | number | null | undefined) => {
    return Number(String(value || '').replace(/[^0-9]/g, '')) || 0;
  };

  const formatMoney = (amount: number) => amount.toLocaleString('ko-KR');

  const calculateWinningFee = (winningPrice: number) => {
    if (winningPrice <= 0) return 0;
    return Math.max(Math.round(winningPrice * 0.01), 2_200_000);
  };

  const hasFieldCheck = entries.some((e) => {
    const d = parseData(e.data);
    return d.fieldCheckIn || d.fieldCheckOut || d.briefingSubmit || d.companion;
  });

  const handleFail = (id: string) => {
    if (!failReason) { alert('사유를 입력하세요.'); return; }
    onToggleComplete?.(id, false, failReason);
    setFailId(null);
    setFailReason('');
  };

  const startEdit = (entry: JournalEntry) => {
    setEditingId(entry.id);
    setEditData({ ...parseData(entry.data), __assigneeId: entry.user_id });
  };

  const cancelEdit = () => { setEditingId(null); setEditData({}); };

  const saveEdit = async (entry: JournalEntry) => {
    try {
      // 사건번호 변경 시 activity_subtype도 갱신
      const { __assigneeId, ...rawDataToSave } = editData;
      const dataToSave = rawDataToSave.companion
        ? { ...rawDataToSave, companionPerson: rawDataToSave.client || rawDataToSave.companionPerson || '', fieldCheckIn: false, fieldCheckOut: false }
        : rawDataToSave;
      const updatePayload: { data: Record<string, any>; activity_subtype?: string; bid_field_only?: boolean; user_id?: string } = { data: dataToSave };
      if (editData.caseNo && (entry.activity_type === '입찰' || entry.activity_type === '임장')) {
        updatePayload.activity_subtype = editData.caseNo;
      }
      if (editData.briefingCaseNo && entry.activity_type === '브리핑자료제출') {
        updatePayload.activity_subtype = editData.briefingCaseNo;
      }
      // 읽기전용(과거일정)에서 입찰 수정 시 bid_field_only 플래그 전달
      if (readonly && entry.activity_type === '입찰') {
        updatePayload.bid_field_only = true;
      }
      if (canReassign && __assigneeId && __assigneeId !== entry.user_id) {
        updatePayload.user_id = __assigneeId;
      }
      await api.journal.update(entry.id, updatePayload);
      setEditingId(null);
      onUpdate?.();
    } catch (err: any) { alert(err.message); }
  };

  const toggleBidWon = async (entry: JournalEntry) => {
    const d = parseData(entry.data);
    const newWon = !d.bidWon;
    const updated = { ...d, bidWon: newWon };
    // 낙찰 시 낙찰가 미입력 상태라면 실제입찰가를 기본 낙찰가로 자동 적용
    if (newWon && !updated.winPrice) updated.winPrice = d.bidPrice || '';
    try {
      await api.journal.update(entry.id, { data: updated });
      // 수수료 자동 생성/삭제
      if (newWon) {
        const winningPrice = parseMoney(updated.winPrice);
        const winningFee = calculateWinningFee(winningPrice);
        await api.commissions.create({
          journal_entry_id: entry.id,
          user_id: entry.user_id,
          user_name: userName,
          client_name: d.bidder || d.client || '',
          case_no: d.caseNo || '',
          win_price: winningFee ? formatMoney(winningFee) : '',
        });
        // 매출확인 리스트에도 자동 추가
        try {
          await api.sales.create({
            type: '낙찰',
            type_detail: winningPrice
              ? `낙찰수수료 (낙찰가 ${formatMoney(winningPrice)}원 기준 1%, 최저 220만원)`
              : '낙찰수수료',
            client_name: d.bidder || d.client || '',
            amount: winningFee,
            contract_date: entry.target_date,
            journal_entry_id: entry.id,
          });
        } catch (salesErr: any) {
          console.error('매출 자동등록 실패:', salesErr);
          alert('낙찰은 처리되었으나 업무성과 자동등록에 실패했습니다. 수동으로 등록해주세요.');
        }
      } else {
        await api.commissions.deleteByEntry(entry.id);
        // 매출 내역도 삭제
        try { await api.sales.deleteByEntry(entry.id); } catch { /* */ }
      }
      onUpdate?.();
    } catch (err: any) { alert(err.message); }
  };

  const toggleBidCancelled = async (entry: JournalEntry) => {
    const d = parseData(entry.data);
    const updated = { ...d, bidCancelled: !d.bidCancelled };
    try {
      // bid_field_only: true → 백엔드 과거일정 입찰 필드 수정 허용
      await api.journal.update(entry.id, { data: updated, bid_field_only: true });
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
            {entries.some((e) => parseData(e.data).companion) && <span className="journal-field-badge" style={{ color: '#1a73e8' }}>동행</span>}
          </div>
        )}
        <div className="journal-card-date">{formatShortDate(date)}</div>
        <div className="journal-card-name">{userName} <span className="journal-card-role">{roleLabel}</span></div>
        <div className="journal-card-types">
          {types.map((t) => (
            <span key={t} className="journal-type-tag" style={{ backgroundColor: ACTIVITY_COLORS[t as ActivityType] + '18', color: ACTIVITY_COLORS[t as ActivityType], borderColor: ACTIVITY_COLORS[t as ActivityType] + '40' }}>{t}</span>
          ))}
        </div>
        {(() => {
          const places = sortedEntries
            .filter(e => e.activity_type === '임장' || e.activity_type === '미팅')
            .map(e => { const d = parseData(e.data); return d.place || d.court || ''; })
            .filter(Boolean);
          const unique = [...new Set(places)];
          if (unique.length === 0) return null;
          return (
            <div className="journal-card-places">
              <MapPin size={10} />
              <span>{unique.join(', ')}</span>
            </div>
          );
        })()}
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
              {sortedEntries.map((entry) => {
                const d = parseData(entry.data);
                const isEditing = editingId === entry.id;

                return (
                  <div key={entry.id} className={`journal-entry-item ${entry.completed ? 'completed' : ''} ${isEditing ? 'editing' : ''}`}>
                    <div className="journal-entry-header">
                      <span className="journal-type-tag" style={{ backgroundColor: ACTIVITY_COLORS[entry.activity_type as ActivityType] + '18', color: ACTIVITY_COLORS[entry.activity_type as ActivityType], borderColor: ACTIVITY_COLORS[entry.activity_type as ActivityType] + '40' }}>{entry.activity_type}</span>
                      {!isEditing && entry.activity_subtype && <span className="journal-entry-sub">{entry.activity_subtype}</span>}
                      {(d.fieldCheckIn || d.fieldCheckOut || d.briefingSubmit || d.companion) && !isEditing && (
                        <div className="journal-field-badges-inline">
                          {d.fieldCheckIn && <span className="journal-field-badge"><MapPin size={10} /> 현장출근</span>}
                          {d.fieldCheckOut && <span className="journal-field-badge"><MapPin size={10} /> 현장퇴근</span>}
                          {d.briefingSubmit && <span className="journal-field-badge briefing-badge">브리핑</span>}
                          {d.companion && <span className="journal-field-badge" style={{ color: '#1a73e8' }}>동행</span>}
                        </div>
                      )}
                      {(!readonly || isMaster || isEditing) && (
                        <div className="journal-entry-actions">
                          {(!readonly || isMaster) && !isEditing && <button className="btn-icon" title="수정" onClick={() => startEdit(entry)}><Pencil size={14} /></button>}
                          {isEditing && <button className="btn-icon success" title="저장" onClick={() => saveEdit(entry)}><Save size={14} /></button>}
                          {isEditing && <button className="btn-icon" title="취소" onClick={cancelEdit}><X size={14} /></button>}
                          {entry.activity_type === '임장' && !isEditing && !readonly && (
                            <>
                              <button className="btn-icon success" title="완료" onClick={() => onToggleComplete?.(entry.id, true)}><CheckCircle size={16} /></button>
                              <button className="btn-icon danger" title="미완료" onClick={() => setFailId(entry.id)}><XCircle size={16} /></button>
                            </>
                          )}
                          {(!readonly || isMaster) && !isEditing && <button className="btn-icon danger" title="삭제" onClick={() => { if (confirm('삭제하시겠습니까?')) onDelete?.(entry.id); }}><Trash2 size={14} /></button>}
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

                    {isEditing && canReassign && assignableMembers.length > 0 && (
                      <div className="journal-edit-row">
                        <label>담당자</label>
                        <select value={ed('__assigneeId')} onChange={(e) => setEd('__assigneeId', e.target.value)}>
                          {assignableMembers.map((m) => (
                            <option key={m.id} value={m.id}>
                              {m.name}{m.position_title ? ` · ${m.position_title}` : ''}{m.department ? ` · ${m.department}` : ''}
                            </option>
                          ))}
                        </select>
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
                            {d.bidProxy && <div className="journal-detail-row"><span className="journal-detail-label" style={{ color: '#7b1fa2' }}>대리입찰</span><span style={{ color: '#7b1fa2' }}>대리입찰</span></div>}
                            {d.bidCancelled && <div className="journal-detail-row"><span className="journal-detail-label" style={{ color: '#e65100' }}>상태</span><span style={{ color: '#e65100', fontWeight: 600 }}>취하/변경</span></div>}
                            {d.deviationReason && <div className="journal-detail-row"><span className="journal-detail-label" style={{ color: '#d93025' }}>차이사유</span><span style={{ color: '#d93025' }}>{d.deviationReason}</span></div>}
                            {/* 낙찰/입찰가/낙찰가 버튼 — 과거 일정이어도 항상 가능 */}
                            <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                              <button
                                type="button"
                                className={`btn btn-sm journal-bid-won-btn ${d.bidWon ? 'active' : ''}`}
                                onClick={() => toggleBidWon(entry)}
                              >
                                <Trophy size={13} /> {d.bidWon ? '낙찰 취소' : '낙찰'}
                              </button>
                              <button
                                type="button"
                                className="btn btn-sm"
                                style={{
                                  fontSize: '0.72rem', padding: '4px 8px',
                                  background: d.bidCancelled ? '#fff3e0' : '#fff',
                                  border: '1px solid ' + (d.bidCancelled ? '#ffb74d' : '#dadce0'),
                                  color: d.bidCancelled ? '#e65100' : '#5f6368',
                                  fontWeight: d.bidCancelled ? 600 : 400,
                                }}
                                onClick={() => toggleBidCancelled(entry)}
                                title="작성입찰가/낙찰가 미입력 허용"
                              >
                                {d.bidCancelled ? '✓ 취하/변경' : '취하/변경'}
                              </button>
                            </div>
                            {!d.winPrice && (
                              <button type="button" className="btn btn-sm" style={{ marginTop: 4 }}
                                onClick={() => startEdit(entry)}>
                                <Pencil size={11} /> 낙찰가 입력
                              </button>
                            )}
                            {d.winPrice && (
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
                            <CompanionEdit ed={ed} setEditData={setEditData} editData={editData} />
                            <div className="journal-edit-row"><label>시간</label><input value={ed('timeFrom')} onChange={(e) => setEd('timeFrom', e.target.value)} /> ~ <input value={ed('timeTo')} onChange={(e) => setEd('timeTo', e.target.value)} /></div>
                            <div className="journal-edit-row"><label>사건번호</label><input value={ed('caseNo')} onChange={(e) => setEd('caseNo', e.target.value)} /></div>
                            <div className="journal-edit-row"><label>{ed('companion') ? '담당자' : '고객명'}</label><input value={ed('client')} onChange={(e) => setEd('client', e.target.value)} /></div>
                            <div className="journal-edit-row"><label>법원</label><input value={ed('court')} onChange={(e) => setEd('court', e.target.value)} /></div>
                            <div className="journal-edit-row"><label>장소</label><input value={ed('place')} onChange={(e) => setEd('place', e.target.value)} /></div>
                            {!ed('companion') && <FieldCheckEdit ed={ed} setEd={setEd} />}
                          </div>
                        ) : (
                          <>
                            {d.timeFrom && <div className="journal-detail-row"><span className="journal-detail-label">시간</span><span>{d.timeFrom} ~ {d.timeTo}</span></div>}
                            <div className="journal-detail-row"><span className="journal-detail-label">사건번호</span>{showVal(d.caseNo)}</div>
                            {d.client && <div className="journal-detail-row"><span className="journal-detail-label">{d.companion ? '담당자' : '고객명'}</span>{showVal(d.client)}</div>}
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
                            <CompanionEdit ed={ed} setEditData={setEditData} editData={editData} />
                            <div className="journal-edit-row"><label>시간</label><input value={ed('timeFrom')} onChange={(e) => setEd('timeFrom', e.target.value)} /> ~ <input value={ed('timeTo')} onChange={(e) => setEd('timeTo', e.target.value)} /></div>
                            <div className="journal-edit-row"><label>유형</label><input value={ed('meetingType')} onChange={(e) => setEd('meetingType', e.target.value)} /></div>
                            <div className="journal-edit-row"><label>{ed('companion') ? '담당자' : '고객명'}</label><input value={ed('client')} onChange={(e) => setEd('client', e.target.value)} /></div>
                            <div className="journal-edit-row" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                              <label>장소</label>
                              <input style={{ flex: 1 }}
                                value={ed('place')}
                                disabled={!!ed('internalMeeting')}
                                placeholder={ed('internalMeeting') ? '회사' : '장소'}
                                onChange={(e) => setEd('place', e.target.value)} />
                              <button type="button"
                                style={{ flex: 1, cursor: 'pointer', padding: '5px 8px', borderRadius: 6, border: '1px solid #dadce0', fontSize: '0.78rem',
                                  background: ed('internalMeeting') ? '#e8f5e9' : '#fff',
                                  color: ed('internalMeeting') ? '#188038' : '#3c4043',
                                  fontWeight: ed('internalMeeting') ? 600 : 400 }}
                                onClick={() => {
                                  const next = !ed('internalMeeting');
                                  if (next) {
                                    setEditData({ ...editData, internalMeeting: true, place: '회사', fieldCheckIn: false, fieldCheckOut: false });
                                  } else {
                                    setEditData({ ...editData, internalMeeting: false, place: '' });
                                  }
                                }}>
                                {ed('internalMeeting') ? '✓ 회사 미팅 (외근 X)' : '회사 미팅'}
                              </button>
                            </div>
                            {!ed('companion') && <FieldCheckEdit ed={ed} setEd={setEd} />}
                          </div>
                        ) : (
                          <>
                            {d.timeFrom && <div className="journal-detail-row"><span className="journal-detail-label">시간</span><span>{d.timeFrom} ~ {d.timeTo}</span></div>}
                            <div className="journal-detail-row"><span className="journal-detail-label">유형</span><span>{d.meetingType}{d.etcReason ? ` - ${d.etcReason}` : ''}{d.internalMeeting && <span style={{ marginLeft: 6, padding: '1px 6px', background: '#e8f5e9', color: '#188038', borderRadius: 8, fontSize: '0.7rem', fontWeight: 600 }}>회사 미팅</span>}{d.companion && <span style={{ marginLeft: 6, padding: '1px 6px', background: '#e8f0fe', color: '#1a73e8', borderRadius: 8, fontSize: '0.7rem', fontWeight: 600 }}>동행</span>}</span></div>
                            {d.caseNo && <div className="journal-detail-row"><span className="journal-detail-label">사건번호</span>{showVal(d.caseNo)}</div>}
                            {d.client && <div className="journal-detail-row"><span className="journal-detail-label">{d.companion ? '담당자' : '고객명'}</span>{showVal(d.client)}</div>}
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
                            <FieldCheckEdit ed={ed} setEd={setEd} />
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
                      {entry.activity_type === '브리핑자료제출' && (
                        isEditing ? (
                          <div className="journal-edit-form">
                            <div className="journal-edit-row"><label>사건번호</label><input value={ed('briefingCaseNo')} onChange={(e) => setEd('briefingCaseNo', e.target.value)} /></div>
                            <div className="journal-edit-row"><label>물건번호</label><input value={ed('briefingItemNo')} onChange={(e) => setEd('briefingItemNo', e.target.value)} /></div>
                            <div className="journal-edit-row"><label>고객명</label><input value={ed('client')} onChange={(e) => setEd('client', e.target.value)} /></div>
                            <div className="journal-edit-row"><label>법원</label><input value={ed('briefingCourt')} onChange={(e) => setEd('briefingCourt', e.target.value)} /></div>
                          </div>
                        ) : (
                          <>
                            <div className="journal-detail-row"><span className="journal-detail-label">사건번호</span>{showVal(d.briefingCaseNo)}</div>
                            {d.briefingCourt && <div className="journal-detail-row"><span className="journal-detail-label">법원</span><span>{d.briefingCourt}</span></div>}
                            {d.client && <div className="journal-detail-row"><span className="journal-detail-label">고객명</span>{showVal(d.client)}</div>}
                          </>
                        )
                      )}

                      {/* 브리핑 (다른 타입 하위 체크박스) */}
                      {entry.activity_type !== '브리핑자료제출' && !isEditing && d.briefingSubmit && d.briefingCaseNo && (
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

// 현장출근/퇴근 체크박스 (수정 폼 공용)
function CompanionEdit({ ed, editData, setEditData }: { ed: (k: string) => any; editData: Record<string, any>; setEditData: (data: Record<string, any>) => void }) {
  const isOn = !!ed('companion');
  return (
    <div className="journal-edit-row">
      <label>동행</label>
      <button
        type="button"
        className={`field-check-label ${isOn ? 'checked' : ''}`}
        style={{
          cursor: 'pointer',
          padding: '5px 10px',
          borderRadius: 6,
          border: '1px solid #dadce0',
          background: isOn ? '#e8f0fe' : '#fff',
          color: isOn ? '#1a73e8' : '#3c4043',
          fontWeight: isOn ? 700 : 400,
        }}
        onClick={() => {
          const next = !isOn;
          setEditData({
            ...editData,
            companion: next,
            companionPerson: next ? (editData.client || '') : '',
            fieldCheckIn: next ? false : editData.fieldCheckIn,
            fieldCheckOut: next ? false : editData.fieldCheckOut,
          });
        }}
      >
        {isOn ? '✓ 동행 (통계/중복 제외)' : '동행'}
      </button>
    </div>
  );
}

function FieldCheckEdit({ ed, setEd }: { ed: (k: string) => any; setEd: (k: string, v: any) => void }) {
  return (
    <div className="journal-edit-row">
      <label>현장</label>
      <div className="field-check-group" style={{ display: 'flex', gap: 12 }}>
        <label className={`field-check-label ${ed('fieldCheckIn') ? 'checked' : ''}`} style={{ cursor: 'pointer' }}>
          <input type="checkbox" checked={!!ed('fieldCheckIn')} onChange={(e) => setEd('fieldCheckIn', e.target.checked)} /> 현장출근
        </label>
        <label className={`field-check-label ${ed('fieldCheckOut') ? 'checked' : ''}`} style={{ cursor: 'pointer' }}>
          <input type="checkbox" checked={!!ed('fieldCheckOut')} onChange={(e) => setEd('fieldCheckOut', e.target.checked)} /> 현장퇴근
        </label>
      </div>
    </div>
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
      <div className="journal-edit-row">
        <label>상태</label>
        <label className={`field-check-label ${ed('bidCancelled') ? 'checked' : ''}`} style={{ cursor: 'pointer', fontSize: '0.78rem', padding: '4px 8px' }}>
          <input type="checkbox" checked={!!ed('bidCancelled')} onChange={(e) => setEd('bidCancelled', e.target.checked)} /> 취하/변경
        </label>
        {ed('bidCancelled') && <span style={{ marginLeft: 6, fontSize: '0.72rem', color: '#e65100' }}>작성입찰가/낙찰가 미입력 허용</span>}
      </div>
      <FieldCheckEdit ed={ed} setEd={setEd} />
    </div>
  );
}
