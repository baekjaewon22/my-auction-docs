/**
 * NCP SENS 알림톡 유틸리티
 * - NCP 키가 등록되면 바로 작동
 * - 키 미등록 시 발송 스킵 (로그만 남김)
 */

// ── 템플릿 정의 ──

export const ALIMTALK_TEMPLATES = {
  // 회원가입 인증 (기존 유지)
  SIGNUP_VERIFY: {
    code: 'SIGNUP',
    variables: ['verify_code'],
    content: `[마이옥션 오피스]
본인확인 인증번호입니다.

인증번호: #{verify_code}

3분 이내에 입력해주세요.
본인이 요청하지 않았다면 무시하세요.`,
  },

  // 문서 제출 → 결재자에게 (doc2)
  DOC_SUBMITTED: {
    code: 'doc2',
    variables: ['author_name', 'doc_title', 'department', 'submit_date', 'link'],
    content: `[마이옥션 오피스]

관리자님

#{author_name}님이 문서를 제출하였습니다.

■ 문서명: #{doc_title}
■ 부서: #{department}
■ 제출일: #{submit_date}

결재 확인이 필요합니다.

▶ 바로가기
#{link}`,
  },

  // 단계 승인 → 다음 결재자에게 (docstep2)
  DOC_STEP_APPROVED: {
    code: 'docstep2',
    variables: ['approver_name', 'doc_title', 'author_name', 'department', 'link'],
    content: `[마이옥션 오피스]

관리자님

#{approver_name}님이 문서를 승인하였습니다.
다음 결재 차례입니다.

■ 문서명: #{doc_title}
■ 작성자: #{author_name}
■ 부서: #{department}

결재 확인이 필요합니다.

▶ 바로가기
#{link}`,
  },

  // 최종 승인 → 작성자에게 (docfinal 기존 유지, 바로가기 없음)
  DOC_FINAL_APPROVED: {
    code: 'docfinal',
    variables: ['doc_title', 'approver_name', 'approve_date'],
    content: `[마이옥션 오피스]

담당자님

문서가 최종 승인되었습니다.

■ 문서명: #{doc_title}
■ 최종승인자: #{approver_name}
■ 승인일: #{approve_date}`,
  },

  // 반려 → 작성자에게 (docre23)
  DOC_REJECTED: {
    code: 'docre23',
    variables: ['doc_title', 'rejector_name', 'reject_reason', 'link'],
    content: `[마이옥션 오피스]

담당자님

문서가 반려되었습니다.

■ 문서명: #{doc_title}
■ 반려자: #{rejector_name}
■ 사유: #{reject_reason}

수정 후 재제출해주세요.

▶ 바로가기
#{link}`,
  },

  // 회원가입 승인 → 신규회원에게 (signup2 기존 유지, 바로가기 없음)
  SIGNUP_APPROVED: {
    code: 'signup2',
    variables: ['user_name', 'branch', 'department', 'position_title'],
    content: `[마이옥션 오피스]

#{user_name}님

회원가입이 승인되었습니다.
지금 로그인하실 수 있습니다.

■ 소속: #{branch} #{department}
■ 직책: #{position_title}`,
  },

  // 회의록 공유 (shared2)
  MINUTES_SHARED: {
    code: 'shared2',
    variables: ['author_name', 'title', 'date', 'link'],
    content: `[마이옥션 오피스]

담당자님

#{author_name}님이 회의록을 공유하였습니다.

■ 제목: #{title}
■ 작성일: #{date}

확인해주세요.

▶ 바로가기
#{link}`,
  },

  // 결제확인 요청 → 총무에게 (chong2)
  DEPOSIT_CLAIM: {
    code: 'chong2',
    variables: ['claimer_name', 'depositor', 'amount', 'deposit_date', 'branch', 'link'],
    content: `[마이옥션 오피스]

총무담당자님

#{claimer_name}님이 결제확인을 요청하였습니다.

■ 입금자: #{depositor}
■ 금액: #{amount}원
■ 입금일: #{deposit_date}
■ 지사: #{branch}

결제확인 부탁드립니다.

▶ 바로가기
#{link}`,
  },

  // 휴가 신청 → 관리자/총무 (laevetype)
  LEAVE_REQUEST: {
    code: 'laevetype',
    variables: ['user_name', 'leave_type', 'start_date', 'end_date', 'branch', 'link'],
    content: `[마이옥션 오피스]

관리자님

#{user_name}님이 휴가를 신청하였습니다.

■ 유형: #{leave_type}
■ 기간: #{start_date} ~ #{end_date}
■ 지사: #{branch}

승인 확인이 필요합니다.

▶ 바로가기
#{link}`,
  },

  // 휴가 승인/반려 → 신청자 (leaveok)
  LEAVE_APPROVED: {
    code: 'leaveok',
    variables: ['user_name', 'status', 'leave_type', 'start_date', 'end_date', 'approver_name', 'link'],
    content: `[마이옥션 오피스]

#{user_name}님

휴가 신청이 #{status}되었습니다.

■ 유형: #{leave_type}
■ 기간: #{start_date} ~ #{end_date}
■ 처리자: #{approver_name}

▶ 바로가기
#{link}`,
  },

  // 환불 정산 변동 → 총무/관리자 (refund)
  REFUND_NOTICE: {
    code: 'refund',
    variables: ['consultant_name', 'client_name', 'amount', 'branch', 'link'],
    content: `[마이옥션 오피스]

총무님

환불 처리로 인한 정산 변동이 발생하였습니다.

■ 담당자: #{consultant_name}
■ 고객명: #{client_name}
■ 환불금액: #{amount}원
■ 지사: #{branch}

공제 내역을 확인해주세요.

▶ 바로가기
#{link}`,
  },

  // 비밀번호 재설정 (pwreset)
  PW_RESET: {
    code: 'pwreset',
    variables: ['verify_code'],
    content: `[마이옥션 오피스]
비밀번호 재설정 인증번호입니다.

인증번호: #{verify_code}

3분 이내에 입력해주세요.
본인이 요청하지 않았다면 무시하세요.`,
  },

  // 급여정산 완료 (salary)
  SALARY: {
    code: 'salary',
    variables: ['user_name', 'period', 'final_pay', 'pay_type', 'link'],
    content: `[마이옥션 오피스]

#{user_name}님

#{period} 급여정산이 완료되었습니다.

■ 실지급액: #{final_pay}원
■ 정산유형: #{pay_type}

▶ 바로가기
#{link}`,
  },

  // 결제확인 완료 → 담당자 (ACCOUNTING)
  ACCOUNTING_CONFIRMED: {
    code: 'ACCOUNTING',
    variables: ['consultant_name', 'depositor', 'amount', 'confirm_date', 'link'],
    content: `[마이옥션 오피스]

#{consultant_name}님

요청하신 결제확인이 완료되었습니다.

■ 입금자: #{depositor}
■ 금액: #{amount}원
■ 확인일: #{confirm_date}

▶ 바로가기
#{link}`,
  },

  // 사내 커뮤니티: 명도 견적 의뢰 → 명도팀
  COMMUNITY_EVICTION_QUOTE: {
    code: 'commquote',
    variables: ['author_name', 'court', 'case_number', 'title', 'link'],
    content: `[마이옥션 오피스]

명도팀 담당자님

명도 견적 의뢰가 등록되었습니다.

■ 요청자: #{author_name}
■ 법원: #{court}
■ 사건번호: #{case_number}
■ 제목: #{title}

내용 확인 후 정액제 금액을 답변해주세요.

▶ 바로가기
#{link}`,
  },

  // 사내 커뮤니티: 법률지원 질문 → 법률지원팀
  COMMUNITY_LEGAL_SUPPORT: {
    code: 'commlegal',
    variables: ['author_name', 'title', 'date', 'link'],
    content: `[마이옥션 오피스]

법률지원팀 담당자님

법률지원 질문이 등록되었습니다.

■ 질문자: #{author_name}
■ 제목: #{title}
■ 등록일: #{date}

내용 검토 후 답변을 작성해주세요.

▶ 바로가기
#{link}`,
  },

  // 사내 커뮤니티: 명도 견적 답변 완료 → 요청자
  COMMUNITY_EVICTION_QUOTE_ANSWERED: {
    code: 'commquoteok',
    variables: ['receiver_name', 'court', 'case_number', 'responder_name', 'link'],
    content: `[마이옥션 오피스]

#{receiver_name}님

요청하신 명도 견적 의뢰에 답변이 등록되었습니다.

■ 법원: #{court}
■ 사건번호: #{case_number}
■ 답변자: #{responder_name}

정액제 금액 제안 내용을 확인해주세요.

▶ 바로가기
#{link}`,
  },

  // 사내 커뮤니티: 법률지원 답변 완료 → 질문자
  COMMUNITY_LEGAL_SUPPORT_ANSWERED: {
    code: 'commlegalok',
    variables: ['receiver_name', 'title', 'responder_name', 'link'],
    content: `[마이옥션 오피스]

#{receiver_name}님

등록하신 법률지원 질문에 답변이 작성되었습니다.

■ 제목: #{title}
■ 답변자: #{responder_name}

답변 내용을 확인해주세요.

▶ 바로가기
#{link}`,
  },
} as const;

