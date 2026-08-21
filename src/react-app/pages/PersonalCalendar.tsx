import { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, CalendarDays, ChevronLeft, ChevronRight, X, ZoomIn, ZoomOut } from 'lucide-react';
import { Link, useSearchParams } from 'react-router-dom';
import { api } from '../api';
import type { PersonalCalendarEvent } from '../api';
import { useAuthStore } from '../store';
import { canViewAuctionStoryAnomalies } from '../../shared/auction-story-anomaly-access';

const WEEKDAYS = ['일', '월', '화', '수', '목', '금', '토'];

function dateKey(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function startOfCalendarGrid(month: Date): Date {
  const first = new Date(month.getFullYear(), month.getMonth(), 1);
  first.setDate(first.getDate() - first.getDay());
  return first;
}

function addDays(date: Date, amount: number): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() + amount);
}

function formatCalendarDate(value: string): string {
  const [year, month, day] = value.split('-').map(Number);
  const date = new Date(year, month - 1, day);
  return `${year}년 ${month}월 ${day}일 ${WEEKDAYS[date.getDay()]}요일`;
}

const BID_RESULT_LABELS: Record<NonNullable<PersonalCalendarEvent['bid_result']>, string> = {
  pending: '대기',
  won: '낙찰',
  failed: '실패',
  cancelled: '취소',
  withdrawn: '취하/변경',
};

