import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { AlertTriangle, CalendarDays, ChevronLeft, ChevronRight, Pencil, Trash2, X, ZoomIn, ZoomOut } from 'lucide-react';
import { Link, useSearchParams } from 'react-router-dom';
import { api } from '../api';
import type { AuctionBidResultEntry, AuctionBidScheduleSaveResponse, PersonalCalendarEvent } from '../api';
import { useAuthStore } from '../store';
import { canViewAuctionStoryAnomalies } from '../../shared/auction-story-anomaly-access';
import { canManagePersonalCalendar } from '../../shared/personal-calendar-management';
import AuctionBidResultEditor from '../components/AuctionBidResultEditor';
import {
  clampPersonalCalendarZoom,
  getPersonalCalendarCanvasWidth,
  getPersonalCalendarFitZoom,
  getPersonalCalendarScrollForZoom,
  PERSONAL_CALENDAR_BASE_WIDTH,
  PERSONAL_CALENDAR_DESKTOP_MAX_ZOOM,
  PERSONAL_CALENDAR_DESKTOP_MIN_ZOOM,
  PERSONAL_CALENDAR_MOBILE_MAX_ZOOM,
} from '../lib/personal-calendar-zoom';
import {
  buildPersonalCalendarHolidayNames,
  personalCalendarHolidayName,
} from '../lib/personal-calendar-holidays';

const WEEKDAYS = ['일', '월', '화', '수', '목', '금', '토'];
const CALENDAR_TOUCH_QUERY = '(max-width: 600px), (pointer: coarse)';

function supportsCalendarTouchGestures(): boolean {
  return typeof window !== 'undefined' && (
    window.matchMedia(CALENDAR_TOUCH_QUERY).matches
    || window.navigator.maxTouchPoints > 0
  );
}

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

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback;
}

const BID_RESULT_LABELS: Record<NonNullable<PersonalCalendarEvent['bid_result']>, string> = {
  pending: '대기',
  won: '낙찰',
  failed: '실패',
  cancelled: '취소',
  withdrawn: '취하/변경',
};

type CalendarTouchPoint = {
  x: number;
  y: number;
};

type CalendarPanGesture = CalendarTouchPoint & {
  pointerId: number;
  scrollLeft: number;
  active: boolean;
};

