import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import Database from 'better-sqlite3';
import {
  ALIMTALK_TEMPLATES,
  AlimtalkHttpError,
  type AlimtalkSendResponse,
  type sendAlimtalkByTemplate,
} from '../src/worker/alimtalk.ts';
import {
  EXPENSE_RECEIPT_RESULT_RELATED_TYPES,
  normalizeExpenseReceiptResultPhone,
  sendExpenseReceiptResultAlimtalk,
} from '../src/worker/lib/expense-receipt-result-alimtalk.ts';

type D1Statement = D1PreparedStatement & { run(): Promise<D1Result> };

function d1FromSqlite(sqlite: Database.Database): D1Database {
  const prepare = (sql: string, params: unknown[] = []): D1Statement => {
    const statement = sqlite.prepare(sql);
    return {
      bind: (...values: unknown[]) => prepare(sql, values),
      all: async <T>() => ({ results: statement.all(...params) as T[] }),
      first: async <T>() => (statement.get(...params) as T | undefined) || null,
      run: async () => {
        const result = statement.run(...params);
        return { success: true, meta: { changes: result.changes } } as unknown as D1Result;
      },
    } as D1Statement;
  };
  return {
    prepare: (sql: string) => prepare(sql),
    batch: async (statements: D1PreparedStatement[]) => {
      const results: D1Result[] = [];
      for (const statement of statements) results.push(await (statement as D1Statement).run());
      return results;
    },
  } as unknown as D1Database;
}

function acceptedResponse(phone = '01012345678'): AlimtalkSendResponse {
  return {
    requestId: 'request-1',
    requestTime: '2026-08-25T00:00:00Z',
    statusCode: '202',
    statusName: 'success',
    messages: [{
      messageId: 'message-1',
      to: phone,
      countryCode: '82',
      content: '',
      requestStatusCode: 'A000',
      requestStatusName: 'success',
      requestStatusDesc: '',
      messageStatusCode: '',
      messageStatusDesc: '',
      useSmsFailover: true,
    }],
  };
}

const baseInput = {
  action: 'approved' as const,
  documentId: 'receipt-1',
  approvalStepId: 'step-1',
  decisionDate: '2026-08-25',
  phone: '010-1234-5678',
};

