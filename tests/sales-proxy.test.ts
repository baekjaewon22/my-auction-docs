import test from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import { readFileSync } from 'node:fs';
import { validateSalesProxy } from '../src/shared/sales-proxy.ts';
import { ensureSalesProxySchema } from '../src/worker/lib/sales-proxy-schema.ts';
import { proxySlackWebhook, renderSalesProxySlack, salesProxyDueDate, sendDueSalesProxySlack, sendSalesProxySlackTest } from '../src/worker/lib/sales-proxy-slack.ts';

function setup() {
  const db = new Database(':memory:');
  db.exec(`CREATE TABLE users(id TEXT PRIMARY KEY,name TEXT); INSERT INTO users VALUES('owner','신청자');
    CREATE TABLE sales_records(id TEXT PRIMARY KEY,user_id TEXT,type TEXT,branch TEXT,department TEXT,amount INTEGER NOT NULL DEFAULT 0,proxy_cost INTEGER,
    status TEXT,direction TEXT,contract_date TEXT,payment_type TEXT,deposit_date TEXT,card_deposit_date TEXT);`);
  const d1 = { prepare(sql: string) {
    let values: unknown[] = [];
    const api = { bind(...params: unknown[]) { values=params; return api; },
      async all() { return { results: db.prepare(sql).all(...values) }; },
      async run() { return { meta: { changes: db.prepare(sql).run(...values).changes } }; } };
    return api;
  } } as unknown as D1Database;
  return { db, d1 };
}

test('명시적 테스트는 실매출 없이 테스트 표기 한 건만 발송한다', async()=>{
  const {db,d1}=setup(); const originalFetch=globalThis.fetch; let calls=0;
  try {
    globalThis.fetch=async(_url,options)=>{
      calls++;
      const payload=JSON.parse(String(options?.body));
      assert.match(payload.text,/실제 지급\/결재 대상 아님/);
      assert.match(payload.text,/금액: 100,000원/);
      assert.match(payload.text,/결재\/확인: https:\/\/my-docs.kr\/sales\n/);
      return new Response('ok');
    };
    const env={DB:d1,SLACK_ACCOUNTING_WEBHOOK_URL:'https://hooks.slack.com/services/test/accounting'};
    assert.equal((await sendSalesProxySlackTest(env,'unique-test')).sent,true);
    assert.equal((await sendSalesProxySlackTest(env,'unique-test')).reason,'already_attempted');
    assert.equal(calls,1);
    assert.equal((db.prepare('SELECT COUNT(*) n FROM sales_records').get() as {n:number}).n,0);
    assert.equal((db.prepare('SELECT COUNT(*) n FROM sales_proxy_slack_deliveries').get() as {n:number}).n,0);
  }finally{globalThis.fetch=originalFetch;db.close();}
});

test('대리인·대리일 필수 검증과 미정 예외, 실제 달력 날짜 검증', () => {
  assert.throws(() => validateSalesProxy({}), /대리인과 대리일/);
  assert.throws(() => validateSalesProxy({ proxy_agent:' ', proxy_date:'2026-10-23' }));
  assert.throws(() => validateSalesProxy({ proxy_agent:'대리인', proxy_date:'2026-02-30' }));
  assert.throws(() => validateSalesProxy({ proxy_undecided:'false' }));
  assert.throws(() => validateSalesProxy({ proxy_agent:'가'.repeat(101), proxy_undecided:true }));
  assert.equal(validateSalesProxy({ proxy_undecided:true }).proxy_undecided,1);
  assert.deepEqual(validateSalesProxy({ proxy_agent:' 대리인 ', proxy_date:'2028-02-29' }), { proxy_agent:'대리인',proxy_date:'2028-02-29',proxy_undecided:0 });
});

test('오후 14시 KST부터 당일만 발송하고 지출결의 채널 우선순위를 따른다', () => {
  assert.equal(salesProxyDueDate(new Date('2026-10-23T04:59:00Z')),null);
  assert.equal(salesProxyDueDate(new Date('2026-10-23T05:00:00Z')),'2026-10-23');
  assert.equal(salesProxyDueDate(new Date('2026-10-23T14:59:00Z')),'2026-10-23');
  assert.equal(salesProxyDueDate(new Date('2026-10-23T15:00:00Z')),null);
  const expense='https://hooks.slack.com/services/test/expense';
  const accounting='https://hooks.slack.com/services/test/accounting';
  assert.equal(proxySlackWebhook({ SLACK_EXPENSE_RECEIPT_WEBHOOK_URL:expense, SLACK_ACCOUNTING_WEBHOOK_URL:accounting }),expense);
  assert.equal(proxySlackWebhook({ SLACK_ACCOUNTING_WEBHOOK_URL:accounting }),accounting);
  assert.equal(proxySlackWebhook({ SLACK_EXPENSE_RECEIPT_WEBHOOK_URL:'https://hooks.slack.com.evil.example/services/x' }),'');
});

test('요청한 Slack 필드와 해당 매출 월·행 링크를 제공하고 사용자 멘션을 이스케이프한다', () => {
  const message=renderSalesProxySlack({ id:'sale-id',user_name:'신청자',branch:'서초',department:'1팀',proxy_agent:'<!channel>',proxy_date:'2026-10-23',proxy_cost:120000,focus_date:'2026-09-01' });
  for (const label of ['신청자:','지사/부서:','대리인:','대리일:','금액: 120,000원','결재/확인:']) assert.ok(message.includes(label));
  assert.ok(message.includes('id=sale-id&month=2026-09'));
  assert.ok(!message.includes('<!channel>'));
});

