import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {
  automationArtifactContentType,
  safeAutomationFileName,
  secureTextEqual,
} from '../src/worker/lib/automation-job-queue.ts';

const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8');

test('중앙 큐는 임대·재시도·예약·소유자·결과 저장소를 명시한다', () => {
  const migration = read('../d1/migrate-automation-job-queue.sql');
  assert.match(migration, /CREATE TABLE IF NOT EXISTS automation_jobs/);
  assert.match(migration, /lease_token TEXT NOT NULL/);
  assert.match(migration, /attempt_count INTEGER NOT NULL/);
  assert.match(migration, /available_at TEXT NOT NULL/);
  assert.match(migration, /UNIQUE \(owner_user_id, idempotency_key\)/);
  assert.match(migration, /CREATE TABLE IF NOT EXISTS automation_job_artifacts/);
});

test('브라우저가 실행기 비밀번호나 consultant 식별자를 전달하지 않는다', () => {
  const frontend = read('../src/react-app/automationApi.ts');
  const report = read('../src/worker/routes/report.ts');
  const agentRoute = read('../src/worker/routes/automation-agent-queue.ts');
  assert.doesNotMatch(frontend, /127\.0\.0\.1:8001/);
  assert.doesNotMatch(frontend, /myauction_pw/);
  assert.match(report, /local-profile[\s\S]*410/);
  assert.match(report, /owner_user_id !== authUser\.sub/);
  assert.match(agentRoute, /myauction_pw: String\(job\.myauction_pw/);
});

test('실행기는 구버전 차단 후 한 건만 원자적으로 임대한다', () => {
  const route = read('../src/worker/routes/automation-agent-queue.ts');
  const worker = read('../automation-service/backend/app/services/central_queue_worker.py');
  assert.match(route, /AUTOMATION_AGENT_VERSION/);
  assert.match(route, /required_version/);
  assert.match(route, /WHERE id = \? AND status = 'queued'/);
  assert.match(route, /julianday\(available_at\) <= julianday\('now'\)/);
  assert.match(worker, /AUTOMATION_EXECUTION_LOCK/);
  assert.match(worker, /journal_mode=WAL/);
});

test('회사 서버는 8001~8003 세 슬롯과 분리 작업공간으로 실행된다', () => {
  const installer = read('../automation-service/installer/setup_agent.py');
  const config = read('../automation-service/backend/app/core/config.py');
  const selenium = read('../automation-service/backend/app/services/selenium_driver.py');
  assert.match(installer, /SLOT_COUNT = 3/);
  assert.match(installer, /\$basePort \+ \$slot - 1/);
  assert.match(installer, /workspaces\\\\slot-/);
  assert.match(installer, /AUCTION_REPORT_QUEUE_AGENT_ID/);
  assert.match(installer, /AUCTION_REPORT_SLOT_COUNT/);
  assert.match(installer, /configuredSlotCount -le 4/);
  assert.match(config, /AUCTION_REPORT_WORK_ROOT/);
  assert.match(selenium, /AUCTION_REPORT_WORK_ROOT/);
});

test('파일 이름과 결과 형식 및 실행기 키 비교를 안전하게 처리한다', async () => {
  assert.equal(safeAutomationFileName('../사건:1?.pdf'), '.._사건_1_.pdf');
  assert.equal(automationArtifactContentType('pdf'), 'application/pdf');
  assert.equal(await secureTextEqual('same-secret', 'same-secret'), true);
  assert.equal(await secureTextEqual('same-secret', 'other-secret'), false);
  assert.equal(await secureTextEqual('', ''), false);
});
