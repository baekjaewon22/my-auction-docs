import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  isSafeLawitgoProgressId,
  lawitgoProgressRenderUrl,
  lawitgoProgressUrl,
  lawitgoRequestHeaders,
  normalizeLawitgoProgressDetail,
  normalizeLawitgoProgressList,
} from '../src/worker/lib/lawitgo-progress.ts';
import { canViewAllEvictionProgress, JEONG_MINHO_USER_ID } from '../src/shared/eviction-quote-access.ts';

test('lawitgo 목록 응답은 화면에 필요한 허용 필드만 브라우저로 전달한다', () => {
  const result = normalizeLawitgoProgressList({
    items: [{
      id: 'progress_1',
      title: '본인 사건',
      case_number: '2026타경1234',
      court_name: '서울중앙지방법원',
      status: 'active',
      progress_summary: '배당기일 대기',
      resident_registration_number: '000000-0000000',
      detailed_address: '노출 금지 주소',
      settlement: { amount: 100 },
      internal_memo: '노출 금지 메모',
      alimtalk_logs: ['secret'],
      audit_logs: ['secret'],
    }],
  });

  assert.deepEqual(result.items[0], {
    id: 'progress_1',
    title: '본인 사건',
    caseNumber: '2026타경1234',
    court: '서울중앙지방법원',
    status: 'active',
    statusLabel: '',
    stage: '',
    stageLabel: '',
    progressSummary: '배당기일 대기',
    updatedAt: '',
    consultantName: '',
    clientName: '',
    receivedAt: '',
    caseType: '',
  });
  assert.doesNotMatch(JSON.stringify(result), /resident|address|settlement|memo|alimtalk|audit|000000/);
});

test('lawitgo 상세 응답은 허용된 사건 요약과 제공된 UI 조각만 전달한다', () => {
  const result = normalizeLawitgoProgressDetail({
    item: {
      id: 'progress-2',
      title: '상세 사건',
      ui: { html: '<main>진행 내용</main>', css: 'main{color:#222}' },
      internal_memo: '서버 내부 메모',
      income: 1000,
      expense: 500,
    },
  });

  assert.equal(result?.item.id, 'progress-2');
  assert.deepEqual(result?.ui, { html: '<main>진행 내용</main>', css: 'main{color:#222}' });
  assert.equal('internal_memo' in (result?.item || {}), false);
  assert.equal('income' in (result?.item || {}), false);
});

test('lawitgo 요청 URL과 서버 전용 헤더를 고정한다', () => {
  assert.equal(
    lawitgoProgressUrl(),
    'https://www.lawitgo.com/api/integrations/mydocs/progress?status=active&limit=50',
  );
  assert.equal(
    lawitgoProgressUrl('progress_3'),
    'https://www.lawitgo.com/api/integrations/mydocs/progress/progress_3?includeUi=true',
  );
  assert.equal(
    lawitgoProgressRenderUrl('progress_3'),
    'https://www.lawitgo.com/api/integrations/mydocs/progress/progress_3/render',
  );
  const headers = lawitgoRequestHeaders('server-secret', 'consultant-user-id');
  assert.equal(headers.get('X-API-Key'), 'server-secret');
  assert.equal(headers.get('X-MyDocs-Consultant-Id'), 'consultant-user-id');
  assert.equal(headers.get('Accept'), 'application/json');
});

test('상세 사건 ID는 경로 조작 문자를 허용하지 않는다', () => {
  assert.equal(isSafeLawitgoProgressId('abc-DEF_123'), true);
  assert.equal(isSafeLawitgoProgressId('../other-consultant'), false);
  assert.equal(isSafeLawitgoProgressId('id?consultant_id=other'), false);
});

