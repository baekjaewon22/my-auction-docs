import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Calendar, ChevronDown, ChevronLeft, ChevronRight, ChevronUp, Plus, Trash2, Trophy, X } from 'lucide-react';
import DatePicker, { registerLocale } from 'react-datepicker';
import 'react-datepicker/dist/react-datepicker.css';
import { ko } from 'date-fns/locale';
import { api } from '../api';
import { useAuthStore } from '../store';
import JournalForm from '../journal/JournalForm';
import { ACTIVITY_COLORS, type ActivityType } from '../journal/types';
import { ROLE_LABELS, type Role } from '../types';
import { getKoreanWeekLabel, type AuctionScheduleActivityType } from '../../shared/auction-schedule';
import AuctionBidResultEditor from '../components/AuctionBidResultEditor';
import { useSearchParams } from 'react-router-dom';
import { AUCTION_SCHEDULE_BRANCH_OPTIONS, canSelectAuctionScheduleBranch, defaultAuctionScheduleBranch } from '../../shared/auction-schedule-branch';

registerLocale('ko-auction-schedule', ko);

interface ScheduleEntry {
  id: string;
  user_id: string;
  user_name: string;
  user_role: string;
  position_title?: string;
  target_date: string;
  activity_type: AuctionScheduleActivityType;
  activity_subtype: string;
  data: string;
  branch: string;
  department: string;
  source_type?: 'auction_schedule' | 'employee_journal';
  read_only?: number;
}

function addDays(date: Date, amount: number): Date {
  const next = new Date(date);
  next.setDate(next.getDate() + amount);
  return next;
}

function mondayOf(date: Date): Date {
  const result = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const day = result.getDay();
  result.setDate(result.getDate() - (day === 0 ? 6 : day - 1));
  return result;
}