test('expense2/expense3 are privacy-minimized, buttonless receipt result templates', () => {
  assert.equal(ALIMTALK_TEMPLATES.EXPENSE_RECEIPT_APPROVED.code, 'expense2');
  assert.deepEqual(ALIMTALK_TEMPLATES.EXPENSE_RECEIPT_APPROVED.variables, ['approve_date', 'link']);
  assert.match(ALIMTALK_TEMPLATES.EXPENSE_RECEIPT_APPROVED.content, /승인되었습니다/);
  assert.equal(ALIMTALK_TEMPLATES.EXPENSE_RECEIPT_REJECTED.code, 'expense3');
  assert.deepEqual(ALIMTALK_TEMPLATES.EXPENSE_RECEIPT_REJECTED.variables, ['reject_date', 'link']);
  assert.match(ALIMTALK_TEMPLATES.EXPENSE_RECEIPT_REJECTED.content, /반려 사유를 확인/);
  for (const template of [
    ALIMTALK_TEMPLATES.EXPENSE_RECEIPT_APPROVED,
    ALIMTALK_TEMPLATES.EXPENSE_RECEIPT_REJECTED,
  ]) {
    const placeholders = Array.from(template.content.matchAll(/#\{([^}]+)\}/g), (match) => match[1]);
    assert.deepEqual(placeholders.sort(), [...template.variables].sort());
  }
  const bodies = `${ALIMTALK_TEMPLATES.EXPENSE_RECEIPT_APPROVED.content}\n${ALIMTALK_TEMPLATES.EXPENSE_RECEIPT_REJECTED.content}`;
  assert.doesNotMatch(bodies, /신청자|작성자|금액|사용처|반려 사유:/);
});

test('receipt result phone accepts only a normalized Korean 010 mobile number', async () => {
  assert.equal(normalizeExpenseReceiptResultPhone('010-1234-5678'), '01012345678');
  assert.equal(normalizeExpenseReceiptResultPhone('02-1234-5678'), null);
  assert.equal(normalizeExpenseReceiptResultPhone('010-123-4567'), null);
  let calls = 0;
  const outcome = await sendExpenseReceiptResultAlimtalk(
    { DB: {} as D1Database },
    { ...baseInput, phone: '010-123-4567' },
    { send: (async () => { calls += 1; return acceptedResponse(); }) as typeof sendAlimtalkByTemplate },
  );
  assert.deepEqual(outcome, { status: 'skipped', reason: 'invalid_phone' });
  assert.equal(calls, 0);
});

test('only a confirmed immediate 3015 template rejection falls back with the same action event', async () => {
  const calls: Array<{ key: string; variables: Record<string, string>; options: Record<string, unknown> }> = [];
  const send = (async (_env: unknown, key: string, variables: Record<string, string>, _phones: string[], options: Record<string, unknown>) => {
    calls.push({ key, variables, options });
    if (key === 'EXPENSE_RECEIPT_APPROVED') {
      throw new AlimtalkHttpError(400, JSON.stringify({ statusCode: '3015', statusName: 'TemplateNotFoundException' }));
    }
    return acceptedResponse();
  }) as typeof sendAlimtalkByTemplate;

  const outcome = await sendExpenseReceiptResultAlimtalk(
    { DB: {} as D1Database }, baseInput, { send },
  );
  assert.deepEqual(outcome, { status: 'fallback' });
  assert.deepEqual(calls.map((call) => call.key), ['EXPENSE_RECEIPT_APPROVED', 'DOC_FINAL_APPROVED']);
  assert.equal(calls[0].options.relatedType, EXPENSE_RECEIPT_RESULT_RELATED_TYPES.approved);
  assert.equal(calls[0].options.relatedId, 'receipt-1:step-1');
  assert.equal(calls[0].options.dedupeAcrossTemplates, true);
  assert.deepEqual(calls[1].options, calls[0].options);
  assert.equal(calls[1].variables.doc_title, '영수증 첨부 지출결의서');
  assert.equal(calls[1].variables.approver_name, '결재담당자');
});

test('expense3 rejection success sends only privacy-minimized variables on the rejected action event', async () => {
  const calls: Array<{
    key: string;
    variables: Record<string, string>;
    phones: string[];
    options: Record<string, unknown>;
  }> = [];
  const send = (async (_env: unknown, key: string, variables: Record<string, string>, phones: string[], options: Record<string, unknown>) => {
    calls.push({ key, variables, phones, options });
    return acceptedResponse();
  }) as typeof sendAlimtalkByTemplate;
  const outcome = await sendExpenseReceiptResultAlimtalk(
    { DB: {} as D1Database },
    { ...baseInput, action: 'rejected', approvalStepId: 'reject-step' },
    { send },
  );
  assert.deepEqual(outcome, { status: 'dedicated' });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].key, 'EXPENSE_RECEIPT_REJECTED');
  assert.deepEqual(Object.keys(calls[0].variables).sort(), ['link', 'reject_date']);
  assert.deepEqual(calls[0].phones, ['01012345678']);
  assert.equal(calls[0].options.relatedType, EXPENSE_RECEIPT_RESULT_RELATED_TYPES.rejected);
  assert.equal(calls[0].options.relatedId, 'receipt-1:reject-step');
  assert.equal(calls[0].options.dedupeAcrossTemplates, true);
});

test('expense3 fallback uses a role-neutral decision maker label', async () => {
  const calls: Array<{ key: string; variables: Record<string, string> }> = [];
  const send = (async (_env: unknown, key: string, variables: Record<string, string>) => {
    calls.push({ key, variables });
    if (key === 'EXPENSE_RECEIPT_REJECTED') {
      throw new AlimtalkHttpError(400, JSON.stringify({
        statusCode: '3015', statusName: 'TemplateNotFoundException',
      }));
    }
    return acceptedResponse();
  }) as typeof sendAlimtalkByTemplate;
  const outcome = await sendExpenseReceiptResultAlimtalk(
    { DB: {} as D1Database },
    { ...baseInput, action: 'rejected', approvalStepId: 'reject-fallback-step' },
    { send },
  );
  assert.deepEqual(outcome, { status: 'fallback' });
  assert.deepEqual(calls.map((call) => call.key), ['EXPENSE_RECEIPT_REJECTED', 'DOC_REJECTED']);
  assert.equal(calls[1].variables.rejector_name, '결재담당자');
  assert.equal(calls[1].variables.reject_reason, '반려 사유는 문서에서 확인해주세요.');
});

