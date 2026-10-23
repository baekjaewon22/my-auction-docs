export type SalesProxyInput = { proxy_agent?: unknown; proxy_date?: unknown; proxy_undecided?: unknown };
export const PROXY_UNDECIDED_WARNING = '대리인 또는 대리일이 미정입니다. 정해지는 즉시 업무성과 상세에서 반드시 수정해 주세요. 미정 상태에서는 대리일 Slack 알림이 발송되지 않습니다.';
export function validateSalesProxy(input: SalesProxyInput) {
  if (![undefined, false, true, 0, 1].includes(input.proxy_undecided as never)) throw new Error('미정 여부를 확인해 주세요.');
  const undecided = input.proxy_undecided === true || input.proxy_undecided === 1;
  const agent = typeof input.proxy_agent === 'string' ? input.proxy_agent.trim() : '';
  const date = typeof input.proxy_date === 'string' ? input.proxy_date.trim() : '';
  if (agent.length > 100 || /[\r\n]/.test(agent)) throw new Error('대리인은 100자 이내 한 줄로 입력해 주세요.');
  if (date && (!/^20\d{2}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(Date.parse(date)) || new Date(date).toISOString().slice(0, 10) !== date)) throw new Error('올바른 대리일을 입력해 주세요.');
  if (!undecided && (!agent || !date)) throw new Error('대리인과 대리일을 입력하거나 미정을 선택해 주세요.');
  return { proxy_agent: agent, proxy_date: date, proxy_undecided: undecided ? 1 : 0 };
}
