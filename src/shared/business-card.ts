export interface BusinessCard {
  name: string; title: string; phone: string; email: string;
  headline: string; introduction: string; career: string; specialties: string;
  kakaoUrl: string; photo: string; department: string; branch: string; boxColor: string;
  instagramUrl: string; blogUrl: string; youtubeUrl: string; videoUrl: string;
  companyHidden: string; companyImage: string;
}
export const defaultCardWriting = {
  introduction: '부동산 경매가 처음이신 분도 이해하기 쉽게 상담하겠습니다.\n희망 지역과 예산, 이용 목적을 바탕으로 관심 물건의 정보와 확인할 사항을 함께 살펴보겠습니다.\n충분한 설명과 꼼꼼한 소통으로 신중한 선택을 돕겠습니다.',
  career: '상담 안내\n· 희망 지역·예산·이용 목적에 따른 경매 상담\n· 관심 물건의 기본 정보와 입찰 전 확인 사항 안내\n· 경매 진행 절차와 준비 사항 안내\n· 상담 내용에 따른 후속 문의 응대',
};
export const blankCard: BusinessCard = {
  name: '', title: '', phone: '', email: '', headline: '좋은 선택의 시작, 함께하겠습니다.',
  introduction: '', career: '', specialties: '', kakaoUrl: '', photo: '',
  department: '', branch: '', boxColor: 'navy',
  instagramUrl: '', blogUrl: '', youtubeUrl: '', videoUrl: '',
  companyHidden: '', companyImage: '',
};
export const cardColors = {
  black: { label: '블랙', rgb: '12,18,27', swatch: '#0c121b', ink: '#ffffff', logo: 'light' },
  blue: { label: '블루', rgb: '23,66,180', swatch: '#1742b4', ink: '#ffffff', logo: 'light' },
  navy: { label: '네이비', rgb: '20,34,79', swatch: '#14224f', ink: '#ffffff', logo: 'light' },
  silver: { label: '실버', rgb: '235,239,246', swatch: '#ebeff6', ink: '#17253a', logo: 'dark' },
  green: { label: '그린', rgb: '16,87,54', swatch: '#105736', ink: '#ffffff', logo: 'light' },
} as const;
export const socialLabels = {instagramUrl:'Instagram', blogUrl:'네이버 블로그', youtubeUrl:'YouTube'} as const;
export type SocialField = keyof typeof socialLabels;
const socialHosts: Record<SocialField, string[]> = {
  instagramUrl:['instagram.com','www.instagram.com'],
  blogUrl:['blog.naver.com','m.blog.naver.com'],
  youtubeUrl:['youtube.com','www.youtube.com','m.youtube.com','youtu.be'],
};
export function safeSocialUrl(field: SocialField, value: string): string {
  if(!value.trim()) return '';
  const url=new URL(value.trim());
  if(url.protocol!=='https:' || url.username || url.password || url.port || !socialHosts[field].includes(url.hostname)) throw new Error(`${socialLabels[field]}의 HTTPS 주소를 입력해 주세요.`);
  return url.href;
}
export function youtubeVideoId(value: string): string {
  if(!value.trim()) return '';
  const url=new URL(safeSocialUrl('youtubeUrl',value));
  const parts=url.pathname.split('/').filter(Boolean);
  const id=url.hostname==='youtu.be'?parts[0]:url.pathname==='/watch'?url.searchParams.get('v'):['shorts','embed','live'].includes(parts[0])?parts[1]:'';
  if(!id || !/^[\w-]{11}$/.test(id)) throw new Error('유튜브 영상 1개의 주소를 입력해 주세요. 채널·재생목록 주소는 사용할 수 없습니다.');
  return id;
}
export const fixedCardFields = ['name','department','title','branch','phone'] as const;
export type CardProfile = {name?:string;phone?:string;email?:string;position_title?:string;department?:string;branch?:string};
export function formatCardPhone(value: string): string {
  const digits=value.replace(/[.\s()-]/g,'');
  if(/^01\d{9}$/.test(digits)) return digits.replace(/^(\d{3})(\d{4})(\d{4})$/, '$1.$2.$3');
  if(/^01\d{8}$/.test(digits)) return digits.replace(/^(\d{3})(\d{3})(\d{4})$/, '$1.$2.$3');
  return value;
}
export function syncCardProfile(input: unknown, profile: CardProfile): BusinessCard {
  if(!input || typeof input!=='object' || Array.isArray(input)) throw new Error('명함 내용을 확인해 주세요.');
  const defaults=registrationCard(profile);
  const result={...defaults,...input} as BusinessCard;
  for(const key of fixedCardFields) result[key]=defaults[key];
  return result;
}
export function registrationCard(user: CardProfile): BusinessCard {
  return {...blankCard, ...defaultCardWriting, name:user.name || '', phone:formatCardPhone(user.phone || ''), email:user.email || '', title:user.position_title || '',
    department:user.department || '', branch:user.branch === '의정부' ? '의정부 본사' : user.branch || ''};
}
export function normalizeCard(input: unknown): BusinessCard {
  if (!input || typeof input !== 'object') throw new Error('명함 내용을 확인해 주세요.');
  const raw = input as Record<string, unknown>;
  const card = { ...blankCard };
  for (const key of Object.keys(card) as (keyof BusinessCard)[]) {
    if (raw[key] === undefined && ['department','branch','boxColor','instagramUrl','blogUrl','youtubeUrl','videoUrl','companyHidden','companyImage'].includes(key)) continue;
    if (typeof raw[key] !== 'string') throw new Error('명함 필드가 올바르지 않습니다.');
    card[key] = raw[key].trim();
    const max = ['photo','companyImage'].includes(key) ? 700000 : ['introduction', 'career'].includes(key) ? 3000 : 300;
    if (card[key].length > max) throw new Error('입력 내용 또는 사진이 너무 큽니다.');
  }
  if(card.boxColor==='orange') card.boxColor='navy';
  if (!Object.prototype.hasOwnProperty.call(cardColors, card.boxColor)) throw new Error('명함 박스 색상을 선택해 주세요.');
  for(const field of Object.keys(socialLabels) as SocialField[]) card[field]=safeSocialUrl(field,card[field]);
  if(card.videoUrl) card.videoUrl=`https://www.youtube.com/watch?v=${youtubeVideoId(card.videoUrl)}`;
  if (!card.name || !/^[+\d .()-]{8,30}$/.test(card.phone)) throw new Error('이름과 연락처를 입력해 주세요.');
  card.phone=formatCardPhone(card.phone);
  if (card.kakaoUrl) {
    const url = new URL(card.kakaoUrl);
    if (url.protocol !== 'https:' || !['open.kakao.com', 'pf.kakao.com'].includes(url.hostname) || url.username || url.password)
      throw new Error('카카오 오픈채팅 또는 채널의 HTTPS 상담 링크를 입력해 주세요.');
  }
  if(!['','yes'].includes(card.companyHidden)) throw new Error('회사소개 표시 설정을 확인해 주세요.');
  for(const field of ['photo','companyImage'] as const){
    if (card[field] && !/^data:image\/jpeg;base64,\/9j\/[A-Za-z0-9+/=]+$/.test(card[field])) throw new Error('사진을 다시 업로드해 주세요.');
  }
  return card;
}
export function escapeCardHtml(value: string): string {
  return value.replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!));
}
export function cardVcf(card: BusinessCard): string {
  const escape = (v: string) => v.replace(/\\/g, '\\\\').replace(/\r?\n/g, '\\n').replace(/;/g, '\\;').replace(/,/g, '\\,');
  return ['BEGIN:VCARD', 'VERSION:3.0', `FN:${escape(card.name)}`, 'ORG:마이옥션', `TITLE:${escape(card.title)}`, `TEL;TYPE=CELL:${escape(card.phone)}`, `EMAIL:${escape(card.email)}`, 'END:VCARD', ''].join('\r\n');
}