export default function PersonalCalendar() {
  const { user } = useAuthStore();
  const [searchParams] = useSearchParams();
  const focusDate = searchParams.get('date') || '';
  const focusEventId = searchParams.get('event') || '';
  const validFocusDate = /^\d{4}-\d{2}-\d{2}$/.test(focusDate) ? focusDate : '';
  const canViewAnomalies = !!user && canViewAuctionStoryAnomalies(user);
  const today = useMemo(() => new Date(), []);
  const todayKey = dateKey(today);
  const [visibleMonth, setVisibleMonth] = useState(() => {
    if (validFocusDate) {
      const [year, month] = validFocusDate.split('-').map(Number);
      return new Date(year, month - 1, 1);
    }
    return new Date(today.getFullYear(), today.getMonth(), 1);
  });
  const [events, setEvents] = useState<PersonalCalendarEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [selectedEvent, setSelectedEvent] = useState<PersonalCalendarEvent | null>(null);
  const [viewMode, setViewMode] = useState<'bid' | 'all'>('bid');
  const [calendarZoom, setCalendarZoom] = useState(1);

  const calendarDays = useMemo(() => {
    const start = startOfCalendarGrid(visibleMonth);
    return Array.from({ length: 42 }, (_, index) => addDays(start, index));
  }, [visibleMonth]);

  const rangeStart = dateKey(calendarDays[0]);
  const rangeEnd = dateKey(calendarDays[calendarDays.length - 1]);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError('');
    api.personalCalendar.list(rangeStart, rangeEnd)
      .then((result) => {
        if (active) setEvents(result.events || []);
      })
      .catch((err: Error) => {
        if (active) setError(err.message || '캘린더를 불러오지 못했습니다.');
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => { active = false; };
  }, [rangeStart, rangeEnd]);

  useEffect(() => {
    if (!focusEventId || events.length === 0) return;
    const focusedEvent = events.find(event => event.id === focusEventId);
    if (focusedEvent) setSelectedEvent(focusedEvent);
  }, [events, focusEventId]);

  const visibleEvents = useMemo(() => (
    viewMode === 'all' ? events : events.filter(event => event.source_type === 'auction_bid')
  ), [events, viewMode]);

  const eventsByDate = useMemo(() => {
    const grouped = new Map<string, PersonalCalendarEvent[]>();
    for (const event of visibleEvents) {
      const start = event.event_date;
      const end = event.end_date || start;
      for (const day of calendarDays) {
        const key = dateKey(day);
        if (key >= start && key <= end) {
          grouped.set(key, [...(grouped.get(key) || []), event]);
        }
      }
    }
    return grouped;
  }, [calendarDays, visibleEvents]);

  const moveMonth = (amount: number) => {
    const next = new Date(visibleMonth.getFullYear(), visibleMonth.getMonth() + amount, 1);
    setVisibleMonth(next);
  };

  const moveToday = () => {
    setVisibleMonth(new Date(today.getFullYear(), today.getMonth(), 1));
  };

  const changeCalendarZoom = (amount: number) => {
    setCalendarZoom(current => Math.min(1.4, Math.max(0.8, Number((current + amount).toFixed(1)))));
  };

  return (
    <div className="page personal-calendar-page">
      <div className="page-header personal-calendar-page-header">
        <div>
          <h2><CalendarDays size={23} /> 캘린더</h2>
        </div>
        <div className="personal-calendar-header-actions">
          {canViewAnomalies && (
            <Link className="personal-calendar-anomaly-link" to="/personal-calendar/anomalies">
              <AlertTriangle size={16} /> 관리자 페이지
            </Link>
          )}
          <div className="personal-calendar-view-slider" role="group" aria-label="캘린더 일정 표시 범위">
            <button type="button" className={viewMode === 'bid' ? 'active' : ''} onClick={() => setViewMode('bid')}>입찰</button>
            <button type="button" className={viewMode === 'all' ? 'active' : ''} onClick={() => setViewMode('all')}>
              전체보기 <small>임장 포함</small>
            </button>
          </div>
        </div>
      </div>

      <div className="personal-calendar-shell">
        <section className="personal-calendar-card" aria-label="월간 캘린더">
          <header className="personal-calendar-toolbar">
            <button type="button" className="calendar-icon-button" onClick={() => moveMonth(-1)} aria-label="이전 달">
              <ChevronLeft size={20} />
            </button>
            <div className="personal-calendar-month-title" aria-live="polite">
              <strong>{visibleMonth.getFullYear()}년 {visibleMonth.getMonth() + 1}월</strong>
              {loading && <span>불러오는 중...</span>}
            </div>
            <button type="button" className="calendar-icon-button" onClick={() => moveMonth(1)} aria-label="다음 달">
              <ChevronRight size={20} />
            </button>
            <button type="button" className="calendar-today-button" onClick={moveToday}>오늘</button>
            <div className="personal-calendar-zoom-controls" role="group" aria-label="캘린더 크기 조절">
              <button type="button" onClick={() => changeCalendarZoom(-0.2)} disabled={calendarZoom <= 0.8} aria-label="캘린더 축소"><ZoomOut size={17} /></button>
              <output aria-live="polite">{Math.round(calendarZoom * 100)}%</output>
              <button type="button" onClick={() => changeCalendarZoom(0.2)} disabled={calendarZoom >= 1.4} aria-label="캘린더 확대"><ZoomIn size={17} /></button>
            </div>
          </header>

          {error && <div className="personal-calendar-error">{error}</div>}

          <div className="personal-calendar-grid-scroll" tabIndex={0} aria-label="월간 캘린더, 좌우로 이동할 수 있습니다">
            <div
              className="personal-calendar-grid-canvas"
              style={{ width: `${calendarZoom * 100}%`, minWidth: `${Math.round(700 * calendarZoom)}px` }}
            >
              <div className="personal-calendar-weekdays" aria-hidden="true">
                {WEEKDAYS.map((weekday, index) => (
                  <span key={weekday} className={index === 0 ? 'sunday' : index === 6 ? 'saturday' : ''}>{weekday}</span>
                ))}
              </div>

              <div className="personal-calendar-grid">
            {calendarDays.map((day) => {
              const key = dateKey(day);
              const dayEvents = eventsByDate.get(key) || [];
              const isOutside = day.getMonth() !== visibleMonth.getMonth();
              const isToday = key === todayKey;
              const dayOfWeek = day.getDay();
              return (
                <div
                  key={key}
                  className={`personal-calendar-day${isOutside ? ' outside' : ''}${isToday ? ' today' : ''}`}
                  role="gridcell"
                  aria-label={`${formatCalendarDate(key)}${dayEvents.length ? `, 일정 ${dayEvents.length}개` : ''}`}
                >
                  <span className={`personal-calendar-day-number${dayOfWeek === 0 ? ' sunday' : dayOfWeek === 6 ? ' saturday' : ''}`}>
                    {day.getDate()}
                  </span>
                  <span className="personal-calendar-day-events">
                    {dayEvents.map((event) => (
                      <button
                        type="button"
                        className={`personal-calendar-event-chip${event.source_type?.startsWith('auction_') ? ' auction' : ''}${event.source_type === 'auction_inspection' ? ' inspection' : ''}`}
                        style={{ '--event-color': event.color } as React.CSSProperties}
                        key={event.id}
                        onClick={() => setSelectedEvent(event)}
                        aria-label={`${event.title || '일정'} 상세 보기`}
                      >
                        <span className="personal-calendar-event-title">{event.title || '일정'}</span>
                        {event.source_type === 'auction_bid' && event.bid_result && event.bid_result !== 'pending' && (
                          <span className={`personal-calendar-event-result ${event.bid_result}`}>
                            {BID_RESULT_LABELS[event.bid_result]}
                          </span>
                        )}
                      </button>
                    ))}
                  </span>
                </div>
              );
            })}
              </div>
            </div>
          </div>
        </section>
      </div>

      {selectedEvent && (
        <div className="modal-overlay" onClick={() => setSelectedEvent(null)}>
          <section className="personal-calendar-event-detail" onClick={event => event.stopPropagation()}>
            <header>
              <div>
                <h3>{selectedEvent.source_type === 'auction_bid' ? '입찰 일정' : selectedEvent.source_type === 'auction_inspection' ? '임장 일정' : selectedEvent.title || '일정'}</h3>
                <span>{formatCalendarDate(selectedEvent.event_date)}</span>
              </div>
              <button type="button" className="btn-close" onClick={() => setSelectedEvent(null)} aria-label="상세 닫기"><X size={18} /></button>
            </header>
            {selectedEvent.source_type === 'auction_bid' ? (
                <div className="personal-calendar-event-detail-grid">
                  <div><span>담당자</span><strong>{selectedEvent.assignee_name || '-'}</strong></div>
                  <div><span>구분</span><strong>입찰</strong></div>
                  <div><span>고객명</span><strong>{selectedEvent.client_name || '-'}</strong></div>
                  <div><span>관련법원 · 지원</span><strong>{selectedEvent.court || '-'}</strong></div>
                  <div><span>사건번호</span><strong>{selectedEvent.case_no || '-'}{selectedEvent.item_no ? ` · 물건번호 ${selectedEvent.item_no}` : ''}</strong></div>
                  <div><span>입찰결과</span><strong className={`bid-result ${selectedEvent.bid_result || 'pending'}`}>
                    {BID_RESULT_LABELS[selectedEvent.bid_result || 'pending']}
                  </strong></div>
                </div>
            ) : selectedEvent.source_type === 'auction_inspection' ? (
              <div className="personal-calendar-event-detail-grid">
                <div><span>담당자</span><strong>{selectedEvent.assignee_name || '-'}</strong></div>
                <div><span>구분</span><strong>임장</strong></div>
                <div><span>고객명</span><strong>{selectedEvent.client_name || '-'}</strong></div>
                <div><span>관련법원 · 지원</span><strong>{selectedEvent.court || '-'}</strong></div>
                <div><span>사건번호</span><strong>{selectedEvent.case_no || '-'}{selectedEvent.item_no ? ` · 물건번호 ${selectedEvent.item_no}` : ''}</strong></div>
              </div>
            ) : (
              <div className="personal-calendar-personal-detail">{selectedEvent.content || '등록된 상세 내용이 없습니다.'}</div>
            )}
          </section>
        </div>
      )}
    </div>
  );
}
