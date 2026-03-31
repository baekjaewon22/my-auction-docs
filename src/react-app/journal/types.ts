export interface JournalEntry {
  id: string;
  user_id: string;
  user_name?: string;
  user_role?: string;
  target_date: string;
  activity_type: ActivityType;
  activity_subtype: string;
  data: string; // JSON string
  completed: number;
  fail_reason: string;
  branch: string;
  department: string;
  created_at: string;
  updated_at: string;
}

export type ActivityType = '입찰' | '임장' | '미팅' | '사무' | '개인';

export const ACTIVITY_TYPES: ActivityType[] = ['입찰', '임장', '미팅', '사무', '개인'];

export const ACTIVITY_COLORS: Record<ActivityType, string> = {
  '입찰': '#1a73e8',
  '임장': '#188038',
  '미팅': '#e65100',
  '사무': '#7b1fa2',
  '개인': '#9aa0a6',
};

export const MEETING_SUBTYPES = ['고객상담', '브리핑', '계약서작성', '기타'] as const;
export const OFFICE_SUBTYPES = ['고객관리', '자료작성', '기타'] as const;

// 시간 선택 옵션 (06:00 ~ 22:00, 10분 단위)
export function generateTimeOptions(): string[] {
  const times: string[] = [];
  for (let h = 6; h <= 22; h++) {
    for (let m = 0; m < 60; m += 10) {
      times.push(`${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}`);
    }
  }
  return times;
}

// 연도 선택 (2000 ~ 2026)
export function generateYears(): number[] {
  const years: number[] = [];
  for (let y = 2026; y >= 2000; y--) years.push(y);
  return years;
}

// 전국 법원 목록 (본원/지원 구분)
export interface CourtOption {
  value: string;
  label: string;
  isMain: boolean; // 본원 여부
}

const COURT_DATA: { main: string; branches: string[] }[] = [
  { main: '서울중앙지방법원', branches: [] },
  { main: '서울동부지방법원', branches: [] },
  { main: '서울남부지방법원', branches: [] },
  { main: '서울북부지방법원', branches: [] },
  { main: '서울서부지방법원', branches: [] },
  { main: '의정부지방법원', branches: ['고양지원', '남양주지원'] },
  { main: '인천지방법원', branches: ['부천지원'] },
  { main: '수원지방법원', branches: ['성남지원', '여주지원', '평택지원', '안산지원', '안양지원'] },
  { main: '춘천지방법원', branches: ['강릉지원', '원주지원', '속초지원', '영월지원'] },
  { main: '대전지방법원', branches: ['홍성지원', '논산지원', '천안지원', '서산지원'] },
  { main: '청주지방법원', branches: ['충주지원', '제천지원', '영동지원'] },
  { main: '대구지방법원', branches: ['안동지원', '경주지원', '김천지원', '상주지원', '의성지원', '영덕지원', '포항지원'] },
  { main: '부산지방법원', branches: ['동부지원'] },
  { main: '울산지방법원', branches: [] },
  { main: '창원지방법원', branches: ['마산지원', '진주지원', '통영지원', '밀양지원', '거창지원'] },
  { main: '광주지방법원', branches: ['목포지원', '장흥지원', '순천지원', '해남지원'] },
  { main: '전주지방법원', branches: ['군산지원', '정읍지원', '남원지원'] },
  { main: '제주지방법원', branches: [] },
];

export const COURT_OPTIONS: CourtOption[] = COURT_DATA.flatMap((c) => [
  { value: c.main, label: c.main, isMain: true },
  ...c.branches.map((b) => ({
    value: `${c.main} ${b}`,
    label: `${c.main} ${b}`,
    isMain: false,
  })),
]);

// 하위 호환용
export const COURTS = COURT_OPTIONS.map((c) => c.value);

// KST (한국 시간) 기준 날짜
function getKSTDate(offset = 0): Date {
  const now = new Date();
  const kst = new Date(now.getTime() + (9 * 60 * 60 * 1000) + (offset * 86400000));
  return kst;
}

function formatDateStr(d: Date): string {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
}

export function getToday(): string {
  return formatDateStr(getKSTDate(0));
}

export function getTomorrow(): string {
  return formatDateStr(getKSTDate(1));
}

export function formatShortDate(dateStr: string): string {
  const parts = dateStr.split('-');
  return `${parts[0].slice(2)}.${Number(parts[1])}.${Number(parts[2])}`;
}
