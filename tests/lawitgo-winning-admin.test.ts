import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const app = readFileSync(new URL('../src/react-app/App.tsx', import.meta.url), 'utf8');
const layout = readFileSync(new URL('../src/react-app/components/Layout.tsx', import.meta.url), 'utf8');
const page = readFileSync(new URL('../src/react-app/pages/LawitgoWinningAdmin.tsx', import.meta.url), 'utf8');
const route = readFileSync(new URL('../src/worker/routes/lawitgo-winning-admin.ts', import.meta.url), 'utf8');
const worker = readFileSync(new URL('../src/worker/index.ts', import.meta.url), 'utf8');

test('Lawitgo winning administration is master-only in menu, route, and API', () => {
  assert.match(layout, /role === 'master'[\s\S]*?to="\/lawitgo-winning-admin"/);
  assert.match(app, /path="lawitgo-winning-admin" element=\{<MasterRoute><LawitgoWinningAdmin \/><\/MasterRoute>\}/);
  assert.match(route, /route\.use\('\*', requireRole\('master'\)\)/);
  assert.match(worker, /app\.route\('\/api\/lawitgo-winning-admin', lawitgoWinningAdminRoute\)/);
});

test('manual send requires an explicit confirmation and never exposes a raw phone number', () => {
  assert.match(route, /body\.confirmation !== 'SEND_TO_LAWITGO'/);
  assert.match(route, /customer_phone_masked: maskPhone/);
  assert.doesNotMatch(route, /customer_phone:\s*item/);
  assert.match(page, /고객명·전화번호·법원·사건번호가 외부로 전송됩니다/);
  assert.match(page, /대기 전체 발송/);
  assert.match(page, /선택 발송/);
});
