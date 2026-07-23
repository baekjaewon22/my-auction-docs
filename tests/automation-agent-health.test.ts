import assert from 'node:assert/strict';
import test from 'node:test';
import { assessAutomationAgentHealth } from '../src/shared/automation-agent-health.ts';

test('구버전 에이전트는 세션 API가 없어도 업데이트 필요 상태를 반환한다', async () => {
  let sessionRequested = false;
  const result = await assessAutomationAgentHealth(
    {
      version: '2026.07.16.1',
      dependencies: { poppler: { ready: true } },
    },
    '2026.07.23.1',
    async () => {
      sessionRequested = true;
      throw new Error('구버전에는 세션 API가 없음');
    },
  );

  assert.equal(result.updateRequired, true);
  assert.equal(result.version, '2026.07.16.1');
  assert.equal(sessionRequested, false);
});

test('현재 버전 에이전트는 세션 발급까지 확인한다', async () => {
  let sessionRequested = false;
  const result = await assessAutomationAgentHealth(
    {
      version: '2026.07.23.1',
      dependencies: { poppler: { ready: true } },
    },
    '2026.07.23.1',
    async () => {
      sessionRequested = true;
    },
  );

  assert.equal(result.updateRequired, false);
  assert.equal(sessionRequested, true);
});
