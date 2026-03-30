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

// 전국 법원 목록
export const COURTS = [
  '서울중앙지방법원', '서울동부지방법원', '서울남부지방법원', '서울북부지방법원', '서울서부지방법원',
  '의정부지방법원', '의정부지방법원 고양지원', '의정부지방법원 남양주지원',
  '인천지방법원', '인천지방법원 부천지원',
  '수원지방법원', '수원지방법원 성남지원', '수원지방법원 여주지원', '수원지방법원 평택지원', '수원지방법원 안산지원', '수원지방법원 안양지원',
  '춘천지방법원', '춘천지방법원 강릉지원', '춘천지방법원 원주지원', '춘천지방법원 속초지원', '춘천지방법원 영월지원',
  '대전지방법원', '대전지방법원 홍성지원', '대전지방법원 논산지원', '대전지방법원 천안지원', '대전지방법원 서산지원',
  '청주지방법원', '청주지방법원 충주지원', '청주지방법원 제천지원', '청주지방법원 영동지원',
  '대구지방법원', '대구지방법원 안동지원', '대구지방법원 경주지원', '대구지방법원 김천지원', '대구지방법원 상주지원', '대구지방법원 의성지원', '대구지방법원 영덕지원', '대구지방법원 포항지원',
  '부산지방법원', '부산지방법원 동부지원',
  '울산지방법원',
  '창원지방법원', '창원지방법원 마산지원', '창원지방법원 진주지원', '창원지방법원 통영지원', '창원지방법원 밀양지원', '창원지방법원 거창지원',
  '광주지방법원', '광주지방법원 목포지원', '광주지방법원 장흥지원', '광주지방법원 순천지원', '광주지방법원 해남지원',
  '전주지방법원', '전주지방법원 군산지원', '전주지방법원 정읍지원', '전주지방법원 남원지원',
  '제주지방법원',
] as const;

export function getToday(): string {
  return new Date().toISOString().split('T')[0];
}

export function getTomorrow(): string {
  return new Date(Date.now() + 86400000).toISOString().split('T')[0];
}

export function formatShortDate(dateStr: string): string {
  const d = new Date(dateStr + 'T00:00:00');
  return `${d.getFullYear().toString().slice(2)}.${d.getMonth() + 1}.${d.getDate()}`;
}