// 앱 도메인 (바로가기 링크용)
export const APP_URL = 'https://my-docs.kr';

export type AlimtalkTemplateKey = keyof typeof ALIMTALK_TEMPLATES;

// ── 타입 ──

export interface AlimtalkEnv {
  NCP_ACCESS_KEY: string;
  NCP_SECRET_KEY: string;
  NCP_SERVICE_ID: string;
  NCP_KAKAO_CHANNEL_ID: string;
}

export interface AlimtalkMessage {
  to: string;
  content: string;
  countryCode?: string;
  useSmsFailover?: boolean;
}

export interface AlimtalkSendResponse {
  requestId: string;
  requestTime: string;
  statusCode: string;
  statusName: string;
  messages?: Array<{
    messageId: string;
    to: string;
    countryCode: string;
    content: string;
    messageStatusCode: string;
    messageStatusDesc: string;
    useSmsFailover: boolean;
  }>;
}

// ── 유틸리티 함수 ──

/** 템플릿 변수 치환: #{variable_name} → 실제 값 */
export function replaceTemplateVariables(
  template: string,
  variables: Record<string, string>,
): string {
  let result = template;
  for (const [key, value] of Object.entries(variables)) {
    result = result.replace(new RegExp(`#\\{${key}\\}`, 'g'), value);
  }
  return result;
}

