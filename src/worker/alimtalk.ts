/**
 * NCP SENS 알림톡 유틸리티
 * - NCP 키가 등록되면 바로 작동
 * - 키 미등록 시 발송 스킵 (로그만 남김)
 */

// ── 템플릿 정의 ──

export const ALIMTALK_TEMPLATES = {
  // 회원가입 인증
  SIGNUP_VERIFY: {
    code: 'SIGNUP',
    variables: ['verify_code'],
    content: `[마이옥션 오피스]
본인확인 인증번호입니다.

인증번호: #{verify_code}

3분 이내에 입력해주세요.
본인이 요청하지 않았다면 무시하세요.`,
  },

  // 문서 제출 → 결재자에게
  DOC_SUBMITTED: {
    code: 'DOC',
    variables: ['author_name', 'doc_title', 'department', 'submit_date'],
    content: `[마이옥션 오피스]

관리자님

#{author_name}님이 문서를 제출하였습니다.

■ 문서명: #{doc_title}
■ 부서: #{department}
■ 제출일: #{submit_date}

결재 확인이 필요합니다.`,
  },

  // 단계 승인 → 다음 결재자에게
  DOC_STEP_APPROVED: {
    code: 'docstep',
    variables: ['approver_name', 'doc_title', 'author_name', 'department'],
    content: `[마이옥션 오피스]

관리자님

#{approver_name}님이 문서를 승인하였습니다.
다음 결재 차례입니다.

■ 문서명: #{doc_title}
■ 작성자: #{author_name}
■ 부서: #{department}

결재 확인이 필요합니다.`,
  },

  // 최종 승인 → 작성자에게
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

  // 반려 → 작성자에게
  DOC_REJECTED: {
    code: 'docre',
    variables: ['doc_title', 'rejector_name', 'reject_reason'],
    content: `[마이옥션 오피스]

담당자님

문서가 반려되었습니다.

■ 문서명: #{doc_title}
■ 반려자: #{rejector_name}
■ 사유: #{reject_reason}

수정 후 재제출해주세요.`,
  },

  // 회원가입 승인 완료 → 신규회원에게
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

  // 회의록 공유 알림
  MINUTES_SHARED: {
    code: 'shared',
    variables: ['author_name', 'title', 'date'],
    content: `[마이옥션 오피스]

담당자님

#{author_name}님이 회의록을 공유하였습니다.

■ 제목: #{title}
■ 작성일: #{date}

확인해주세요.`,
  },

  // 입금 매칭 신청 → 총무에게
  DEPOSIT_CLAIM: {
    code: 'chong',
    variables: ['claimer_name', 'depositor', 'amount', 'deposit_date', 'branch'],
    content: `[마이옥션 오피스]

총무담당자님

#{claimer_name}님이 입금 매칭을 신청하였습니다.

■ 입금자: #{depositor}
■ 금액: #{amount}원
■ 입금일: #{deposit_date}
■ 지사: #{branch}

매칭 확인이 필요합니다.`,
  },
} as const;

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