test('프론트엔드에는 API 키 헤더가 없고 lawitgo UI는 sandbox iframe에만 삽입한다', () => {
  const apiSource = readFileSync('src/react-app/api.ts', 'utf8');
  const pageSource = readFileSync('src/react-app/pages/LawitgoProgress.tsx', 'utf8');
  const routeSource = readFileSync('src/worker/routes/lawitgo-progress.ts', 'utf8');
  const mappingSource = readFileSync('src/worker/lib/lawitgo-consultant-mapping.ts', 'utf8');
  const cacheSource = readFileSync('src/worker/lib/lawitgo-progress-cache.ts', 'utf8');
  const workerSource = readFileSync('src/worker/index.ts', 'utf8');

  assert.doesNotMatch(apiSource, /consultantId|consultant_id|X-API-Key|LAWITGO_API_KEY/);
  assert.doesNotMatch(pageSource, /consultantId|consultant_id|X-API-Key|LAWITGO_API_KEY|dangerouslySetInnerHTML/);
  assert.match(pageSource, /sandbox=""/);
  assert.match(pageSource, /srcDoc=\{srcDoc\}/);
  assert.match(routeSource, /sessionUser\.sub/);
  assert.match(routeSource, /sessionUser\.sub/);
  assert.match(routeSource, /resolveLawitgoConsultantId\(c\.env\.DB, user\.id\)/);
  assert.doesNotMatch(routeSource, /LAWITGO_API_KEY|X-API-Key|fetch\(/);
  assert.match(cacheSource, /LAWITGO_API_KEY/);
  assert.match(cacheSource, /lawitgoRequestHeaders\(apiKey, consultantId\)/);
  assert.doesNotMatch(routeSource, /c\.req\.(query|json)[\s\S]{0,100}consultant/i);
  assert.match(mappingSource, /FROM lawitgo_consultant_mappings m/);
  assert.match(mappingSource, /WHERE m\.user_id = \?/);
  assert.match(mappingSource, /u\.approved = 1 AND u\.role != 'resigned'/);
  assert.match(workerSource, /app\.route\('\/api\/lawitgo\/progress', lawitgoProgressRoute\)/);
  assert.match(routeSource, /Cache-Control', 'no-store, private/);
});

test('lawitgo render 프록시도 동일한 서버측 담당자 매핑과 Secret을 사용한다', () => {
  const routeSource = readFileSync('src/worker/routes/lawitgo-progress.ts', 'utf8');
  const renderStart = routeSource.indexOf("lawitgoProgress.get('/:id/render'");
  const detailStart = routeSource.indexOf("lawitgoProgress.get('/:id'", renderStart);
  const renderRoute = routeSource.slice(renderStart, detailStart);

  assert.ok(renderStart >= 0);
  assert.match(renderRoute, /cachedLawitgoDetail\(c\.env\.DB, id, scope\.canViewAll \? undefined : scope\.ownConsultantId!\)/);
  assert.match(renderRoute, /Content-Security-Policy/);
  assert.match(renderRoute, /no-store, private/);
  assert.doesNotMatch(renderRoute, /consultantId|consultant_id/);
});

test('consultantId 매핑은 사용자 계정별 고유값으로 DB에 유지한다', () => {
  const schema = readFileSync('d1/schema.sql', 'utf8');
  const migration = readFileSync('d1/migrate-lawitgo-consultant-mappings.sql', 'utf8');
  const envTypes = readFileSync('env.d.ts', 'utf8');

  for (const sql of [schema, migration]) {
    assert.match(sql, /CREATE TABLE IF NOT EXISTS lawitgo_consultant_mappings/);
    assert.match(sql, /user_id TEXT PRIMARY KEY/);
    assert.match(sql, /consultant_id TEXT NOT NULL UNIQUE/);
  }
  assert.match(migration, /SELECT id, id, 'system-migration'[\s\S]*FROM users/);
  assert.match(envTypes, /LAWITGO_API_KEY\?: string/);
  assert.doesNotMatch(envTypes, /LAWITGO_MYDOCS_API_KEY/);
});

test('명도 진행사항은 로그인 담당자에게 공개하고 서버가 전체·본인 범위를 강제한다', () => {
  const appSource = readFileSync('src/react-app/App.tsx', 'utf8');
  const layoutSource = readFileSync('src/react-app/components/Layout.tsx', 'utf8');
  const pageSource = readFileSync('src/react-app/pages/LawitgoProgress.tsx', 'utf8');
  const workerRouteSource = readFileSync('src/worker/routes/lawitgo-progress.ts', 'utf8');
  const routeMarkup = appSource.match(/<Route path="case-progress"[^\n]+/)?.[0] || '';

  assert.match(routeMarkup, /element=\{<LawitgoProgress \/>\}/);
  assert.doesNotMatch(routeMarkup, /MasterRoute/);
  assert.match(layoutSource, /<Link to="\/case-progress"/);
  assert.doesNotMatch(workerRouteSource, /requireRole\('master'\)/);
  assert.match(layoutSource, /title="명도 진행사항"/);
  assert.match(layoutSource, /!collapsed && '명도 진행사항'/);
  assert.match(pageSource, /명도 진행사항/);
  assert.doesNotMatch(layoutSource, /내 사건 진행사항/);
  assert.match(pageSource, /lawitgo-workspace/);
  assert.match(pageSource, /고객명, 사건번호 검색/);
  assert.match(pageSource, /나의 사건 진행내용/);
});

test('마스터·대표·정민호 지사장·명도팀만 전체 명도 진행사항 열람자다', () => {
  assert.equal(canViewAllEvictionProgress({ role: 'master' }), true);
  assert.equal(canViewAllEvictionProgress({ role: 'ceo' }), true);
  assert.equal(canViewAllEvictionProgress({ userId: JEONG_MINHO_USER_ID, role: 'admin' }), true);
  assert.equal(canViewAllEvictionProgress({ role: 'support', department: '명도팀' }), true);
  assert.equal(canViewAllEvictionProgress({ role: 'support', teamName: '명도팀' }), true);
  assert.equal(canViewAllEvictionProgress({ role: 'admin', department: '경매사업부' }), false);
  assert.equal(canViewAllEvictionProgress({ role: 'member', department: '경매사업부' }), false);
});

test('전체 권한은 서버 매핑 전체를 조회하고 기타 인원은 본인 매핑만 사용한다', () => {
  const routeSource = readFileSync('src/worker/routes/lawitgo-progress.ts', 'utf8');
  assert.match(routeSource, /!scope\.canViewAll && !scope\.ownConsultantId/);
  assert.match(routeSource, /cachedLawitgoList\(c\.env\.DB, scope\.canViewAll \? undefined : scope\.ownConsultantId!\)/);
  assert.match(routeSource, /cachedLawitgoDetail\(c\.env\.DB, id, scope\.canViewAll \? undefined : scope\.ownConsultantId!\)/);
  assert.doesNotMatch(routeSource, /c\.req\.(query|json)[\s\S]{0,100}consultant/i);
});

test('lawitgo 진행사항은 KST 09·12·15·18시에 Cron pull하고 화면 요청은 캐시만 읽는다', () => {
  const wrangler = readFileSync('wrangler.json', 'utf8');
  const worker = readFileSync('src/worker/index.ts', 'utf8');
  const route = readFileSync('src/worker/routes/lawitgo-progress.ts', 'utf8');
  const cache = readFileSync('src/worker/lib/lawitgo-progress-cache.ts', 'utf8');

  assert.match(wrangler, /"\*\/30 \* \* \* \*"/);
  assert.match(worker, /getUTCMinutes\(\) === 0[\s\S]{0,180}\[0, 3, 6, 9\][\s\S]{0,350}pullLawitgoProgressCache/);
  assert.doesNotMatch(route, /fetch\(|lawitgoProgressUrl|lawitgoRequestHeaders/);
  assert.match(route, /cachedLawitgoList/);
  assert.match(route, /cachedLawitgoDetail/);
  assert.match(cache, /lawitgoProgressUrl\(\)/);
  assert.match(cache, /lawitgoProgressUrl\(listItem\.id\)/);
});

test('담당자 pull이 실패하면 기존 정상 캐시를 비활성화하지 않는다', () => {
  const cache = readFileSync('src/worker/lib/lawitgo-progress-cache.ts', 'utf8');
  const detailsFetch = cache.indexOf('const details = await mapWithConcurrency');
  const deactivate = cache.indexOf("UPDATE lawitgo_progress_cache SET active = 0", detailsFetch);
  const failure = cache.indexOf("status = 'failed'", deactivate);

  assert.ok(detailsFetch >= 0 && deactivate > detailsFetch && failure > deactivate);
  const catchBlock = cache.slice(cache.indexOf('} catch (error)', deactivate), cache.indexOf('export async function pullLawitgoProgressCache'));
  assert.doesNotMatch(catchBlock, /UPDATE lawitgo_progress_cache SET active = 0|DELETE FROM lawitgo_progress_cache/);
  assert.match(cache, /await db\.batch\(statements\)/);
});

test('캐시에는 허용 목록과 lawitgo UI 조각만 저장하고 원본 응답은 저장하지 않는다', () => {
  const cache = readFileSync('src/worker/lib/lawitgo-progress-cache.ts', 'utf8');
  const migration = readFileSync('d1/migrate-lawitgo-progress-cache.sql', 'utf8');
  assert.match(cache, /normalizeLawitgoProgressList/);
  assert.match(cache, /normalizeLawitgoProgressDetail/);
  assert.match(cache, /JSON\.stringify\(detail\.item\)/);
  assert.doesNotMatch(cache, /JSON\.stringify\((listPayload|detailPayload)\)/);
  assert.match(migration, /CREATE TABLE IF NOT EXISTS lawitgo_progress_cache/);
  assert.match(migration, /CREATE TABLE IF NOT EXISTS lawitgo_progress_cache_runs/);
});
