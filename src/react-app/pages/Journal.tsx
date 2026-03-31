import { useEffect, useState } from 'react';
import { api } from '../api';
import { useAuthStore } from '../store';
import { ROLE_LABELS } from '../types';
import type { Role } from '../types';
import type { JournalEntry } from '../journal/types';
import { getToday, getTomorrow } from '../journal/types';
import JournalCard from '../journal/JournalCard';
import JournalForm from '../journal/JournalForm';
import { Plus, CalendarDays, ChevronLeft, ChevronRight } from 'lucide-react';
import Select from '../components/Select';

interface Member {
  id: string;
  name: string;
  role: string;
  branch: string;
  department: string;
  position_title?: string;
}

export default function Journal() {
  const { user } = useAuthStore();
  const [entries, setEntries] = useState<JournalEntry[]>([]);
  const [members, setMembers] = useState<Member[]>([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<'today' | 'tomorrow' | 'history'>('today');
  const [showForm, setShowForm] = useState(false);
  const [formDate, setFormDate] = useState(getToday());
  const [activeBranch, setActiveBranch] = useState(0);
  const [filterDept, setFilterDept] = useState('');
  const [filterUser, setFilterUser] = useState('');
  const [filterMonth, setFilterMonth] = useState('');

  const today = getToday();
  const tomorrow = getTomorrow();
  const isCeoPlus = user?.role === 'master' || user?.role === 'ceo';

  const load = () => {
    setLoading(true);
    let params: { date?: string; range?: string } = {};
    if (tab === 'today') params = { date: today };
    else if (tab === 'tomorrow') params = { date: tomorrow };
    else params = { range: 'all' };

    Promise.all([api.journal.list(params), api.journal.members()])
      .then(([entryRes, memberRes]) => {
        setEntries(entryRes.entries);
        setMembers(memberRes.members);
      })
      .finally(() => setLoading(false));
  };

  useEffect(() => { load(); }, [tab]);

  const handleDelete = async (id: string) => { await api.journal.delete(id); load(); };
  const handleToggleComplete = async (id: string, completed: boolean, failReason?: string) => {
    await api.journal.update(id, { completed: completed ? 1 : 0, fail_reason: failReason || '' });
    load();
  };

  const openForm = (date: string) => { setFormDate(date); setShowForm(true); };

  // Group members by branch, then department
  const branches = [...new Set(members.map((m) => m.branch).filter(Boolean))].sort();
  if (branches.length === 0 && members.length > 0) branches.push('');

  // For CEO+ slide navigation
  const currentBranch = isCeoPlus ? branches[activeBranch] : (user?.branch || '');

  const renderBranchView = (branch: string) => {
    const branchMembers = members.filter((m) => m.branch === branch || (!branch && !m.branch));
    const departments = [...new Set(branchMembers.map((m) => m.department).filter(Boolean))].sort();

    // Members without department (admin, ceo, etc.)
    const noDeptMembers = branchMembers.filter((m) => !m.department);

    return (
      <div className="journal-branch-view" key={branch}>
        {/* Non-CEO: show branch label */}
        {!isCeoPlus && user?.role === 'admin' && (
          <div className="journal-branch-label">{branch} 지사</div>
        )}

        {/* No department members */}
        {noDeptMembers.length > 0 && (
          <div className="journal-dept-section">
            <div className="journal-dept-label">경영진</div>
            <div className="journal-member-grid">
              {noDeptMembers.map((m) => renderMemberCard(m))}
            </div>
          </div>
        )}

        {/* Department sections */}
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
    const dateStr = tab === 'today' ? today : tab === 'tomorrow' ? tomorrow : '';
    // 오늘/내일 본인 일정만 수정 가능 (어제 이전은 불가)
    const entryDate = dateStr || (hasEntries ? memberEntries[0].target_date : '');
    const isReadonly = entryDate < today || member.id !== user?.id;

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
          onDelete={handleDelete}
          onToggleComplete={handleToggleComplete}
          onUpdate={load}
        />
      );
    }

    // Empty card - 미입력
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

  return (
    <div className="page">
      <div className="page-header">
        <h2><CalendarDays size={24} style={{ marginRight: 8, verticalAlign: 'middle' }} />컨설턴트 일지</h2>
        {isCeoPlus && branches.length > 1 && (
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
        <button className={`journal-tab ${tab === 'history' ? 'active' : ''}`} onClick={() => setTab('history')}>
          <span className="journal-tab-label">전체 이력</span>
        </button>
        {tab !== 'history' && (
          <button className="btn btn-primary btn-sm" style={{ marginLeft: 'auto' }}
            onClick={() => openForm(tab === 'today' ? today : tomorrow)}>
            <Plus size={16} /> 일정 추가
          </button>
        )}
      </div>

      {loading ? (
        <div className="page-loading">로딩중...</div>
      ) : tab === 'history' ? (
        <div className="journal-history">
          {/* Filters */}
          <div className="journal-history-filters">
            <div className="form-group" style={{ marginBottom: 0, minWidth: 140 }}>
              <Select
                options={[...new Set(entries.map((e) => e.target_date.slice(0, 7)))].sort((a, b) => b.localeCompare(a)).map((m) => ({ value: m, label: m }))}
                value={filterMonth ? { value: filterMonth, label: filterMonth } : null}
                onChange={(o: any) => setFilterMonth(o?.value || '')}
                placeholder="전체 기간"
                isClearable
              />
            </div>
            <div className="form-group" style={{ marginBottom: 0, minWidth: 150 }}>
              <Select
                options={[...new Set(members.map((m) => m.department).filter(Boolean))].sort().map(d => ({ value: d, label: d }))}
                value={filterDept ? { value: filterDept, label: filterDept } : null}
                onChange={(o: any) => { setFilterDept(o?.value || ''); setFilterUser(''); }}
                placeholder="전체 팀"
                isClearable
              />
            </div>
            <div className="form-group" style={{ marginBottom: 0, minWidth: 150 }}>
              <Select
                options={members
                  .filter((m) => !filterDept || m.department === filterDept)
                  .map((m) => ({ value: m.id, label: `${m.name} (${ROLE_LABELS[m.role as Role] || ''})` }))}
                value={filterUser ? { value: filterUser, label: `${members.find(m => m.id === filterUser)?.name || ''}` } : null}
                onChange={(o: any) => setFilterUser(o?.value || '')}
                placeholder="전체 컨설턴트"
                isClearable
                isSearchable
              />
            </div>
          </div>

          {(() => {
            let filtered = entries;
            if (filterMonth) filtered = filtered.filter((e) => e.target_date.startsWith(filterMonth));
            if (filterDept) filtered = filtered.filter((e) => e.department === filterDept);
            if (filterUser) filtered = filtered.filter((e) => e.user_id === filterUser);

            const dateGroups = filtered.reduce<Record<string, JournalEntry[]>>((acc, e) => {
              if (!acc[e.target_date]) acc[e.target_date] = [];
              acc[e.target_date].push(e);
              return acc;
            }, {});

            const dates = Object.keys(dateGroups).sort((a, b) => b.localeCompare(a));
            if (dates.length === 0) return <div className="empty-state">기록된 일지가 없습니다.</div>;

            return dates.map((date) => {
              const dayEntries = dateGroups[date];
              const userGroups = dayEntries.reduce<Record<string, JournalEntry[]>>((acc, e) => {
                if (!acc[e.user_id]) acc[e.user_id] = [];
                acc[e.user_id].push(e);
                return acc;
              }, {});

              return (
                <div key={date} className="journal-date-group">
                  <div className="journal-date-label">{date} {date === today ? '(오늘)' : date === tomorrow ? '(내일)' : ''}</div>
                  <div className="journal-member-grid">
                    {Object.values(userGroups).map((ue) => (
                      <JournalCard
                        key={ue[0].user_id + date}
                        entries={ue}
                        userName={ue[0].user_name || ''}
                        userRole={ue[0].user_role}
                        date={date}
                        readonly={date < today}
                        onDelete={handleDelete}
                        onToggleComplete={handleToggleComplete}
          onUpdate={load}
                      />
                    ))}
                  </div>
                </div>
              );
            });
          })()}
        </div>
      ) : (
        /* Today / Tomorrow view - all members */
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