type CalendarPinchGesture = {
  distance: number;
  zoom: number;
  anchorX: number;
  scrollLeft: number;
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
  const [holidayNames, setHolidayNames] = useState<Map<string, string>>(new Map());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [selectedEvent, setSelectedEvent] = useState<PersonalCalendarEvent | null>(null);
  const [bidResultEntry, setBidResultEntry] = useState<AuctionBidResultEntry | null>(null);
  const [bidResultEditorMode, setBidResultEditorMode] = useState<'full' | 'price' | null>(null);
  const [bidResultLoading, setBidResultLoading] = useState(false);
  const [bidResultError, setBidResultError] = useState('');
  const [scheduleDeleteLoading, setScheduleDeleteLoading] = useState(false);
  const [scheduleManageError, setScheduleManageError] = useState('');
  const [viewMode, setViewMode] = useState<'bid' | 'all'>('bid');
  const [calendarZoom, setCalendarZoom] = useState(1);
  const [calendarFitMode, setCalendarFitMode] = useState(true);
  const [calendarViewportWidth, setCalendarViewportWidth] = useState(0);
  const [calendarCanvasHeight, setCalendarCanvasHeight] = useState(0);
  const [isTouchCalendar, setIsTouchCalendar] = useState(supportsCalendarTouchGestures);
  const [calendarGestureActive, setCalendarGestureActive] = useState(false);
  const bidResultRequestId = useRef(0);
  const scheduleDeleteInFlight = useRef(false);
  const selectedEventRef = useRef<PersonalCalendarEvent | null>(null);
  const calendarScrollRef = useRef<HTMLDivElement>(null);
  const calendarCanvasRef = useRef<HTMLDivElement>(null);
  const calendarTouchPoints = useRef(new Map<number, CalendarTouchPoint>());
  const calendarPanGesture = useRef<CalendarPanGesture | null>(null);
  const calendarPinchGesture = useRef<CalendarPinchGesture | null>(null);
  const calendarZoomRef = useRef(1);
  const calendarScrollFrame = useRef(0);
  const calendarPinchFrame = useRef(0);
  const pendingCalendarPinch = useRef<{ zoom: number; scrollLeft: number } | null>(null);
  const calendarGestureMoved = useRef(false);
  const suppressCalendarClickUntil = useRef(0);
  const lastCalendarTap = useRef({ time: 0, x: 0 });

  const fitCalendarZoom = isTouchCalendar
    ? getPersonalCalendarFitZoom(calendarViewportWidth)
    : 1;
  const minimumCalendarZoom = isTouchCalendar ? fitCalendarZoom : PERSONAL_CALENDAR_DESKTOP_MIN_ZOOM;
  const maximumCalendarZoom = isTouchCalendar
    ? PERSONAL_CALENDAR_MOBILE_MAX_ZOOM
    : PERSONAL_CALENDAR_DESKTOP_MAX_ZOOM;
  const effectiveCalendarZoom = calendarFitMode
    ? fitCalendarZoom
    : clampPersonalCalendarZoom(calendarZoom, minimumCalendarZoom, maximumCalendarZoom);
  const calendarCanvasWidth = isTouchCalendar
    ? getPersonalCalendarCanvasWidth(calendarViewportWidth, effectiveCalendarZoom)
    : calendarViewportWidth > 0
      ? Math.round(Math.max(PERSONAL_CALENDAR_BASE_WIDTH, calendarViewportWidth) * effectiveCalendarZoom)
      : 0;
  const calendarLogicalWidth = isTouchCalendar
    ? Math.max(PERSONAL_CALENDAR_BASE_WIDTH, calendarViewportWidth || 0)
    : calendarCanvasWidth || PERSONAL_CALENDAR_BASE_WIDTH;
  const calendarRenderScale = isTouchCalendar ? effectiveCalendarZoom : 1;
  const scaledCalendarHeight = calendarCanvasHeight > 0
    ? Math.ceil(calendarCanvasHeight * calendarRenderScale)
    : undefined;

  calendarZoomRef.current = effectiveCalendarZoom;
  selectedEventRef.current = selectedEvent;

  useLayoutEffect(() => {
    const viewport = calendarScrollRef.current;
    if (!viewport) return;

    let resizeFrame = 0;
    const touchQuery = window.matchMedia(CALENDAR_TOUCH_QUERY);
    const commitViewport = () => {
      setCalendarViewportWidth(viewport.clientWidth);
      setIsTouchCalendar(touchQuery.matches || window.navigator.maxTouchPoints > 0);
    };
    const updateViewport = () => {
      window.cancelAnimationFrame(resizeFrame);
      resizeFrame = window.requestAnimationFrame(commitViewport);
    };
    commitViewport();

    const resizeObserver = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(updateViewport);
    resizeObserver?.observe(viewport);
    touchQuery.addEventListener('change', updateViewport);
    window.addEventListener('resize', updateViewport);
    window.addEventListener('orientationchange', updateViewport);

    return () => {
      window.cancelAnimationFrame(resizeFrame);
      window.cancelAnimationFrame(calendarScrollFrame.current);
      window.cancelAnimationFrame(calendarPinchFrame.current);
      resizeObserver?.disconnect();
      touchQuery.removeEventListener('change', updateViewport);
      window.removeEventListener('resize', updateViewport);
      window.removeEventListener('orientationchange', updateViewport);
    };
  }, []);

  useLayoutEffect(() => {
    const canvas = calendarCanvasRef.current;
    if (!canvas) return;
    let measureFrame = 0;
    const commitCanvasHeight = () => {
      setCalendarCanvasHeight(Math.ceil(canvas.offsetHeight));
    };
    const measureCanvas = () => {
      window.cancelAnimationFrame(measureFrame);
      measureFrame = window.requestAnimationFrame(commitCanvasHeight);
    };
    commitCanvasHeight();
    const resizeObserver = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(measureCanvas);
    resizeObserver?.observe(canvas);
    return () => {
      window.cancelAnimationFrame(measureFrame);
      resizeObserver?.disconnect();
    };
  }, []);

  useEffect(() => {
    if (!calendarFitMode) return;
    const viewport = calendarScrollRef.current;
    if (viewport) viewport.scrollLeft = 0;
  }, [calendarFitMode, fitCalendarZoom]);

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
        if (active) {
          setEvents(result.events || []);
          setHolidayNames(buildPersonalCalendarHolidayNames(result.holidays || []));
        }
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

  const scheduleCalendarScroll = (scrollLeft: number) => {
    window.cancelAnimationFrame(calendarScrollFrame.current);
    calendarScrollFrame.current = window.requestAnimationFrame(() => {
      const viewport = calendarScrollRef.current;
      if (viewport) viewport.scrollLeft = scrollLeft;
    });
  };

  const scheduleCalendarPinchZoom = (zoom: number, scrollLeft: number) => {
    pendingCalendarPinch.current = { zoom, scrollLeft };
    calendarZoomRef.current = zoom;
    if (calendarPinchFrame.current) return;
    calendarPinchFrame.current = window.requestAnimationFrame(() => {
      calendarPinchFrame.current = 0;
      const pending = pendingCalendarPinch.current;
      pendingCalendarPinch.current = null;
      if (!pending) return;
      setCalendarFitMode(false);
      setCalendarZoom(pending.zoom);
      // 확대(transform)와 이동(scrollLeft)을 같은 프레임에 명령형으로 즉시 반영해 손가락과 화면을 완전히 동기화한다.
      // (isTouchCalendar에서 calendarRenderScale === calendarZoom 이므로 React 리렌더가 다음 프레임에 동일 scale을
      //  재적용 → 튐 없이 자연스럽게 이어진다. 앵커 드리프트 제거.)
      window.cancelAnimationFrame(calendarScrollFrame.current);
      const canvas = calendarCanvasRef.current;
      const viewport = calendarScrollRef.current;
      if (canvas) canvas.style.transform = `scale(${pending.zoom})`;
      if (viewport) viewport.scrollLeft = pending.scrollLeft;
    });
  };

  const setCalendarZoomAround = (requestedZoom: number, anchorX?: number) => {
    const viewport = calendarScrollRef.current;
    const currentZoom = calendarZoomRef.current;
    const nextZoom = clampPersonalCalendarZoom(requestedZoom, minimumCalendarZoom, maximumCalendarZoom);
    const localAnchor = anchorX ?? ((viewport?.clientWidth || 0) / 2);
    const nextScrollLeft = getPersonalCalendarScrollForZoom(
      viewport?.scrollLeft || 0,
      localAnchor,
      currentZoom,
      nextZoom,
    );

    setCalendarFitMode(false);
    setCalendarZoom(nextZoom);
    calendarZoomRef.current = nextZoom;
    scheduleCalendarScroll(nextScrollLeft);
  };

  const changeCalendarZoom = (amount: number) => {
    setCalendarZoomAround(Number((calendarZoomRef.current + amount).toFixed(2)));
  };

  const fitCalendarToViewport = () => {
    window.cancelAnimationFrame(calendarPinchFrame.current);
    calendarPinchFrame.current = 0;
    pendingCalendarPinch.current = null;
    setCalendarFitMode(true);
    setCalendarZoom(1);
    calendarZoomRef.current = fitCalendarZoom;
    scheduleCalendarScroll(0);
  };

  // 더블탭/더블클릭 줌 토글 목표 배율 (테스트 후 조정). 현재 95%, 화면 최대치 이내로 제한.
  const CALENDAR_DOUBLE_TAP_ZOOM = 0.95;
  const handleCalendarDoubleTapAt = (clientX: number) => {
    const viewport = calendarScrollRef.current;
    if (!viewport) return;
    const rect = viewport.getBoundingClientRect();
    const anchorX = clientX - rect.left;
    const target = clampPersonalCalendarZoom(CALENDAR_DOUBLE_TAP_ZOOM, fitCalendarZoom, maximumCalendarZoom);
    const current = calendarZoomRef.current;
    // 이미 확대 상태(맞춤~목표 중간값 초과)면 줌아웃(맞춤), 아니면 탭 지점 기준으로 줌인.
    if (current > (fitCalendarZoom + target) / 2) {
      fitCalendarToViewport();
    } else {
      setCalendarZoomAround(target, anchorX);
    }
  };

  const startCalendarPinch = (viewport: HTMLDivElement) => {
    const points = [...calendarTouchPoints.current.values()];
    if (points.length < 2) return;
    const [first, second] = points;
    const rect = viewport.getBoundingClientRect();
    const anchorX = ((first.x + second.x) / 2) - rect.left;
    calendarPinchGesture.current = {
      distance: Math.max(1, Math.hypot(second.x - first.x, second.y - first.y)),
      zoom: calendarZoomRef.current,
      anchorX,
      scrollLeft: viewport.scrollLeft,
    };
    calendarPanGesture.current = null;
    calendarGestureMoved.current = true;
    suppressCalendarClickUntil.current = Date.now() + 220;
    setCalendarGestureActive(true);
    for (const pointerId of calendarTouchPoints.current.keys()) {
      try {
        viewport.setPointerCapture(pointerId);
      } catch {
        // A browser can release the first pointer while the second one is landing.
      }
    }
  };

  const handleCalendarPointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!isTouchCalendar || event.pointerType !== 'touch') return;
    if (calendarTouchPoints.current.size >= 2) {
      event.preventDefault();
      return;
    }
    calendarTouchPoints.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (calendarTouchPoints.current.size >= 2) {
      event.preventDefault();
      startCalendarPinch(event.currentTarget);
      return;
    }
    calendarPanGesture.current = {
      pointerId: event.pointerId,
      x: event.clientX,
      y: event.clientY,
      scrollLeft: event.currentTarget.scrollLeft,
      active: false,
    };
  };

  const handleCalendarPointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!isTouchCalendar || event.pointerType !== 'touch' || !calendarTouchPoints.current.has(event.pointerId)) return;
    calendarTouchPoints.current.set(event.pointerId, { x: event.clientX, y: event.clientY });

    if (calendarTouchPoints.current.size >= 2) {
      event.preventDefault();
      if (!calendarPinchGesture.current) startCalendarPinch(event.currentTarget);
      const pinch = calendarPinchGesture.current;
      const points = [...calendarTouchPoints.current.values()];
      if (!pinch || points.length < 2) return;
      const [first, second] = points;
      const distance = Math.max(1, Math.hypot(second.x - first.x, second.y - first.y));
      const midpointX = ((first.x + second.x) / 2) - event.currentTarget.getBoundingClientRect().left;
      const nextZoom = clampPersonalCalendarZoom(
        pinch.zoom * (distance / pinch.distance),
        fitCalendarZoom,
        PERSONAL_CALENDAR_MOBILE_MAX_ZOOM,
      );
      const anchoredScroll = getPersonalCalendarScrollForZoom(
        pinch.scrollLeft,
        pinch.anchorX,
        pinch.zoom,
        nextZoom,
      ) + pinch.anchorX - midpointX;

      scheduleCalendarPinchZoom(nextZoom, Math.max(0, anchoredScroll));
      suppressCalendarClickUntil.current = Date.now() + 220;
      return;
    }

    // 한 손가락 좌우 이동은 브라우저 네이티브 가로 스크롤(touch-action: pan-x pan-y +
    // overflow-x:auto)이 처리한다. JS가 scrollLeft를 직접 조작하면 네이티브 스크롤과
    // 충돌해 오히려 뻑뻑해지므로, 단일 포인터 이동에는 개입하지 않는다.
    // (두 손가락 핀치 줌은 위 분기에서 계속 JS가 처리한다.)
    // 단, 탭 vs 팬(스크롤) 구분을 위해 이동 여부만 기록한다(더블탭 줌 판정용).
    const pan = calendarPanGesture.current;
    if (pan && pan.pointerId === event.pointerId && !pan.active
      && (Math.abs(event.clientX - pan.x) > 10 || Math.abs(event.clientY - pan.y) > 10)) {
      pan.active = true;
    }
  };

  const finishCalendarPointer = (event: React.PointerEvent<HTMLDivElement>) => {
    if (event.pointerType !== 'touch') return;
    const wasTracked = calendarTouchPoints.current.delete(event.pointerId);
    if (!wasTracked) return;
    try {
      if (event.currentTarget.hasPointerCapture(event.pointerId)) {
        event.currentTarget.releasePointerCapture(event.pointerId);
      }
    } catch {
      // Pointer capture may already have been released by the browser.
    }

    if (calendarTouchPoints.current.size === 1 && calendarPinchGesture.current) {
      const remainingPointer = calendarTouchPoints.current.entries().next().value;
      calendarPinchGesture.current = null;
      if (remainingPointer) {
        // 핀치 종료 후 남은 손가락의 포인터 캡처를 반드시 해제한다.
        // 캡처가 남으면 이어지는 한 손가락 이동(네이티브 가로 스크롤)이 iOS 등에서 뻑뻑해진다.
        try {
          if (event.currentTarget.hasPointerCapture(remainingPointer[0])) {
            event.currentTarget.releasePointerCapture(remainingPointer[0]);
          }
        } catch {
          // 이미 브라우저가 해제한 경우 무시
        }
        calendarPanGesture.current = {
          pointerId: remainingPointer[0],
          x: remainingPointer[1].x,
          y: remainingPointer[1].y,
          scrollLeft: event.currentTarget.scrollLeft,
          active: false,
        };
      }
      setCalendarGestureActive(false);
      return;
    }

    if (calendarTouchPoints.current.size === 0) {
      const pan = calendarPanGesture.current;
      // 핀치도 아니고 이동도 없었으면 '탭'으로 간주한다.
      const wasTap = isTouchCalendar && !calendarGestureMoved.current && !!pan && !pan.active;
      const tapX = event.clientX;
      calendarPinchGesture.current = null;
      calendarPanGesture.current = null;
      if (calendarGestureMoved.current) {
        suppressCalendarClickUntil.current = Date.now() + 220;
        calendarGestureMoved.current = false;
      }
      setCalendarGestureActive(false);
      // 모바일 더블탭 → 탭 지점 기준 줌 토글(줌인/줌아웃).
      if (wasTap) {
        const now = Date.now();
        if (now - lastCalendarTap.current.time < 300 && Math.abs(tapX - lastCalendarTap.current.x) < 44) {
          handleCalendarDoubleTapAt(tapX);
          // 두 번째 탭의 클릭이 날짜/일정을 열지 않도록 억제.
          suppressCalendarClickUntil.current = now + 260;
          lastCalendarTap.current = { time: 0, x: 0 };
        } else {
          lastCalendarTap.current = { time: now, x: tapX };
        }
      }
    }
  };

  const handleCalendarClickCapture = (event: React.MouseEvent<HTMLDivElement>) => {
    if (Date.now() >= suppressCalendarClickUntil.current) return;
    event.preventDefault();
    event.stopPropagation();
    suppressCalendarClickUntil.current = 0;
  };

  const closeBidResultEditor = () => {
    bidResultRequestId.current += 1;
    setBidResultEntry(null);
    setBidResultEditorMode(null);
    setBidResultLoading(false);
    setBidResultError('');
  };

  const closeSelectedEvent = () => {
    closeBidResultEditor();
    setScheduleManageError('');
    setSelectedEvent(null);
  };

  const removeSelectedAuctionEvent = async () => {
    if (scheduleDeleteInFlight.current) return;
    const event = selectedEvent;
    const management = event?.management;
    if (
      !event
      || !management
      || management.can_delete !== 1
      || !management.source_id
      || !management.revision
      || (event.source_type !== 'auction_bid' && event.source_type !== 'auction_inspection')
    ) return;

    const fallbackWarning = management.origin_kind === 'inspection_bid_projection'
      ? '원본 임장 일정이 삭제되며, 임장 일정과 여기서 파생된 입찰기일이 함께 사라집니다.'
      : management.origin_kind === 'inspection'
        ? '원본 임장 일정만 삭제됩니다. 단순 파생된 입찰기일 표시는 사라지지만, 이미 별도로 생성되었거나 결과 처리된 입찰은 유지될 수 있습니다.'
        : '같은 사건으로 병합된 입찰 원본이 있으면 함께 삭제됩니다.';
    const warning = management.delete_warning || fallbackWarning;
    if (!window.confirm(`${warning}\n\n이 일정을 삭제할까요? 삭제 후에는 복구할 수 없습니다.`)) return;

    scheduleDeleteInFlight.current = true;
    setScheduleDeleteLoading(true);
    setScheduleManageError('');
    try {
      await api.personalCalendar.deleteAuctionEvent(management.source_id, {
        source_type: event.source_type,
        revision: management.revision,
      });
      const result = await api.personalCalendar.list(rangeStart, rangeEnd);
      setEvents(result.events || []);
      setHolidayNames(buildPersonalCalendarHolidayNames(result.holidays || []));
      if (selectedEventRef.current?.id === event.id) setSelectedEvent(null);
      setError('');
    } catch (err: unknown) {
      const message = errorMessage(err, '일정을 삭제하지 못했습니다.');
      if (selectedEventRef.current?.id === event.id) setScheduleManageError(message);
      else setError(message);
    } finally {
      scheduleDeleteInFlight.current = false;
      setScheduleDeleteLoading(false);
    }
  };

  const openBidResultEditor = async (event: PersonalCalendarEvent, mode: 'full' | 'price') => {
    if (event.source_type !== 'auction_bid' || event.can_edit_bid_result !== 1 || !event.source_id) return;
    const requestId = ++bidResultRequestId.current;
    setBidResultEditorMode(mode);
    setBidResultLoading(true);
    setBidResultError('');
    try {
      const result = await api.auctionSchedule.bidResultEntry(event.source_id);
      if (bidResultRequestId.current !== requestId) return;
      setBidResultEntry(result.entry);
    } catch (err: unknown) {
      if (bidResultRequestId.current !== requestId) return;
      setBidResultError(errorMessage(err, '입찰 결과 입력 정보를 불러오지 못했습니다.'));
    } finally {
      if (bidResultRequestId.current === requestId) setBidResultLoading(false);
    }
  };

  const refreshAfterBidResult = async (saved?: AuctionBidScheduleSaveResponse) => {
    const previous = selectedEvent;
    try {
      const result = await api.personalCalendar.list(rangeStart, rangeEnd);
      const nextEvents = result.events || [];
      const scheduleId = saved?.schedule_id || bidResultEntry?.id || '';
      const refreshed = nextEvents.find(event => (
        event.source_type === 'auction_bid' && event.source_id === scheduleId
      )) || nextEvents.find(event => event.id === previous?.id) || nextEvents.find(event => (
        event.source_type === 'auction_bid'
        && event.event_date === previous?.event_date
        && event.assignee_name === previous?.assignee_name
        && event.case_no === previous?.case_no
        && event.item_no === previous?.item_no
      ));
      setEvents(nextEvents);
      setHolidayNames(buildPersonalCalendarHolidayNames(result.holidays || []));
      setError('');
      setSelectedEvent(refreshed || null);
      setBidResultEntry(null);
      setBidResultEditorMode(null);
      setBidResultError('');
    } catch (err: unknown) {
      setBidResultEntry(null);
      setBidResultEditorMode(null);
      setSelectedEvent(null);
      setError(errorMessage(err, '입찰 결과는 저장되었지만 캘린더를 새로 불러오지 못했습니다.'));
    }
  };

  const selectedManagement = selectedEvent?.management;
  const isCalendarScheduleManager = canManagePersonalCalendar({ role: user?.role });
  const selectedEditUrl = selectedManagement
    ? selectedManagement.edit_url || '/auction-schedule?' + new URLSearchParams({
        date: selectedManagement.source_target_date,
        schedule: selectedManagement.source_id,
      }).toString()
    : '';
  const canEditSelectedSchedule = Boolean(
    isCalendarScheduleManager
    && selectedManagement?.can_edit === 1
    && selectedEditUrl,
  );
  const canDeleteSelectedSchedule = Boolean(
    isCalendarScheduleManager
    && selectedManagement?.can_delete === 1
    && selectedManagement.revision,
  );

  return (
    <div className={`page personal-calendar-page${isTouchCalendar ? ' calendar-touch-enabled' : ''}`}>
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
              <button
                type="button"
                onClick={() => changeCalendarZoom(-0.2)}
                disabled={effectiveCalendarZoom <= minimumCalendarZoom + 0.001}
                aria-label="캘린더 축소"
              >
                <ZoomOut size={17} />
              </button>
              <output aria-live={calendarGestureActive ? 'off' : 'polite'}>{Math.round(effectiveCalendarZoom * 100)}%</output>
              <button
                type="button"
                onClick={() => changeCalendarZoom(0.2)}
                disabled={effectiveCalendarZoom >= maximumCalendarZoom - 0.001}
                aria-label="캘린더 확대"
              >
                <ZoomIn size={17} />
              </button>
              <button
                type="button"
                className="personal-calendar-fit-button"
                onClick={fitCalendarToViewport}
                aria-label="캘린더를 화면 너비에 맞춤"
                aria-pressed={calendarFitMode}
              >
                맞춤
              </button>
            </div>
            <p className="personal-calendar-gesture-hint">두 손가락으로 확대·축소 · 확대 후 한 손가락으로 좌우 이동</p>
          </header>

          {error && <div className="personal-calendar-error">{error}</div>}

          <div
            ref={calendarScrollRef}
            className={`personal-calendar-grid-scroll${calendarGestureActive ? ' gesture-active' : ''}`}
            tabIndex={0}
            aria-label="월간 캘린더, 모바일에서는 두 손가락으로 확대하거나 축소하고 확대 후 좌우로 이동할 수 있습니다"
            onPointerDown={handleCalendarPointerDown}
            onPointerMove={handleCalendarPointerMove}
            onPointerUp={finishCalendarPointer}
            onPointerCancel={finishCalendarPointer}
            onLostPointerCapture={finishCalendarPointer}
            onClickCapture={handleCalendarClickCapture}
            onDoubleClick={(event) => { if (!isTouchCalendar) handleCalendarDoubleTapAt(event.clientX); }}
          >
            <div
              className="personal-calendar-grid-stage"
              style={calendarCanvasWidth > 0
                ? {
                    width: `${calendarCanvasWidth}px`,
                    minWidth: `${calendarCanvasWidth}px`,
                    ...(scaledCalendarHeight ? { height: `${scaledCalendarHeight}px` } : {}),
                  }
                : { width: '100%', minWidth: '100%' }}
            >
              <div
                ref={calendarCanvasRef}
                className="personal-calendar-grid-canvas"
                style={{
                  width: `${calendarLogicalWidth}px`,
                  minWidth: `${calendarLogicalWidth}px`,
                  transform: `scale(${calendarRenderScale})`,
                }}
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
              const holidayName = personalCalendarHolidayName(key, holidayNames);
              const isHoliday = Boolean(holidayName);
              return (
                <div
                  key={key}
                  className={`personal-calendar-day${isOutside ? ' outside' : ''}${isToday ? ' today' : ''}${isHoliday ? ' holiday' : ''}`}
                  role="gridcell"
                  aria-label={`${formatCalendarDate(key)}${holidayName ? `, ${holidayName}` : ''}${dayEvents.length ? `, 일정 ${dayEvents.length}개` : ''}`}
                >
                  <span className="personal-calendar-day-heading">
                    <span className={`personal-calendar-day-number${dayOfWeek === 0 ? ' sunday' : dayOfWeek === 6 ? ' saturday' : ''}${isHoliday ? ' holiday' : ''}`}>
                      {day.getDate()}
                    </span>
                    {holidayName && <span className="personal-calendar-holiday-name">{holidayName}</span>}
                  </span>
                  <span className="personal-calendar-day-events">
                    {dayEvents.map((event) => (
                      <button
                        type="button"
                        className={`personal-calendar-event-chip${event.source_type?.startsWith('auction_') ? ' auction' : ''}${event.source_type === 'auction_inspection' ? ' inspection' : ''}`}
                        style={{ '--event-color': event.color } as React.CSSProperties}
                        key={event.id}
                        onClick={() => {
                          closeBidResultEditor();
                          setScheduleManageError('');
                          setSelectedEvent(event);
                        }}
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
          </div>
        </section>
      </div>

      {selectedEvent && (
        <div className="modal-overlay" onClick={closeSelectedEvent}>
          <section className="personal-calendar-event-detail" onClick={event => event.stopPropagation()}>
            <header>
              <div>
                <h3>{selectedEvent.source_type === 'auction_bid' ? '입찰 일정' : selectedEvent.source_type === 'auction_inspection' ? '임장 일정' : selectedEvent.title || '일정'}</h3>
                <span>{formatCalendarDate(selectedEvent.event_date)}</span>
              </div>
              <button type="button" className="btn-close" onClick={closeSelectedEvent} aria-label="상세 닫기"><X size={18} /></button>
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
            {selectedEvent.source_type === 'auction_bid' && selectedEvent.bid_result_block_reason && (
              <small className="personal-calendar-bid-result-block-reason" role="note">
                {selectedEvent.bid_result_block_reason}
              </small>
            )}
            {selectedEvent.source_type === 'auction_bid' && selectedEvent.can_edit_bid_result === 1 && selectedEvent.source_id && (
              <div className="personal-calendar-bid-result-actions">
                <div>
                  {['pending', 'failed'].includes(selectedEvent.bid_result || 'pending') && (
                    <button
                      type="button"
                      className="btn btn-secondary"
                      disabled={bidResultLoading}
                      onClick={() => openBidResultEditor(selectedEvent, 'price')}
                    >
                      {bidResultLoading && bidResultEditorMode === 'price' ? '불러오는 중...' : '입찰가 작성'}
                    </button>
                  )}
                  <button
                    type="button"
                    className="btn btn-primary"
                    disabled={bidResultLoading}
                    onClick={() => openBidResultEditor(selectedEvent, 'full')}
                  >
                    {bidResultLoading && bidResultEditorMode === 'full' ? '불러오는 중...' : '입찰 결과 입력/수정'}
                  </button>
                </div>
                {bidResultError && <p role="alert">{bidResultError}</p>}
              </div>
            )}
            {isCalendarScheduleManager && selectedManagement && (
              <div className="personal-calendar-manage">
                {(canDeleteSelectedSchedule || selectedManagement.delete_warning) && (
                  <small className="personal-calendar-manage-warning" role="note">
                    <strong>삭제 영향</strong>
                    {selectedManagement.delete_warning || (
                      selectedManagement.origin_kind === 'inspection_bid_projection'
                        ? '원본 임장 일정이 삭제되며, 임장 일정과 여기서 파생된 입찰기일이 함께 사라집니다.'
                        : selectedManagement.origin_kind === 'inspection'
                          ? '원본 임장 일정만 삭제됩니다. 단순 파생된 입찰기일 표시는 사라지지만, 이미 별도로 생성되었거나 결과 처리된 입찰은 유지될 수 있습니다.'
                          : '같은 사건으로 병합된 입찰 원본이 있으면 함께 삭제됩니다.'
                    )}
                  </small>
                )}
                {selectedManagement.block_reason && (
                  <small className="personal-calendar-manage-block-reason" role="note">
                    {selectedManagement.block_reason}
                  </small>
                )}
                {(canEditSelectedSchedule || canDeleteSelectedSchedule) && (
                  <div className="personal-calendar-manage-actions">
                    {canEditSelectedSchedule && (
                      <Link className="btn btn-secondary" to={selectedEditUrl} onClick={closeSelectedEvent}>
                        <Pencil size={15} /> 원본 일정 수정
                      </Link>
                    )}
                    {canDeleteSelectedSchedule && (
                      <button
                        type="button"
                        className="btn btn-danger"
                        disabled={scheduleDeleteLoading}
                        onClick={removeSelectedAuctionEvent}
                      >
                        <Trash2 size={15} /> {scheduleDeleteLoading ? '삭제 중...' : '일정 삭제'}
                      </button>
                    )}
                  </div>
                )}
                {scheduleManageError && <p className="personal-calendar-manage-error" role="alert">{scheduleManageError}</p>}
              </div>
            )}
          </section>
        </div>
      )}

      {bidResultEntry && (
        <div className="modal-overlay personal-calendar-bid-result-overlay" onClick={closeBidResultEditor}>
          <div className="personal-calendar-bid-result-dialog" onClick={event => event.stopPropagation()}>
            <AuctionBidResultEditor
              entry={bidResultEntry}
              priceOnly={bidResultEditorMode === 'price'}
              onClose={closeBidResultEditor}
              onSaved={refreshAfterBidResult}
            />
          </div>
        </div>
      )}
    </div>
  );
}