/** 전화번호 정규화: 010-1234-5678 → 01012345678 */
export function normalizePhone(phone: string): string {
  return phone.replace(/[^0-9]/g, '');
}

/** NCP API HMAC-SHA256 서명 생성 */
async function makeSignature(
  method: string,
  url: string,
  timestamp: string,
  accessKey: string,
  secretKey: string,
): Promise<string> {
  const message = `${method} ${url}\n${timestamp}\n${accessKey}`;
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secretKey),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const signature = await crypto.subtle.sign('HMAC', key, encoder.encode(message));
  return btoa(String.fromCharCode(...new Uint8Array(signature)));
}

/** NCP SENS 요청 헤더 생성 */
async function createHeaders(
  method: string,
  url: string,
  env: AlimtalkEnv,
): Promise<HeadersInit> {
  const timestamp = Date.now().toString();
  const signature = await makeSignature(method, url, timestamp, env.NCP_ACCESS_KEY, env.NCP_SECRET_KEY);
  return {
    'Content-Type': 'application/json; charset=utf-8',
    'x-ncp-apigw-timestamp': timestamp,
    'x-ncp-iam-access-key': env.NCP_ACCESS_KEY,
    'x-ncp-apigw-signature-v2': signature,
  };
}

/** 환경변수에 NCP 키가 설정되어 있는지 확인 */
export function isAlimtalkConfigured(env: Record<string, unknown>): env is Record<string, unknown> & AlimtalkEnv {
  return !!(env.NCP_ACCESS_KEY && env.NCP_SECRET_KEY && env.NCP_SERVICE_ID && env.NCP_KAKAO_CHANNEL_ID);
}

// ── 핵심 발송 함수 ──

/** 알림톡 발송 (NCP 키 미설정 시 스킵) */
export async function sendAlimtalk(
  env: Record<string, unknown>,
  templateCode: string,
  messages: AlimtalkMessage[],
): Promise<AlimtalkSendResponse | null> {
  if (!isAlimtalkConfigured(env)) {
    console.log(`[알림톡] NCP 키 미설정 — 발송 스킵 (template: ${templateCode}, to: ${messages.map(m => m.to).join(',')})`);
    return null;
  }

  const baseUrl = 'https://sens.apigw.ntruss.com';
  const uri = `/alimtalk/v2/services/${env.NCP_SERVICE_ID}/messages`;

  const body = {
    plusFriendId: env.NCP_KAKAO_CHANNEL_ID,
    templateCode,
    messages,
  };

  const headers = await createHeaders('POST', uri, env);
  const response = await fetch(`${baseUrl}${uri}`, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const errorText = await response.text();
    console.error(`[알림톡] 발송 실패: ${response.status} — ${errorText}`);
    throw new Error(`알림톡 발송 실패: ${response.status}`);
  }

  return response.json() as Promise<AlimtalkSendResponse>;
}

// ── 편의 함수: 템플릿 기반 발송 ──

/** 템플릿 키 + 변수 + 수신번호로 간편 발송 (+ 자동 로그 저장) */
export async function sendAlimtalkByTemplate(
  env: Record<string, unknown>,
  templateKey: AlimtalkTemplateKey,
  variables: Record<string, string>,
  phones: string[],
  options?: { db?: D1Database; relatedType?: string; relatedId?: string },
): Promise<AlimtalkSendResponse | null> {
  const template = ALIMTALK_TEMPLATES[templateKey];
  const content = replaceTemplateVariables(template.content, variables);

  const messages: AlimtalkMessage[] = phones.map((phone) => ({
    to: normalizePhone(phone),
    content,
    useSmsFailover: true,
  }));

  const result = await sendAlimtalk(env, template.code, messages);

  // 로그 저장
  const db = options?.db || (env.DB as D1Database | undefined);
  if (db) {
    for (const phone of phones) {
      try {
        await db.prepare(
          'INSERT INTO alimtalk_logs (id, template_code, recipient_phone, content, request_id, status, related_type, related_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
        ).bind(
          crypto.randomUUID(),
          template.code,
          normalizePhone(phone),
          content,
          result?.requestId || '',
          result ? 'sent' : 'skipped',
          options?.relatedType || templateKey,
          options?.relatedId || '',
        ).run();
      } catch { /* 로그 실패는 발송에 영향 없음 */ }
    }
  }

  return result;
}

interface D1Database {
  prepare(query: string): { bind(...values: unknown[]): { run(): Promise<unknown>; all(): Promise<{ results: unknown[] }>; first<T>(): Promise<T | null> } };
}
