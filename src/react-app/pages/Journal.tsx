import { useEffect, useState } from 'react';
import { api } from '../api';
import { useAuthStore } from '../store';
import { ROLE_LABELS } from '../types';
import type { Role } from '../types';
import type { JournalEntry } from '../journal/types';
import { getToday, getTomorrow, isEditable } from '../journal/types';
import JournalCard from '../journal/JournalCard';
import JournalForm from '../journal/JournalForm';
import { Plus, CalendarDays, ChevronLeft, ChevronRight, ChevronDown, ChevronUp, Calendar } from 'lucide-react';
import DatePicker, { registerLocale } from 'react-datepicker';
import 'react-datepicker/dist/react-datepicker.css';
import { ko } from 'date-fns/locale';

const koCustom = {
  ...ko,
  localize: {
    ...ko.localize,
    month: (n: number) => `${n + 1}월`,
  },
};
registerLocale('ko-custom', koCustom as any);

interface Member {
  id: string;
  name: string;
  role: string;
  branch: string;
  department: string;
  position_title?: string;
  login_type?: string;
}

function toDateStr(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export default function Journal() {
  const { user } = useAuthStore();
  const [entries, setEntries] = useState<JournalEntry[]>([]);
  const [members, setMembers] = useState<Member[]>([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<'today' | 'tomorrow' | 'calendar' | 'history'>('today');
  const [showForm, setShowForm] = useState(false);
  const [formDate, setFormDate] = useState(getToday());
  const [activeBranch, setActiveBranch] = useState(0);
  const [calendarOpen, setCalendarOpen] = useState(false);

  // 캘린더 선택 날짜
  const [selectedDate, setSelectedDate] = useState<Date>(() => {
    const t = getToday().split('-').map(Number);
    return new Date(t[0], t[1] - 1, t[2]);
  });
  const selectedDateStr = toDateStr(selectedDate);

  // 전체이력 상태
  const [historyBranch, setHistoryBranch] = useState(0);
  const [historyDept, setHistoryDept] = useState('');
  const [historyMonth, setHistoryMonth] = useState(() => {
    const now = new Date(Date.now() + 9 * 60 * 60 * 1000);
    return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}`;
  });

  const today = getToday();
  const tomorrow = getTomorrow();
  const isCeoPlus = user?.role === 'master' || user?.role === 'ceo' || user?.role === 'cc_ref';

  // 현재 탭에서 보여줄 날짜
  const activeDate = tab === 'today' ? today : tab === 'tomorrow' ? tomorrow : tab === 'calendar' ? selectedDateStr : '';
  const isCalendarTodayOrTomorrow = tab === 'calendar' && (selectedDateStr === today || selectedDateStr === tomorrow);
  const isCalendarFuture = tab === 'calendar' && selectedDateStr > tomorrow;
  const canAddSchedule = tab === 'today' || tab === 'tomorrow' || isCalendarTodayOrTomorrow || isCalendarFuture;

  const load = () => {
    setLoading(true);
    let params: { date?: string; range?: string } = {};
    if (tab === 'today') params = { date: today };
    else if (tab === 'tomorrow') params = { date: tomorrow };
    else if (tab === 'calendar') params = { date: selectedDateStr };
    else params = { range: 'all' };

    Promise.all([api.journal.list(params), api.journal.members()])
      .then(([entryRes, memberRes]) => {
        setEntries(entryRes.entries);
        setMembers(memberRes.members);
      })
      .finally(() => setLoading(false));
  };

  useEffect(() => { load(); }, [tab, selectedDateStr]);

  const handleDelete = async (id: string) => { await api.journal.delete(id); load(); };
  const handleToggleComplete = async (id: string, completed: boolean, failReason?: string) => {
    await api.journal.update(id, { completed: completed ? 1 : 0, fail_reason: failReason || '' });
    load();
  };

  const openForm = (date: string) => { setFormDate(date); setShowForm(true); };

  const branches = [...new Set(members.map((m) => m.branch).filter(Boolean))].filter(b => b !== '본사 관리').sort((a, b) => {
    if (a === '의정부') return -1;
    if (b === '의정부') return 1;
    return a.localeCompare(b);
  });
  if (branches.length === 0 && members.length > 0) branches.push('');

  const currentBranch = isCeoPlus ? branches[activeBranch] : (user?.branch || '');

  const renderBranchView = (branch: string) => {
    const branchMembers = members.filter((m) => (m.branch === branch || (!branch && !m.branch)) && m.login_type !== 'freelancer' && m.role !== 'resigned');
    const departments = [...new Set(branchMembers.map((m) => m.department).filter(Boolean))].sort();
    const noDeptMembers = branchMembers.filter((m) => !m.department);

    return (
      <div className="journal-branch-view" key={branch}>
        {!isCeoPlus && user?.role === 'admin' && (
          <div className="journal-branch-label">{branch} 지사</div>
        )}
        {noDeptMembers.length > 0 && user?.role === 'master' && (
          <div className="journal-dept-section">
            <div className="journal-dept-label">경영진</div>
            <div className="journal-member-grid">
              {noDeptMembers.map((m) => renderMemberCard(m))}
            </div>
          </div>
        )}
        {departments.map((dept) => {
          const deptMembers = branchMembers.filter((m) => m.department === dept);
          return (
            <div key={dept} className="journal-dept-section">
              <div className="journal-dept-label">{dept}</div>
              <div className="journal-member-grid">
                {deptMembers.map((m) => renderMemberCard(m))}
              </div>
            </div>
          );
        })}
      </div>
    );
  };

  const renderMemberCard = (member: Member) => {
    const memberEntries = entries.filter((e) => e.user_id === member.id);
    const hasEntries = memberEntries.length > 0;
    const dateStr = activeDate || (hasEntries ? memberEntries[0].target_date : '');
    const isMine = member.id === user?.id;
    const isReadonly = !isMine && !['master', 'ceo', 'cc_ref'].includes(user?.role || '')
      ? true
      : !isEditable(dateStr, user?.role);

    if (hasEntries) {
      return (
        <JournalCard
          key={member.id}
          entries={memberEntries}
          userName={member.name}
          userRole={member.role}
          positionTitle={member.position_title}
          date={dateStr || memberEntries[0].target_date}
          readonly={isReadonly}
          currentUserRole={user?.role}
          onDelete={handleDelete}
          onToggleComplete={handleToggleComplete}
          onUpdate={load}
        />
      );
    }

    return (
      <div key={member.id} className="journal-card journal-card-empty">
        <div className="journal-card-date">&nbsp;</div>
        <div className="journal-card-name">
          {member.name}
          <span className="journal-card-role">{member.position_title || ROLE_LABELS[member.role as Role] || ''}</span>
        </div>
        <div className="journal-card-empty-label">미입력</div>
      </div>
    );
  };

  // 캘린더에서 날짜 선택 시
  const handleCalendarSelect = (date: Date | null) => {
    if (!date) return;
    setSelectedDate(date);
    setTab('calendar');
    setCalendarOpen(false);
  };

  const dayNames = ['일', '월', '화', '수', '목', '금', '토'];

  return (
    <div className="page">
      <div className="page-header">
        <h2><CalendarDays size={24} style={{ marginRight: 8, verticalAlign: 'middle' }} />컨설턴트 일지</h2>
        {isCeoPlus && branches.length > 1 && tab !== 'history' && (
          <div className="journal-branch-header">
            <button className="journal-slide-btn" onClick={() => setActiveBranch((p) => (p - 1 + branches.length) % branches.length)}>
              <ChevronLeft size={20} />
            </button>
            <h3 className="journal-branch-title">{branches[activeBranch] || '미지정'} 지사</h3>
            <button className="journal-slide-btn" onClick={() => setActiveBranch((p) => (p + 1) % branches.length)}>
              <ChevronRight size={20} />
            </button>
            <span className="journal-branch-indicator">
              {branches.map((_, i) => (
                <span key={i} className={`journal-dot ${i === activeBranch ? 'active' : ''}`} />
              ))}
            </span>
          </div>
        )}
      </div>

      {/* Tabs */}
      <div className="journal-tabs">
        <button className={`journal-tab ${tab === 'today' ? 'active' : ''}`} onClick={() => setTab('today')}>
          <span className="journal-tab-label">오늘</span>
          <span className="journal-tab-date">{today}</span>
        </button>
        <button className={`journal-tab ${tab === 'tomorrow' ? 'active' : ''}`} onClick={() => setTab('tomorrow')}>
          <span className="journal-tab-label">내일</span>
          <span className="journal-tab-date">{tomorrow}</span>
        </button>
        {tab === 'calendar' && (
          <button className={`journal-tab active`}>
            <span className="journal-tab-label">{selectedDateStr}</span>
            <span className="journal-tab-date">({dayNames[selectedDate.getDay()]})</span>
          </button>
        )}
        <button className={`journal-tab ${tab === 'history' ? 'active' : ''}`} onClick={() => setTab('history')}>
          <span className="journal-tab-label">전체 이력</span>
        </button>

        {/* 달력 접기 버튼 */}
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 6, alignItems: 'center', position: 'relative' }}>
          {canAddSchedule && (
            <button className="btn btn-primary btn-sm"
              onClick={() => openForm(activeDate)}>
              <Plus size={16} /> 일정 추가
            </button>
          )}
          <button className="journal-cal-toggle" onClick={() => setCalendarOpen(!calendarOpen)}>
            <Calendar size={14} />
            <span>달력</span>
            {calendarOpen ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
          </button>
          {calendarOpen && (
            <div className="journal-calendar-dropdown">
              <DatePicker
                selected={selectedDate}
                onChange={handleCalendarSelect}
                inline
                locale="ko-custom"
                dateFormat="yyyy-MM-dd"
              />
            </div>
          )}
        </div>
      </div>

      {/* 캘린더 탭 날짜 힌트 */}
      {tab === 'calendar' && !isCalendarTodayOrTomorrow && !isCalendarFuture && (
        <div className="journal-cal-hint past" style={{ marginBottom: 12 }}>과거 일지 열람 — 낙찰가만 수정 가능</div>
      )}

      {loading ? (
        <div className="page-loading">로딩중...</div>
      ) : tab === 'history' ? (
        <div className="journal-history">
          {isCeoPlus && branches.length > 1 && (
            <div className="journal-branch-header" style={{ marginBottom: 12 }}>
              <button className="journal-slide-btn" onClick={() => setHistoryBranch((p) => (p - 1 + branches.length) % branches.length)}>
                <ChevronLeft size={20} />
              </button>
              <h3 className="journal-branch-title">{branches[historyBranch] || '미지정'} 지사</h3>
              <button className="journal-slide-btn" onClick={() => setHistoryBranch((p) => (p + 1) % branches.length)}>
                <ChevronRight size={20} />
              </button>
            </div>
          )}

          <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 12, flexWrap: 'wrap' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <button className="btn btn-sm" onClick={() => {
                const [y, m] = historyMonth.split('-').map(Number);
                const d = new Date(y, m - 2, 1);
                setHistoryMonth(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`);
              }}><ChevronLeft size={16} /></button>
              <span style={{ fontWeight: 700, fontSize: '0.95rem', minWidth: 100, textAlign: 'center' }}>{historyMonth}</span>
              <button className="btn btn-sm" onClick={() => {
                const [y, m] = historyMonth.split('-').map(Number);
                const d = new Date(y, m, 1);
                setHistoryMonth(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`);
              }}><ChevronRight size={16} /></button>
            </div>
            <div style={{ display: 'flex', gap: 4 }}>
              {(() => {
                const hBranch = isCeoPlus && branches.length > 1 ? branches[historyBranch] : (user?.branch || '');
                const depts = [...new Set(members.filter(m => m.branch === hBranch && m.department).map(m => m.department))].sort();
                return (
                  <>
                    <button className={`filter-btn ${historyDept === '' ? 'active' : ''}`} onClick={() => setHistoryDept('')}>전체</button>
                    {depts.map(d => (
                      <button key={d} className={`filter-btn ${historyDept === d ? 'active' : ''}`} onClick={() => setHistoryDept(d)}>{d}</button>
                    ))}
                  </>
                );
              })()}
            </div>
          </div>

          <div style={{ display: 'flex', gap: 12, marginBottom: 12, flexWrap: 'wrap', fontSize: '0.72rem', color: '#5f6368' }}>
            {[['입찰', '#1a73e8'], ['임장', '#188038'], ['미팅', '#e65100'], ['사무', '#7b1fa2'], ['브리핑자료제출', '#0d47a1'], ['개인', '#9aa0a6']].map(([label, color]) => (
              <span key={label} style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                <span style={{ width: 8, height: 8, borderRadius: '50%', background: color, display: 'inline-block' }} />
                {label}
              </span>
            ))}
            <span style={{ display: 'flex', alignItems: 'center', gap: 4, borderLeft: '1px solid #dadce0', paddingLeft: 12 }}>
              <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#188038', display: 'inline-block', border: '1px solid #ccc' }} />
              현장출근
            </span>
            <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
              <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#d93025', display: 'inline-block', border: '1px solid #ccc' }} />
              현장퇴근
            </span>
          </div>

          {(() => {
            const hBranch = isCeoPlus && branches.length > 1 ? branches[historyBranch] : (user?.branch || '');
            const canSeeAll = user?.role === 'master';
            let deptMembers = members.filter(m => m.branch === hBranch && (historyDept === '' || m.department === historyDept) && m.role !== 'resigned');

            const [year, month] = historyMonth.split('-').map(Number);
            const daysInMonth = new Date(year, month, 0).getDate();

            const bizDays: number[] = [];
            for (let d = 1; d <= daysInMonth; d++) {
              const date = new Date(year, month - 1, d);
              const day = date.getDay();
              if (day !== 0 && day !== 6) bizDays.push(d);
            }

            const deptGroups: Record<string, typeof deptMembers> = {};
            deptMembers.forEach(m => {
              const dept = m.department || '경영진';
              if (dept === '경영진' && !canSeeAll) return;
              if (!deptGroups[dept]) deptGroups[dept] = [];
              deptGroups[dept].push(m);
            });

            const roleOrder: Record<string, number> = { master: 1, ceo: 2, cc_ref: 2, admin: 3, manager: 4, member: 5 };
            Object.values(deptGroups).forEach(arr => {
              arr.sort((a, b) => (roleOrder[a.role] || 9) - (roleOrder[b.role] || 9));
            });

            const monthEntries = entries.filter(e => e.target_date.startsWith(historyMonth));
            const dayLabels = ['일', '월', '화', '수', '목', '금', '토'];
            const typeColors: Record<string, string> = { '입찰': '#1a73e8', '임장': '#188038', '미팅': '#e65100', '사무': '#7b1fa2', '브리핑자료제출': '#0d47a1', '개인': '#9aa0a6' };

            return (
              <div style={{ overflowX: 'auto' }}>
                {Object.entries(deptGroups).map(([dept, dMembers]) => (
                  <div key={dept} style={{ marginBottom: 20 }}>
                    <div style={{ fontSize: '0.82rem', fontWeight: 700, color: '#5f6368', marginBottom: 6, padding: '4px 8px', background: '#f1f3f4', borderRadius: 6, display: 'inline-block' }}>{dept}</div>
                    <table className="journal-month-table">
                      <thead>
                        <tr>
                          <th style={{ minWidth: 80, position: 'sticky', left: 0, background: '#fff', zIndex: 2 }}>이름</th>
                          {bizDays.map(d => {
                            const date = new Date(year, month - 1, d);
                            const dayName = dayLabels[date.getDay()];
                            return (
                              <th key={d} style={{ minWidth: 44, textAlign: 'center', fontSize: '0.68rem' }}>
                                <div>{d}</div>
                                <div style={{ color: '#9aa0a6', fontWeight: 400 }}>{dayName}</div>
                              </th>
                            );
                          })}
                        </tr>
                      </thead>
                      <tbody>
                        {dMembers.map(m => (
                          <tr key={m.id} style={m.role === 'manager' ? { background: '#f8faff' } : undefined}>
                            <td style={{ fontWeight: 600, fontSize: '0.75rem', position: 'sticky', left: 0, background: m.role === 'manager' ? '#f8faff' : '#fff', zIndex: 1, whiteSpace: 'nowrap' }}>
                              {m.name}
                              <span style={{ color: '#9aa0a6', fontSize: '0.65rem', marginLeft: 4 }}>{m.position_title || ''}</span>
                            </td>
                            {bizDays.map(d => {
                              const dateStr = `${year}-${String(month).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
                              const dayEntries = monthEntries.filter(e => e.user_id === m.id && e.target_date === dateStr);
                              const count = dayEntries.length;
                              const types = [...new Set(dayEntries.map(e => e.activity_type))];

                              return (
                                <td key={d} className="journal-month-cell" style={{ textAlign: 'center', padding: 2, position: 'relative' }}>
                                  {count > 0 ? (() => {
                                    // 현장출퇴근 여부 확인
                                    const hasCheckIn = dayEntries.some(e => { try { return JSON.parse(e.data).fieldCheckIn; } catch { return false; } });
                                    const hasCheckOut = dayEntries.some(e => { try { return JSON.parse(e.data).fieldCheckOut; } catch { return false; } });
                                    return (
                                    <div className="journal-month-dot-wrap">
                                      <div style={{ display: 'flex', gap: 1, justifyContent: 'center', alignItems: 'center' }}>
                                        {hasCheckIn && <span style={{ width: 5, height: 5, borderRadius: '50%', background: '#188038', display: 'inline-block', border: '1px solid #fff' }} title="현장출근" />}
                                        {types.slice(0, 3).map((t, i) => (
                                          <span key={i} style={{ width: 6, height: 6, borderRadius: '50%', background: typeColors[t] || '#999', display: 'inline-block' }} />
                                        ))}
                                        {hasCheckOut && <span style={{ width: 5, height: 5, borderRadius: '50%', background: '#d93025', display: 'inline-block', border: '1px solid #fff' }} title="현장퇴근" />}
                                      </div>
                                      <span style={{ fontSize: '0.6rem', color: '#5f6368' }}>{count}</span>
                                      <div className="journal-hover-popup">
                                        <div style={{ fontWeight: 600, marginBottom: 4 }}>{m.name} — {dateStr}</div>
                                        {/* 현장출퇴근 표시 */}
                                        {(hasCheckIn || hasCheckOut) && (
                                          <div style={{ display: 'flex', gap: 4, marginBottom: 4 }}>
                                            {hasCheckIn && <span style={{ padding: '1px 6px', borderRadius: 8, fontSize: '0.6rem', fontWeight: 600, background: '#e8f5e9', color: '#188038' }}>현장출근</span>}
                                            {hasCheckOut && <span style={{ padding: '1px 6px', borderRadius: 8, fontSize: '0.6rem', fontWeight: 600, background: '#fce4ec', color: '#d93025' }}>현장퇴근</span>}
                                          </div>
                                        )}
                                        {dayEntries.map(entry => {
                                          const ed = (() => { try { return JSON.parse(entry.data); } catch { return {}; } })();
                                          return (
                                            <div key={entry.id} style={{ padding: '3px 0', borderBottom: '1px solid #f0f0f0', fontSize: '0.7rem' }}>
                                              <span style={{ background: (typeColors[entry.activity_type] || '#999') + '18', color: typeColors[entry.activity_type] || '#999', padding: '1px 6px', borderRadius: 8, fontSize: '0.65rem', fontWeight: 600 }}>{entry.activity_type}</span>
                                              {entry.activity_subtype && <span style={{ marginLeft: 4, color: '#5f6368' }}>{entry.activity_subtype}</span>}
                                              {ed.timeFrom && <span style={{ marginLeft: 4, color: '#9aa0a6' }}>{ed.timeFrom}~{ed.timeTo}</span>}
                                              {(ed.client || ed.bidder) && <div style={{ color: '#333', marginTop: 1 }}>고객: {ed.client || ed.bidder}</div>}
                                              {ed.caseNo && <div style={{ color: '#9aa0a6' }}>사건: {ed.caseNo}</div>}
                                            </div>
                                          );
                                        })}
                                      </div>
                                    </div>);
                                    })()
                                  : (
                                    <span style={{ color: '#e0e0e0', fontSize: '0.65rem' }}>-</span>
                                  )}
                                </td>
                              );
                            })}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ))}
                {Object.keys(deptGroups).length === 0 && <div className="empty-state">해당 조건의 인원이 없습니다.</div>}
              </div>
            );
          })()}
        </div>
      ) : (
        /* Today / Tomorrow / Calendar view */
        isCeoPlus && branches.length > 1 ? (
          renderBranchView(currentBranch)
        ) : (
          branches.map((b) => renderBranchView(b))
        )
      )}

      {showForm && (
        <JournalForm
          targetDate={formDate}
          onCreated={() => { setShowForm(false); load(); }}
          onClose={() => setShowForm(false)}
        />
      )}
    </div>
  );
}
