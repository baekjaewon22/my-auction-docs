export type LoginSessionType = 'employee' | 'freelancer';

function normalizeLoginType(value: unknown): LoginSessionType {
  return value === 'freelancer' ? 'freelancer' : 'employee';
}
/**
 * 일반 계정은 DB의 고용형태를 따르고, 마스터만 로그인 화면에서 선택한
 * 세션 모드로 진입할 수 있다. 역할과 급여 기준은 변경하지 않는다.
 */
export function resolveLoginSessionType(
  role: string,
  storedLoginType: unknown,
  requestedLoginType: unknown,
): LoginSessionType {
  const stored = normalizeLoginType(storedLoginType);
  return role === 'master' ? normalizeLoginType(requestedLoginType) : stored;
}