function dateKey(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function parseData(entry: ScheduleEntry): Record<string, unknown> {
  try {
    const parsed = JSON.parse(entry.data);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function scheduleLocation(entry: ScheduleEntry): string {
  const data = parseData(entry);
  if (entry.activity_type === '입찰') return String(data.court || '');
  if (entry.activity_type === '임장') return String(data.place || data.court || '');
  return String(data.place || (data.internalMeeting ? '사내' : ''));
}

function schedulePosition(entry: ScheduleEntry): string {
  return String(entry.position_title || '').trim()
    || ROLE_LABELS[entry.user_role as Role]
    || '';
}

const DETAIL_LABELS: Array<[string, string]> = [
  ['caseNo', '사건번호'], ['itemNo', '물건번호'], ['court', '법원'], ['place', '장소'],
  ['client', '계약자명'], ['bidder', '입찰자명'], ['propertyType', '물건종류'],
  ['meetingType', '미팅 유형'], ['suggestedPrice', '제시 입찰가'], ['bidPrice', '입찰가'],
  ['memo', '메모'], ['inspEtcReason', '대상/사유'],
];

export default function AuctionSchedule() {
  const { user } = useAuthStore();
  const [searchParams] = useSearchParams();
  const focusDate = searchParams.get('date') || '';
  const focusScheduleId = searchParams.get('schedule') || '';
  const [weekStart, setWeekStart] = useState(() => {
    const match = focusDate.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    return match
      ? mondayOf(new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3])))
      : mondayOf(new Date());
  });
  const [entries, setEntries] = useState<ScheduleEntry[]>([]);
  const [selectedBranch, setSelectedBranch] = useState(() => defaultAuctionScheduleBranch(user));
  const [loading, setLoading] = useState(true);
  const [formDate, setFormDate] = useState<string | null>(null);
  const [selected, setSelected] = useState<ScheduleEntry | null>(null);
  const [priceEditorEntry, setPriceEditorEntry] = useState<ScheduleEntry | null>(null);
  const [processingResult, setProcessingResult] = useState(false);
  const [calendarOpen, setCalendarOpen] = useState(false);
  const [createAssignees, setCreateAssignees] = useState<Array<{
    id: string; name: string; role: string; branch: string; department: string; position_title?: string;
  }>>([]);
  const focusHandled = useRef(false);

  const weekdays = useMemo(() => Array.from({ length: 5 }, (_, index) => addDays(weekStart, index)), [weekStart]);
  const start = dateKey(weekdays[0]);
  const end = dateKey(weekdays[4]);
  const canCreate = user?.role === 'master' || (user as any)?.login_type === 'freelancer';
  const canChooseCreateAssignee = user?.role === 'master';
  const canSelectBranch = canSelectAuctionScheduleBranch(user);
  const todayKey = dateKey(new Date());
  const defaultCreateDate = todayKey >= start && todayKey <= end ? todayKey : start;

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const result = await api.auctionSchedule.list({ start, end, branch: selectedBranch });
      const nextEntries = result.entries as ScheduleEntry[];
      setEntries(nextEntries);
      if (!focusHandled.current && focusScheduleId) {
        const target = nextEntries.find((entry) => entry.id === focusScheduleId);
        if (target) {
          setSelected(target);
          focusHandled.current = true;
        }
      }
      return nextEntries;
    } catch (error: any) {
      alert(error.message || '경매 스케줄을 불러오지 못했습니다.');
    } finally {
      setLoading(false);
    }
  }, [start, end, focusScheduleId, selectedBranch]);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    if (!canChooseCreateAssignee) return;
    api.auctionSchedule.createOptions()
      .then(result => setCreateAssignees(result.assignees || []))
      .catch(error => alert(error instanceof Error ? error.message : '담당자 목록을 불러오지 못했습니다.'));
  }, [canChooseCreateAssignee]);

  const remove = async (entry: ScheduleEntry) => {
    if (!confirm(`${entry.user_name}님의 ${entry.activity_type} 일정을 삭제할까요?`)) return;
    try {
      await api.auctionSchedule.delete(entry.id);
      setSelected(null);
      await load();
    } catch (error: any) {
      alert(error.message || '일정을 삭제하지 못했습니다.');
    }
  };

  const applySimpleBidResult = async (entry: ScheduleEntry, result: 'withdrawn' | 'pending') => {
    const label = result === 'withdrawn' ? '취하/변경' : '입찰 결과 초기화';
    if (!confirm(`${entry.user_name}님의 입찰을 ${label} 처리할까요?`)) return;
    setProcessingResult(true);
    try {
      await api.auctionSchedule.setBidResult(entry.id, { result });
      setSelected(null);
      await load();
    } catch (error: any) {
      alert(error.message || '입찰 결과를 처리하지 못했습니다.');
    } finally {
      setProcessingResult(false);
    }
  };

  const applyFinalBidResult = async (entry: ScheduleEntry, result: 'won' | 'failed') => {
    const data = parseData(entry);
    const suggestedPrice = Number(String(data.suggestedPrice || '').replace(/[^0-9]/g, '')) || 0;
    const actualBidPrice = Number(String(data.bidPrice || '').replace(/[^0-9]/g, '')) || 0;
    const winningPrice = Number(String(data.winPrice || '').replace(/[^0-9]/g, '')) || 0;
    if (!suggestedPrice || !actualBidPrice || !winningPrice) {
      alert('먼저 입찰가 작성에서 제안입찰가·작성입찰가·최종 낙찰가를 입력해 주세요.');
      setPriceEditorEntry(entry);
      return;
    }
    const label = result === 'won' ? '낙찰' : '실패';
    if (!confirm(`${entry.user_name}님의 입찰을 ${label} 처리할까요?`)) return;
    setProcessingResult(true);
    try {
      const saved = await api.auctionSchedule.setBidResult(entry.id, {
        result,
        suggested_price: suggestedPrice,
        actual_bid_price: actualBidPrice,
        winning_price: winningPrice,
      });
      if (result === 'won') {
        alert(saved.phone_required
          ? '낙찰 업무성과가 입금대기로 등록되었습니다. 고객 전화번호가 비어 있습니다. 대시보드의 고객 전화번호 등록 알림에서 반드시 보완해 주세요.'
          : '낙찰 처리와 업무성과 입금대기 등록이 완료되었습니다.');
      }
      setSelected(null);
      await load();
    } catch (error: any) {
      alert(error.message || '입찰 결과를 처리하지 못했습니다.');
    } finally {
      setProcessingResult(false);
    }
  };

  const selectedData = selected ? parseData(selected) : {};
  const canWriteSelected = Boolean(selected && !selected.read_only && (
    user?.role === 'master'
    || ((user as any)?.login_type === 'freelancer' && selected.user_id === user?.id)
  ));
  const canDeleteSelected = canWriteSelected;

  const handleCalendarSelect = (date: Date | null) => {
    if (!date) return;
    setWeekStart(mondayOf(date));
    setCalendarOpen(false);
  };

  return (
    <div className="auction-schedule-page">
      <div className="auction-schedule-heading">
        <div>
          <h2>경매 스케줄</h2>
        </div>
        <div className="auction-schedule-heading-actions">
          {canSelectBranch && (
            <div className="auction-schedule-branch-filter" role="group" aria-label="경매 스케줄 지사 선택">
              {AUCTION_SCHEDULE_BRANCH_OPTIONS.map(option => (
                <button
                  key={option.value}
                  type="button"
                  className={selectedBranch === option.value ? 'active' : ''}
                  aria-pressed={selectedBranch === option.value}
                  onClick={() => setSelectedBranch(option.value)}
                >
                  {option.label}
                </button>
              ))}
            </div>
          )}
          {canCreate && (
            <button className="btn btn-primary" onClick={() => setFormDate(defaultCreateDate)}>
              <Plus size={16} /> 일정 등록
            </button>
          )}
          <div className="auction-schedule-calendar-wrap">
            <button
              className="journal-cal-toggle"
              aria-expanded={calendarOpen}
              aria-label="날짜를 선택하여 경매 스케줄 이동"
              onClick={() => setCalendarOpen(open => !open)}
            >
              <Calendar size={14} />
              <span>달력</span>
              {calendarOpen ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
            </button>
            {calendarOpen && (
              <div className="journal-calendar-dropdown auction-schedule-calendar-dropdown">
                <DatePicker
                  selected={weekStart}
                  onChange={handleCalendarSelect}
                  inline
                  locale="ko-auction-schedule"
                  dateFormat="yyyy-MM-dd"
                />
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="auction-schedule-toolbar">
        <button className="btn btn-secondary" aria-label="이전 주" onClick={() => setWeekStart(addDays(weekStart, -7))}><ChevronLeft size={18} /></button>
        <button className="auction-schedule-current-week" onClick={() => setWeekStart(mondayOf(new Date()))}>
          <strong>{getKoreanWeekLabel(weekStart)}</strong>
          <span>{start} ~ {end}</span>
        </button>
        <button className="btn btn-secondary" aria-label="다음 주" onClick={() => setWeekStart(addDays(weekStart, 7))}><ChevronRight size={18} /></button>
      </div>

      <div className="auction-schedule-week-scroll">
        <div className="auction-schedule-week-grid">
          {weekdays.map((day, index) => {
            const key = dateKey(day);
            const dayEntries = entries.filter(entry => entry.target_date === key);
            const groupedEntries = dayEntries.reduce<Record<string, ScheduleEntry[]>>((groups, entry) => {
              const groupKey = `${entry.branch || '미지정'}\u0000${entry.department || '미지정'}`;
              (groups[groupKey] ||= []).push(entry);
              return groups;
            }, {});
            return (
              <section className="auction-schedule-day" key={key}>
                <header className="auction-schedule-day-header">
                  <div><strong>{['월', '화', '수', '목', '금'][index]}</strong><span>{day.getDate()}</span></div>
                  {canCreate && <button aria-label={`${key} 일정 등록`} onClick={() => setFormDate(key)}><Plus size={15} /></button>}
                </header>
                <div className="auction-schedule-day-body">
                  {loading ? <div className="auction-schedule-empty">불러오는 중</div> : dayEntries.length === 0 ? (
                    <div className="auction-schedule-empty">일정 없음</div>
                  ) : Object.entries(groupedEntries)
                    .sort(([left], [right]) => left.localeCompare(right, 'ko'))
                    .map(([groupKey, teamEntries]) => {
                      const [branch, department] = groupKey.split('\u0000');
                      return (
                        <div className="auction-schedule-team-group" key={groupKey}>
                          <div className="auction-schedule-team-label">{branch} · {department}</div>
                          {teamEntries.map(entry => {
                            const color = ACTIVITY_COLORS[entry.activity_type as ActivityType];
                            const location = scheduleLocation(entry);
                            const position = schedulePosition(entry);
                            const data = parseData(entry);
                            return (
                              <button
                                key={entry.id}
                                className="auction-schedule-item"
                                style={{ borderColor: color, backgroundColor: `${color}16`, color }}
                                onClick={() => setSelected(entry)}
                              >
                                <span>{entry.user_name}{position ? ` · ${position}` : ''} · {entry.activity_type}{location ? ` (${location})` : ''}</span>
                                <span className="auction-schedule-item-badges">
                                  {entry.read_only ? <em>이전 일지</em> : null}
                                  {data.bidWon ? <em className="won">낙찰</em> : null}
                                  {data.bidCancelled ? <em className="cancelled">취하/변경</em> : null}
                                </span>
                              </button>
                            );
                          })}
                        </div>
                      );
                    })}
                </div>
              </section>
            );
          })}
        </div>
      </div>

      {formDate && (
        <JournalForm
          mode="auction-schedule"
          targetDate={formDate}
          onClose={() => setFormDate(null)}
          onCreated={() => { setFormDate(null); load(); }}
          assignableMembers={createAssignees}
          canChooseAssignee={canChooseCreateAssignee}
          createEntry={payload => api.auctionSchedule.create({
            user_id: payload.user_id,
            target_date: payload.target_date,
            activity_type: payload.activity_type,
            activity_subtype: payload.activity_subtype,
            data: payload.data,
          })}
          checkInspectionDuplicate={api.auctionSchedule.checkCaseNo}
        />
      )}

      {selected && (
        <div className="modal-overlay" onClick={() => setSelected(null)}>
          <div className="auction-schedule-detail" onClick={event => event.stopPropagation()}>
            <div className="auction-schedule-detail-header">
              <div><h3>{selected.user_name}{schedulePosition(selected) ? ` · ${schedulePosition(selected)}` : ''} · {selected.activity_type}</h3><span>{selected.target_date}</span></div>
              <button className="btn-close" onClick={() => setSelected(null)}><X size={18} /></button>
            </div>
            <div className="auction-schedule-detail-grid">
              {selected.read_only ? <div className="auction-schedule-detail-row"><span>기록 출처</span><strong>정규직 시절 컨설턴트 일지</strong></div> : null}
              {selected.activity_type === '입찰' && selectedData.bidWon ? <div className="auction-schedule-detail-row"><span>입찰 결과</span><strong style={{ color: '#188038' }}>낙찰</strong></div> : null}
              {selected.activity_type === '입찰' && selectedData.bidFailed ? <div className="auction-schedule-detail-row"><span>입찰 결과</span><strong style={{ color: '#d93025' }}>실패</strong></div> : null}
              {selected.activity_type === '입찰' && selectedData.bidCancelled ? <div className="auction-schedule-detail-row"><span>입찰 결과</span><strong style={{ color: '#e65100' }}>취하/변경</strong></div> : null}
              {selected.activity_subtype && <div className="auction-schedule-detail-row"><span>구분</span><strong>{selected.activity_subtype}</strong></div>}
              {DETAIL_LABELS.map(([key, label]) => {
                const value = selectedData[key];
                if (value === undefined || value === null || value === '' || typeof value === 'boolean') return null;
                return <div className="auction-schedule-detail-row" key={key}><span>{label}</span><strong>{String(value)}</strong></div>;
              })}
            </div>
            {selected.activity_type === '입찰' && canWriteSelected && (
              <div className="auction-schedule-bid-actions">
                <button
                  type="button"
                  className={`btn btn-sm journal-bid-won-btn ${selectedData.bidWon ? 'active' : ''}`}
                  disabled={processingResult}
                  onClick={() => selectedData.bidWon ? applySimpleBidResult(selected, 'pending') : applyFinalBidResult(selected, 'won')}
                >
                  <Trophy size={13} /> {selectedData.bidWon ? '낙찰 취소' : '낙찰'}
                </button>
                {!selectedData.bidWon && !selectedData.bidCancelled && (
                  <button
                    type="button"
                    className={`btn btn-sm ${selectedData.bidFailed ? 'btn-danger' : ''}`}
                    disabled={processingResult}
                    onClick={() => selectedData.bidFailed ? applySimpleBidResult(selected, 'pending') : applyFinalBidResult(selected, 'failed')}
                  >
                    {selectedData.bidFailed ? '실패 취소' : '실패'}
                  </button>
                )}
                <button
                  type="button"
                  className="btn btn-sm"
                  disabled={processingResult || Boolean(selectedData.bidWon)}
                  onClick={() => applySimpleBidResult(selected, selectedData.bidCancelled ? 'pending' : 'withdrawn')}
                >
                  {selectedData.bidCancelled ? '✓ 취하/변경' : '취하/변경'}
                </button>
              </div>
            )}
            {selected.activity_type === '입찰' && canWriteSelected && !selectedData.bidWon && !selectedData.bidCancelled && (
              <button type="button" className="btn btn-secondary btn-full auction-schedule-write-prices" onClick={() => setPriceEditorEntry(selected)}>
                입찰가 작성
              </button>
            )}
            {canDeleteSelected && <button className="btn btn-danger" onClick={() => remove(selected)}><Trash2 size={15} /> 일정 삭제</button>}
          </div>
        </div>
      )}

      {priceEditorEntry && (
        <div className="modal-overlay">
          <div className="auction-schedule-result-modal" onClick={event => event.stopPropagation()}>
            <AuctionBidResultEditor
              entry={priceEditorEntry}
              priceOnly
              onClose={() => setPriceEditorEntry(null)}
              onSaved={async () => {
                const editingId = priceEditorEntry.id;
                setPriceEditorEntry(null);
                const refreshed = await load();
                setSelected(refreshed?.find((entry) => entry.id === editingId) || null);
              }}
            />
          </div>
        </div>
      )}
    </div>
  );
}