test('기존 자료는 미정으로 보존, 대상 선별·반복 실행·동시 실행에서 중복 발송 방지', async () => {
  const { db,d1 }=setup();
  const originalFetch=globalThis.fetch;
  let calls=0;
  try {
    db.exec("INSERT INTO sales_records(id,type) VALUES('legacy','매수신청대리')");
    await Promise.all([ensureSalesProxySchema(d1),ensureSalesProxySchema(d1)]);
    assert.deepEqual(db.prepare("SELECT proxy_agent,proxy_date,proxy_undecided FROM sales_records WHERE id='legacy'").get(),{proxy_agent:'',proxy_date:'',proxy_undecided:1});
    for (const [id,status,date,unknown,type] of [
      ['due','pending','2026-10-23',0,'매수신청대리'],['unknown','pending','2026-10-23',1,'매수신청대리'],
      ['refund','refunded','2026-10-23',0,'매수신청대리'],['request','refund_requested','2026-10-23',0,'매수신청대리'],
      ['future','pending','2026-10-24',0,'매수신청대리'],['past','pending','2026-10-22',0,'매수신청대리'],['other','pending','2026-10-23',0,'계약'],
    ]) db.prepare(`INSERT INTO sales_records(id,user_id,type,branch,department,proxy_cost,status,direction,contract_date,proxy_agent,proxy_date,proxy_undecided)
      VALUES(?,'owner',?,'서초','1팀',100000,?,'income','2026-09-01','대리인',?,?)`).run(id,type,status,date,unknown);
    globalThis.fetch=async () => { calls++; return new Response('ok'); };
    const env={DB:d1,SLACK_ACCOUNTING_WEBHOOK_URL:'https://hooks.slack.com/services/test/accounting'};
    const now=new Date('2026-10-23T05:00:00Z');
    await Promise.all([sendDueSalesProxySlack(env,now),sendDueSalesProxySlack(env,now)]);
    await sendDueSalesProxySlack(env,now);
    assert.equal(calls,1);
    assert.deepEqual(db.prepare('SELECT sales_id,status FROM sales_proxy_slack_deliveries').all(),[{sales_id:'due',status:'sent'}]);
  } finally { globalThis.fetch=originalFetch; db.close(); }
});

test('웹훅 누락은 발송하지 않으며 명시적 실패는 재시도, 모호한 타임아웃은 중복방지를 위해 보류',async()=>{
  const {db,d1}=setup(); const originalFetch=globalThis.fetch;
  try {
    await ensureSalesProxySchema(d1);
    db.exec("INSERT INTO sales_records(id,user_id,type,branch,proxy_cost,status,direction,contract_date,proxy_agent,proxy_date,proxy_undecided) VALUES('x','owner','매수신청대리','부산',1000,'pending','income','2026-10-01','대리인','2026-10-23',0)");
    const now=new Date('2026-10-23T05:00:00Z'); const env={DB:d1,SLACK_ACCOUNTING_WEBHOOK_URL:'https://hooks.slack.com/services/test/accounting'};
    let calls=0;
    globalThis.fetch=async()=>{ calls++; return new Response('failed',{status:429}); };
    await sendDueSalesProxySlack({DB:d1},now); assert.equal(calls,0);
    await sendDueSalesProxySlack(env,now); assert.equal(calls,1);
    assert.equal((db.prepare('SELECT COUNT(*) n FROM sales_proxy_slack_deliveries').get() as {n:number}).n,0);
    globalThis.fetch=async()=>{calls++;throw Error('timeout');};
    await sendDueSalesProxySlack(env,now); await sendDueSalesProxySlack(env,now);
    assert.equal(calls,2);
    assert.equal((db.prepare('SELECT status FROM sales_proxy_slack_deliveries').get() as {status:string}).status,'uncertain');
  } finally {globalThis.fetch=originalFetch;db.close();}
});

test('등록·수정 API 검증과 권한, 예약 작업 연결 및 화면 구성',()=>{
  const route=readFileSync('src/worker/routes/sales.ts','utf8');
  assert.match(route,/validateSalesProxy\(body\)/);
  assert.match(route,/record.user_id !== actor.sub && !ACCOUNTING_ROLES.includes/);
  assert.match(route,/validateSalesProxy\(await c.req.json\(\)\)/);
  const cron=readFileSync('src/worker/index.ts','utf8');
  const frequent=cron.slice(cron.indexOf("if (cron === '*/30 * * * *')"),cron.indexOf("} else if (cron === '30 0 * * 1-5')"));
  assert.match(frequent,/sendDueSalesProxySlack\(env, scheduledAt\)/);
  const ui=readFileSync('src/react-app/pages/Sales.tsx','utf8');
  assert.match(ui,/SalesProxyFields value=\{formProxy\}/);
  assert.match(ui,/SalesProxyEditor/);
  assert.match(route,/PROXY_FINANCIAL_EDIT_ROLES/);
  assert.match(route,/매수신청대리 금액과 대리비용은 총무만 수정할 수 있습니다/);
  assert.match(ui,/canEditProxyFinancials/);
});

test('경매 스케줄 입찰결과 화면은 원형 대리입찰 선택과 대리인 필수 입력을 제공한다',()=>{
  const editor=readFileSync('src/react-app/components/AuctionBidResultEditor.tsx','utf8');
  const css=readFileSync('src/react-app/index.css','utf8');
  assert.match(editor,/auction-bid-proxy-circle/);
  assert.match(editor,/대리입찰 대리인을 입력해 주세요/);
  assert.match(editor,/bid_proxy: bidProxy/);
  assert.match(css,/\.auction-bid-proxy-circle\.checked/);
});