test('timeouts, rate limits, server/network failures and content mismatch never trigger fallback', async (t) => {
  const cases: Array<[string, unknown]> = [
    ['408', new AlimtalkHttpError(408, '{"statusCode":"3015"}')],
    ['429', new AlimtalkHttpError(429, '{"statusCode":"3015"}')],
    ['500', new AlimtalkHttpError(500, '{"statusCode":"3015"}')],
    ['3016', new AlimtalkHttpError(400, '{"statusCode":"3016","statusName":"TemplateContentMismatchException"}')],
    ['network', new TypeError('network unavailable')],
  ];
  for (const [name, failure] of cases) {
    await t.test(name, async () => {
      let calls = 0;
      const send = (async () => { calls += 1; throw failure; }) as typeof sendAlimtalkByTemplate;
      await assert.rejects(sendExpenseReceiptResultAlimtalk(
        { DB: {} as D1Database }, baseInput, { send },
      ));
      assert.equal(calls, 1);
    });
  }
});

test('POST request failures are rejected and asynchronous delivery 3015 does not fall back', async (t) => {
  const responses: Array<[string, AlimtalkSendResponse]> = [
    ['request status', {
      ...acceptedResponse(),
      messages: [{ ...acceptedResponse().messages![0], requestStatusCode: 'A100', requestStatusName: 'fail' }],
    }],
    ['top-level status', { ...acceptedResponse(), statusCode: '400', statusName: 'fail' }],
    ['async delivery', {
      ...acceptedResponse(),
      messages: [{ ...acceptedResponse().messages![0], messageStatusCode: '3015', messageStatusDesc: 'TemplateNotFoundException' }],
    }],
  ];
  for (const [name, response] of responses) {
    await t.test(name, async () => {
      let calls = 0;
      const send = (async () => { calls += 1; return response; }) as typeof sendAlimtalkByTemplate;
      await assert.rejects(sendExpenseReceiptResultAlimtalk(
        { DB: {} as D1Database }, baseInput, { send },
      ));
      assert.equal(calls, 1);
    });
  }
});

test('an accepted generic fallback dedupes the next retry across template codes', async () => {
  const sqlite = new Database(':memory:');
  sqlite.exec('CREATE TABLE users (id TEXT PRIMARY KEY)');
  sqlite.exec(readFileSync('d1/migrate-alimtalk.sql', 'utf8'));
  const env = {
    DB: d1FromSqlite(sqlite),
    NCP_ACCESS_KEY: 'access',
    NCP_SECRET_KEY: 'secret',
    NCP_SERVICE_ID: 'service',
    NCP_KAKAO_CHANNEL_ID: '@channel',
  };
  const originalFetch = globalThis.fetch;
  const requestedCodes: string[] = [];
  try {
    globalThis.fetch = async (_input, init) => {
      const code = String(JSON.parse(String(init?.body || '{}')).templateCode || '');
      requestedCodes.push(code);
      if (code === 'expense2') {
        return new Response('{"statusCode":"3015","statusName":"TemplateNotFoundException"}', { status: 400 });
      }
      return new Response(JSON.stringify(acceptedResponse()), {
        status: 202,
        headers: { 'content-type': 'application/json' },
      });
    };

    assert.deepEqual(await sendExpenseReceiptResultAlimtalk(env, baseInput), { status: 'fallback' });
    assert.deepEqual(await sendExpenseReceiptResultAlimtalk(env, baseInput), {
      status: 'skipped', reason: 'already_sent_or_not_configured',
    });
    assert.deepEqual(requestedCodes, ['expense2', 'docfinal']);
    const logs = sqlite.prepare(`
      SELECT template_code, status, related_type, related_id, recipient_phone
      FROM alimtalk_logs ORDER BY created_at, rowid
    `).all() as Array<Record<string, unknown>>;
    assert.deepEqual(logs.map((row) => [row.template_code, row.status]), [
      ['expense2', 'failed'], ['docfinal', 'sent'],
    ]);
    assert.ok(logs.every((row) => row.related_type === EXPENSE_RECEIPT_RESULT_RELATED_TYPES.approved));
    assert.ok(logs.every((row) => row.related_id === 'receipt-1:step-1'));
    assert.ok(logs.every((row) => row.recipient_phone === '01012345678'));
  } finally {
    globalThis.fetch = originalFetch;
    sqlite.close();
  }
});

