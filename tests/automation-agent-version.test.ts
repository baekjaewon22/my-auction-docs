import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { AUTOMATION_AGENT_VERSION } from '../src/shared/automation-agent-version.ts';

test('실행기 최신 버전 경로는 인증 미들웨어보다 먼저 등록된다', () => {
  const source = readFileSync(
    new URL('../src/worker/routes/report.ts', import.meta.url),
    'utf8',
  );
  const versionRouteIndex = source.indexOf("report.get('/agent-version'");
  const authMiddlewareIndex = source.indexOf("report.use('*', authMiddleware)");

  assert.notEqual(versionRouteIndex, -1);
  assert.notEqual(authMiddlewareIndex, -1);
  assert.equal(versionRouteIndex < authMiddlewareIndex, true);
  assert.match(source, /automation-agent-version/);
  assert.match(source, /Cache-Control.*no-store/s);
  assert.match(source, /filename="MyAuctionRunnerSetup\.exe"/);
  assert.match(source, /filename\*=UTF-8/);
});

test('실행기 버전은 프런트·Worker·Python·빌드가 공용 원본을 사용한다', () => {
  assert.match(AUTOMATION_AGENT_VERSION, /^\d{4}\.\d{2}\.\d{2}\.\d+$/);

  const frontend = readFileSync(
    new URL('../src/react-app/automationApi.ts', import.meta.url),
    'utf8',
  );
  const worker = readFileSync(
    new URL('../src/worker/routes/report.ts', import.meta.url),
    'utf8',
  );
  const backend = readFileSync(
    new URL('../automation-service/backend/app/api/routes.py', import.meta.url),
    'utf8',
  );
  const buildScript = readFileSync(
    new URL('../scripts/build-auction-automation-agent.ps1', import.meta.url),
    'utf8',
  );

  assert.match(frontend, /automation-agent-version/);
  assert.match(frontend, /extendedMatch/);
  assert.match(frontend, /downloadAgentInstaller/);
  const documentGeneration = readFileSync(
    new URL('../src/react-app/pages/DocumentGeneration.tsx', import.meta.url),
    'utf8',
  );
  assert.match(documentGeneration, /최신 실행기 다운로드/);
  assert.match(documentGeneration, /automationApi\.downloadAgentInstaller\(\)/);
  assert.match(worker, /automation-agent-version/);
  assert.match(backend, /automation-agent-version\.ts/);
  assert.match(backend, /return "unknown"/);
  assert.doesNotMatch(backend, /raise RuntimeError\("Automation agent version source was not found"\)/);
  assert.match(buildScript, /automation-agent-version\.ts/);
  assert.doesNotMatch(frontend, /2026\.07\.28\.1/);
  assert.doesNotMatch(worker, /2026\.07\.28\.1/);
  assert.doesNotMatch(backend, /2026\.07\.28\.1/);
  assert.doesNotMatch(buildScript, /2026\.07\.28\.1/);
});
