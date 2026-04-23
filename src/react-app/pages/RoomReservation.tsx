import { useEffect, useMemo, useState } from 'react';
import { DoorOpen, ChevronLeft, Calendar, Clock, User, Trash2, Plus, MapPin, Sparkles, Building2, ArrowUpRight, History } from 'lucide-react';
import { api } from '../api';
import { useAuthStore } from '../store';

const ROOM_CONFIG: Record<string, string[]> = {
  '의정부': ['1회의실', '2회의실'],
  '서초': ['1회의실', '2회의실'],
  '대전': ['1회의실'],
  '부산': ['1회의실', '2회의실', '3회의실'],
};

const BRANCH_META: Record<string, { subtitle: string; code: string; gradient: string; accent: string; glow: string }> = {
  '의정부': {
    subtitle: 'Headquarters',
    code: 'HQ',
    gradient: 'linear-gradient(135deg, #eff6ff 0%, #dbeafe 55%, #bfdbfe 100%)',
    accent: '#3b82f6',
    glow: 'rgba(59, 130, 246, 0.22)',
  },
  '서초': {
    subtitle: 'Seoul Branch',
    code: 'SC',
    gradient: 'linear-gradient(135deg, #eef2ff 0%, #e0e7ff 55%, #c7d2fe 100%)',
    accent: '#6366f1',
    glow: 'rgba(99, 102, 241, 0.22)',
  },
  '대전': {
    subtitle: 'Daejeon Branch',
    code: 'DJ',
    gradient: 'linear-gradient(135deg, #f0f9ff 0%, #e0f2fe 55%, #bae6fd 100%)',
    accent: '#0ea5e9',
    glow: 'rgba(14, 165, 233, 0.22)',
  },
  '부산': {
    subtitle: 'Busan Branch',
    code: 'BS',
    gradient: 'linear-gradient(135deg, #f0fdfa 0%, #ccfbf1 55%, #99f6e4 100%)',
    accent: '#14b8a6',
    glow: 'rgba(20, 184, 166, 0.22)',
  },
};

// 09:00 ~ 17:30 시작 가능, 18:00 종료 가능 (30분 단위)
const START_SLOTS: string[] = [];
const END_SLOTS: string[] = [];
for (let h = 9; h < 18; h++) {
  START_SLOTS.push(`${String(h).padStart(2, '0')}:00`);
  START_SLOTS.push(`${String(h).padStart(2, '0')}:30`);
  END_SLOTS.push(`${String(h).padStart(2, '0')}:30`);
  END_SLOTS.push(`${String(h + 1).padStart(2, '0')}:00`);
}
// END_SLOTS 마지막까지 18:00 포함
const ALL_SLOTS = START_SLOTS; // 시각화용 18개

function weekdayKo(d: Date) {
  return ['일', '월', '화', '수', '목', '금', '토'][d.getDay()];
}
// 로컬 시간 기준 YYYY-MM-DD (toISOString은 UTC로 변환되어 KST에서 하루 밀리는 버그 방지)
function fmtDate(d: Date) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}
function fmtMonth(d: Date) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  return `${y}-${m}`;
}
function parseDate(s: string) { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); }

type Reservation = {
  id: string; user_id: string; branch: string; room_name: string;
  reservation_date: string; start_time: string; end_time: string;
  title: string; note: string; status: string;
  user_name?: string; user_department?: string;
  user_position?: string; user_branch?: string;
  created_at: string;
};