test('a top-level POST JSON failure is logged failed and remains retryable', async () => {
  const sqlite = new Database(':memory:');
  sqlite.exec('CREATE TABLE users (id TEXT PRIMARY KEY)');
  sqlite.exec(readFileSync('d1/migrate-alimtalk.sql', 'utf8'));
  const env = {
    DB: d1FromSqlite(sqlite),
    NCP_ACCESS_KEY: 'access',
    NCP_SECRET_KEY: 'secret',
    NCP_SERVICE_ID: 'service',
    NCP_KAKAO_CHANNEL_ID: '@channel',
  };
  const originalFetch = globalThis.fetch;
  let requests = 0;
  try {
    globalThis.fetch = async () => {
      requests += 1;
      return new Response(JSON.stringify({
        ...acceptedResponse(), statusCode: '400', statusName: 'fail', messages: [],
      }), { status: 202, headers: { 'content-type': 'application/json' } });
    };
    await assert.rejects(sendExpenseReceiptResultAlimtalk(env, baseInput));
    await assert.rejects(sendExpenseReceiptResultAlimtalk(env, baseInput));
    assert.equal(requests, 2);
    assert.deepEqual(
      (sqlite.prepare('SELECT status FROM alimtalk_logs ORDER BY rowid').all() as Array<{ status: string }>).map((row) => row.status),
      ['failed', 'failed'],
    );
  } finally {
    globalThis.fetch = originalFetch;
    sqlite.close();
  }
});

test('receipt result route keeps active freelancer authors eligible and uses the approval step event id', () => {
  const source = readFileSync('src/worker/routes/documents.ts', 'utf8');
  const sendAt = source.indexOf(
    'sendExpenseReceiptResultAlimtalk',
    source.indexOf("documents.post('/:id/approve'"),
  );
  const receiptApprove = source.slice(sendAt - 900, sendAt + 900);
  assert.match(receiptApprove, /approved = 1 AND role != 'resigned'/);
  assert.doesNotMatch(receiptApprove, /login_type/);
  assert.match(receiptApprove, /approvalStepId: result\.stepId/);
  assert.match(receiptApprove, /sendExpenseReceiptResultAlimtalk/);

  const rejectStart = source.indexOf("documents.post('/:id/reject'");
  const rejectSendAt = source.indexOf('sendExpenseReceiptResultAlimtalk', rejectStart);
  const receiptReject = source.slice(rejectSendAt - 900, rejectSendAt + 900);
  assert.match(receiptReject, /action: 'rejected'/);
  assert.match(receiptReject, /approvalStepId: result\.stepId/);
  assert.match(receiptReject, /approved = 1 AND role != 'resigned'/);
  assert.doesNotMatch(receiptReject, /login_type/);
});

test('the protected bulk test sender supplies every receipt template variable', () => {
  const source = readFileSync('src/worker/index.ts', 'utf8');
  assert.match(source, /EXPENSE_RECEIPT_SUBMITTED:\s*\{[\s\S]*?receipt_count:\s*'2'[\s\S]*?submit_date:[\s\S]*?link:/);
  assert.match(source, /EXPENSE_RECEIPT_APPROVED:\s*\{\s*approve_date:[\s\S]*?link:/);
  assert.match(source, /EXPENSE_RECEIPT_REJECTED:\s*\{\s*reject_date:[\s\S]*?link:/);
});
