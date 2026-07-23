export interface AutomationAgentHealthAssessment {
  version: string;
  updateRequired: boolean;
  dependencyReady: boolean;
}

function compareVersions(left: string, right: string) {
  const leftParts = String(left || '').match(/\d+/g)?.map(Number) || [];
  const rightParts = String(right || '').match(/\d+/g)?.map(Number) || [];
  const length = Math.max(leftParts.length, rightParts.length);
  for (let i = 0; i < length; i += 1) {
    const a = leftParts[i] || 0;
    const b = rightParts[i] || 0;
    if (a !== b) return a > b ? 1 : -1;
  }
  return 0;
}

export async function assessAutomationAgentHealth(
  data: { version?: unknown; dependencies?: { poppler?: { ready?: unknown } } },
  requiredVersion: string,
  ensureSession: () => Promise<unknown>,
): Promise<AutomationAgentHealthAssessment> {
  const version = String(data?.version || '').trim();
  const dependencyReady = data?.dependencies?.poppler?.ready !== false;
  const updateRequired = !version
    || compareVersions(version, requiredVersion) < 0
    || !dependencyReady;

  // 구버전 에이전트에는 세션 API가 없으므로 업데이트 상태를 먼저 반환해야 한다.
  if (!updateRequired) await ensureSession();

  return { version, updateRequired, dependencyReady };
}