export default function RoomReservation() {
  const { user } = useAuthStore();
  const [branch, setBranch] = useState<string>('');
  const [room, setRoom] = useState<string>('');
  const [tab, setTab] = useState<'current' | 'history'>('current');
  const [date, setDate] = useState<string>(() => {
    // 주말이면 다음 평일로
    const d = new Date(); d.setHours(0, 0, 0, 0);
    while (d.getDay() === 0 || d.getDay() === 6) d.setDate(d.getDate() + 1);
    return fmtDate(d);
  });
  const [reservations, setReservations] = useState<Reservation[]>([]);
  const [historyItems, setHistoryItems] = useState<Reservation[]>([]);
  const [historyMonth, setHistoryMonth] = useState<string>(() => {
    const d = new Date(); d.setMonth(d.getMonth() - 1);
    return fmtMonth(d);
  });
  const [loading, setLoading] = useState(false);
  const [startTime, setStartTime] = useState('');
  const [endTime, setEndTime] = useState('');
  const [title, setTitle] = useState('');
  const [note, setNote] = useState('');

  // 2주치 날짜 배열 — 주말(토·일) 제외
  const dateOptions = useMemo(() => {
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const all = Array.from({ length: 14 }, (_, i) => {
      const d = new Date(today); d.setDate(today.getDate() + i);
      return d;
    });
    return all.filter(d => d.getDay() !== 0 && d.getDay() !== 6);
  }, []);

  const rooms = ROOM_CONFIG[branch] || [];

  useEffect(() => {
    if (branch && rooms.length > 0 && !room) setRoom(rooms[0]);
  }, [branch]);

  const load = async () => {
    if (!branch || !room) return;
    setLoading(true);
    try {
      const res = await api.rooms.list({ branch, room, date });
      setReservations(res.reservations || []);
    } catch { setReservations([]); }
    finally { setLoading(false); }
  };

  useEffect(() => { load(); }, [branch, room, date]);

  // 과거 예약 로드 (선택 월의 1일~말일)
  const loadHistory = async () => {
    if (!branch) return;
    setLoading(true);
    try {
      const [y, m] = historyMonth.split('-').map(Number);
      const from = `${historyMonth}-01`;
      const lastDay = new Date(y, m, 0).getDate();
      const to = `${historyMonth}-${String(lastDay).padStart(2, '0')}`;
      const today = fmtDate(new Date());
      // 과거 = 오늘 이전만 (오늘 포함 미래는 current 탭에서)
      const res = await api.rooms.list({ branch, room: room || undefined, from, to, include_cancelled: true });
      setHistoryItems((res.reservations || []).filter(r => r.reservation_date < today));
    } catch { setHistoryItems([]); }
    finally { setLoading(false); }
  };
  useEffect(() => { if (tab === 'history') loadHistory(); }, [tab, branch, room, historyMonth]);

  // 해당 슬롯이 예약됐는지 (시작 시각 기준 30분 블록이 겹치면 true)
  const slotState = (slot: string): { booked: boolean; res?: Reservation } => {
    const r = reservations.find(r => slot >= r.start_time && slot < r.end_time);
    return r ? { booked: true, res: r } : { booked: false };
  };

  // 시작시간 변경 시 종료는 +30분 기본
  const onStartChange = (v: string) => {
    setStartTime(v);
    if (v && (!endTime || endTime <= v)) {
      const idx = ALL_SLOTS.indexOf(v);
      const next = ALL_SLOTS[idx + 1] || '18:00';
      setEndTime(next);
    }
  };

  // 타임라인 슬롯 클릭 → 시작/끝 동기화
  const handleSlotClick = (slot: string) => {
    const st = slotState(slot);
    if (st.booked) return;
    // 시작 없음 또는 시작 이전 클릭 → 시작 리셋, 끝=+30분
    if (!startTime || slot < startTime) {
      setStartTime(slot);
      const idx = ALL_SLOTS.indexOf(slot);
      setEndTime(ALL_SLOTS[idx + 1] || '18:00');
      return;
    }
    // 시작 이후 클릭 → 끝 연장 (중간에 예약 있으면 차단)
    const si = ALL_SLOTS.indexOf(startTime);
    const ci = ALL_SLOTS.indexOf(slot);
    for (let i = si; i <= ci; i++) {
      if (slotState(ALL_SLOTS[i]).booked) {
        alert('예약된 시간을 넘어 연장할 수 없습니다.');
        return;
      }
    }
    setEndTime(ALL_SLOTS[ci + 1] || '18:00');
  };
  const clearSelection = () => { setStartTime(''); setEndTime(''); };

  // 유효 종료시간 목록: 시작 시간 이후 && 중간에 예약된 슬롯 없음
  const validEndTimes = useMemo(() => {
    if (!startTime) return END_SLOTS;
    const si = ALL_SLOTS.indexOf(startTime);
    if (si < 0) return END_SLOTS;
    const valid: string[] = [];
    for (let i = si; i < ALL_SLOTS.length; i++) {
      const slot = ALL_SLOTS[i];
      if (slotState(slot).booked) break;
      const endCandidate = i + 1 < ALL_SLOTS.length ? ALL_SLOTS[i + 1] : '18:00';
      valid.push(endCandidate);
    }
    return valid;
  }, [startTime, reservations]);

  const handleReserve = async () => {
    if (!branch || !room) return alert('지사/회의실을 선택하세요.');
    if (!startTime || !endTime) return alert('시작·종료 시간을 선택하세요.');
    if (startTime >= endTime) return alert('종료시간이 시작시간보다 빨라야 합니다.');
    if (!title.trim()) return alert('회의 제목을 입력하세요.');
    try {
      await api.rooms.create({ branch, room_name: room, reservation_date: date, start_time: startTime, end_time: endTime, title: title.trim(), note: note.trim() });
      setStartTime(''); setEndTime(''); setTitle(''); setNote('');
      await load();
    } catch (err: any) { alert(err.message); }
  };

  const handleCancel = async (id: string) => {
    if (!confirm('예약을 취소하시겠습니까?')) return;
    try { await api.rooms.cancel(id); await load(); }
    catch (err: any) { alert(err.message); }
  };

  // ━━━━━━━━━ Screen 1: Branch Selection ━━━━━━━━━
  if (!branch) {
    return (
      <div className="page rr-page">
        <div className="page-header">
          <h2><DoorOpen size={24} style={{ marginRight: 8, verticalAlign: 'middle' }} /> 회의실 예약</h2>
        </div>
        <div className="rr-hero">
          <Sparkles size={13} style={{ marginRight: 6, color: '#64748b' }} />
          지사를 선택해 회의실을 예약하세요 · 2주치 일정 실시간 동기화
        </div>
        <div className="rr-branch-grid">
          {Object.keys(ROOM_CONFIG).map(b => {
            const meta = BRANCH_META[b];
            const rooms = ROOM_CONFIG[b];
            return (
              <button key={b} className="rr-branch-tile" style={{ background: meta.gradient, ['--tile-accent' as any]: meta.accent, ['--tile-glow' as any]: meta.glow }} onClick={() => setBranch(b)}>
                <div className="rr-branch-tile-accent" />
                <div className="rr-branch-tile-overlay" />
                <div className="rr-branch-tile-content">
                  <div className="rr-branch-tile-top">
                    <div className="rr-branch-tile-icon-box">
                      <Building2 size={26} strokeWidth={1.6} />
                    </div>
                    <div className="rr-branch-tile-code">{meta.code}</div>
                  </div>
                  <div className="rr-branch-tile-name">{b}</div>
                  <div className="rr-branch-tile-sub">
                    <MapPin size={10} strokeWidth={2} style={{ marginRight: 4, opacity: 0.8 }} />
                    {meta.subtitle}
                  </div>
                  <div className="rr-branch-tile-rooms">
                    {rooms.map(r => <span key={r} className="rr-branch-tile-chip">{r}</span>)}
                  </div>
                </div>
                <div className="rr-branch-tile-arrow" aria-hidden>
                  <ArrowUpRight size={18} strokeWidth={2} />
                </div>
              </button>
            );
          })}
        </div>
      </div>
    );
  }

  // ━━━━━━━━━ Screen 2: Branch Detail ━━━━━━━━━
  const meta = BRANCH_META[branch];
  return (
    <div className="page rr-page">
      <div className="page-header" style={{ flexWrap: 'wrap', gap: 10 }}>
        <button className="rr-back-btn" onClick={() => { setBranch(''); setRoom(''); setReservations([]); }}>
          <ChevronLeft size={18} /> 지사 선택
        </button>
        <h2 style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ background: meta.accent, color: '#fff', padding: '4px 12px', borderRadius: 10, fontSize: '0.92rem', fontWeight: 700, boxShadow: `0 4px 12px ${meta.glow}` }}>
            <MapPin size={14} style={{ marginRight: 4, verticalAlign: 'middle' }} />
            {branch}
          </span>
          <span style={{ fontSize: '0.82rem', color: '#5f6368', fontWeight: 400 }}>{meta.subtitle}</span>
        </h2>
      </div>

      {/* 현재 일정 / 과거 예약 탭 */}
      <div className="rr-main-tabs">
        <button className={`rr-main-tab ${tab === 'current' ? 'active' : ''}`}
          style={tab === 'current' ? { color: meta.accent, borderBottomColor: meta.accent } : {}}
          onClick={() => setTab('current')}>
          <Calendar size={14} /> 현재 일정 <span className="rr-main-tab-hint">최근 2주</span>
        </button>
        <button className={`rr-main-tab ${tab === 'history' ? 'active' : ''}`}
          style={tab === 'history' ? { color: meta.accent, borderBottomColor: meta.accent } : {}}
          onClick={() => setTab('history')}>
          <History size={14} /> 과거 예약
        </button>
      </div>

      {/* 회의실 탭 */}
      <div className="rr-room-tabs">
        {rooms.map(r => (
          <button key={r} className={`rr-room-tab ${room === r ? 'active' : ''}`}
            style={room === r ? { background: meta.accent, borderColor: 'transparent', boxShadow: `0 4px 12px ${meta.glow}` } : {}}
            onClick={() => setRoom(r)}>
            <DoorOpen size={14} /> {r}
          </button>
        ))}
      </div>

      {tab === 'current' ? <>
      {/* 날짜 Select */}
      <div className="rr-date-bar">
        <Calendar size={16} color="#5f6368" />
        <span className="rr-date-label">날짜</span>
        <select className="form-input rr-date-select" value={date} onChange={(e) => setDate(e.target.value)}>
          {dateOptions.map(d => {
            const v = fmtDate(d);
            const today = fmtDate(new Date());
            return (
              <option key={v} value={v}>
                {v.slice(5)} ({weekdayKo(d)}){v === today ? ' · 오늘' : ''}
              </option>
            );
          })}
        </select>
      </div>

      <div className="rr-main-grid">
        {/* 타임라인 */}
        <section className="rr-timeline-card">
          <div className="rr-timeline-head">
            <Clock size={16} color={meta.accent} />
            <h4>타임라인 <span style={{ color: '#9aa0a6', fontWeight: 400, fontSize: '0.78rem' }}>09:00 ~ 18:00 · 30분 단위 · 슬롯 클릭으로 선택</span></h4>
            {(startTime || endTime) && (
              <button className="rr-clear-btn" onClick={clearSelection}>선택 해제</button>
            )}
          </div>
          <div className="rr-timeline">
            {ALL_SLOTS.map(slot => {
              const st = slotState(slot);
              const inSelection = !!(startTime && endTime && slot >= startTime && slot < endTime);
              const isStart = startTime === slot;
              return (
                <button
                  key={slot}
                  type="button"
                  className={`rr-slot ${st.booked ? 'booked' : 'clickable'} ${inSelection ? 'selected' : ''} ${isStart ? 'slot-start' : ''}`}
                  style={inSelection ? { background: meta.accent, color: '#fff', borderColor: meta.accent, boxShadow: `0 4px 12px ${meta.glow}` } : (st.booked ? { background: '#fff1f2', color: '#be123c', borderColor: '#fecdd3' } : {})}
                  disabled={st.booked}
                  onClick={() => handleSlotClick(slot)}
                  title={st.booked ? `${st.res?.title || '예약됨'} (${st.res?.user_name || ''})` : `${slot} 클릭으로 선택`}>
                  <span className="rr-slot-time">{slot}</span>
                  {st.booked && <span className="rr-slot-label">{st.res?.user_name || '예약'}</span>}
                </button>
              );
            })}
          </div>
        </section>

        {/* 예약 폼 */}
        <section className="rr-form-card">
          <div className="rr-form-head" style={{ background: meta.accent }}>
            <Plus size={16} /> 새 예약 만들기
          </div>
          <div className="rr-form-body">
            <div className="rr-form-row">
              <label>시작</label>
              <select className="form-input" value={startTime} onChange={(e) => onStartChange(e.target.value)}>
                <option value="">선택</option>
                {START_SLOTS.map(s => {
                  const booked = slotState(s).booked;
                  return <option key={s} value={s} disabled={booked}>{s}{booked ? ' (예약됨)' : ''}</option>;
                })}
              </select>
            </div>
            <div className="rr-form-row">
              <label>종료</label>
              <select className="form-input" value={endTime} onChange={(e) => setEndTime(e.target.value)} disabled={!startTime}>
                <option value="">선택</option>
                {validEndTimes.map(s => <option key={s} value={s}>{s}</option>)}
              </select>
            </div>
            <div className="rr-form-row">
              <label>제목</label>
              <input className="form-input" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="예: 주간 회의" maxLength={40} />
            </div>
            <div className="rr-form-row">
              <label>메모</label>
              <input className="form-input" value={note} onChange={(e) => setNote(e.target.value)} placeholder="선택 사항" maxLength={80} />
            </div>
            <button className="rr-submit-btn" style={{ background: meta.accent, boxShadow: `0 8px 20px ${meta.glow}` }} onClick={handleReserve}>
              <Sparkles size={14} /> 예약하기
            </button>
          </div>
        </section>
      </div>

      {/* 예약 리스트 (카드) */}
      <section className="rr-list-section">
        <div className="rr-list-head">
          <User size={15} color={meta.accent} />
          <h4>{date} · {room} 예약 내역 <span style={{ color: '#9aa0a6', fontWeight: 400, fontSize: '0.78rem' }}>{reservations.length}건</span></h4>
        </div>
        {loading ? (
          <div className="rr-empty">로딩중...</div>
        ) : reservations.length === 0 ? (
          <div className="rr-empty">이 시간엔 예약이 없습니다. 먼저 예약해 보세요 ✨</div>
        ) : (
          <div className="rr-card-grid">
            {reservations.map(r => {
              const isMine = r.user_id === user?.id;
              return (
                <div key={r.id} className="rr-res-card" style={{ borderLeft: `4px solid ${meta.accent}` }}>
                  <div className="rr-res-time">
                    <Clock size={12} /> {r.start_time} ~ {r.end_time}
                  </div>
                  <div className="rr-res-title">{r.title || '(제목 없음)'}</div>
                  <div className="rr-res-meta">
                    <User size={11} />
                    <span style={{ fontWeight: 600 }}>{r.user_name || '알 수 없음'}</span>
                    {r.user_position && <span style={{ color: '#64748b', marginLeft: 4 }}>{r.user_position}</span>}
                    {(r.user_branch || r.user_department) && (
                      <span style={{ color: '#94a3b8', marginLeft: 6 }}>
                        · {[r.user_branch, r.user_department].filter(Boolean).join(' ')}
                      </span>
                    )}
                  </div>
                  {r.note && <div className="rr-res-note">{r.note}</div>}
                  {isMine && (
                    <button className="rr-res-cancel" onClick={() => handleCancel(r.id)} title="내 예약 취소">
                      <Trash2 size={12} /> 취소
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </section>
      </> : (
        // ━━━━━ 과거 예약 탭 ━━━━━
        <>
          <div className="rr-date-bar">
            <History size={16} color="#5f6368" />
            <span className="rr-date-label">월 선택</span>
            <input type="month" className="form-input rr-date-select" value={historyMonth}
              max={fmtMonth(new Date())}
              onChange={(e) => setHistoryMonth(e.target.value)} />
            <span style={{ marginLeft: 'auto', fontSize: '0.78rem', color: '#5f6368' }}>
              {room} · 총 <strong style={{ color: meta.accent }}>{historyItems.length}</strong>건
            </span>
          </div>
          <section className="rr-list-section">
            {loading ? (
              <div className="rr-empty">로딩중...</div>
            ) : historyItems.length === 0 ? (
              <div className="rr-empty">해당 월에 지나간 예약이 없습니다.</div>
            ) : (
              <div className="rr-history-list">
                {historyItems.map(r => (
                  <div key={r.id} className={`rr-history-row ${r.status === 'cancelled' ? 'cancelled' : ''}`}
                    style={{ borderLeftColor: r.status === 'cancelled' ? '#cbd5e1' : meta.accent }}>
                    <div className="rr-history-date">
                      <Calendar size={12} />
                      <strong>{r.reservation_date.slice(5)}</strong>
                      <span style={{ color: '#94a3b8', fontSize: '0.72rem' }}>({weekdayKo(parseDate(r.reservation_date))})</span>
                    </div>
                    <div className="rr-history-time"><Clock size={12} /> {r.start_time}~{r.end_time}</div>
                    <div className="rr-history-room">{r.room_name}</div>
                    <div className="rr-history-title">{r.title || '(제목 없음)'}</div>
                    <div className="rr-history-user">
                      <User size={11} />
                      <span style={{ fontWeight: 600 }}>{r.user_name || '알 수 없음'}</span>
                      {r.user_position && <span style={{ color: '#64748b', marginLeft: 3 }}>{r.user_position}</span>}
                      {(r.user_branch || r.user_department) && (
                        <span style={{ color: '#94a3b8', marginLeft: 4 }}>
                          · {[r.user_branch, r.user_department].filter(Boolean).join(' ')}
                        </span>
                      )}
                    </div>
                    {r.status === 'cancelled' && <span className="rr-history-cancel-badge">취소됨</span>}
                  </div>
                ))}
              </div>
            )}
          </section>
        </>
      )}
    </div>
  );
}
