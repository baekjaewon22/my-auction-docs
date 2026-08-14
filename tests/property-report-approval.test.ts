import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildPropertyReportApprovalChain,
  PROPERTY_REPORT_TEMPLATE_ID,
} from '../src/worker/lib/property-report-approval.ts';

type UserRow = { id: string; role: string; approved: number; login_type?: string | null };

function approvalDb(users: UserRow[]) {
  return {
    prepare(sql: string) {
      let bindings: unknown[] = [];
      return {
        bind(...values: unknown[]) {
          bindings = values;
          return this;
        },
        async first() {
          if (sql.includes('WHERE id = ?')) {
            return users.find((user) => user.id === bindings[0]) || null;
          }
          if (sql.includes("WHERE role = 'ceo'")) {
            return users
              .filter((user) => user.role === 'ceo'
                && user.approved === 1
                && user.id !== bindings[0]
                && user.login_type !== 'freelancer')
              .sort((a, b) => a.id.localeCompare(b.id))[0] || null;
          }
          return null;
        },
      };
    },
  } as unknown as D1Database;
}

test('물건분석보고서 템플릿은 조직도 중간 결재자를 제외하고 대표이사만 유지한다', async () => {
  const db = approvalDb([
    { id: 'manager', role: 'manager', approved: 1 },
    { id: 'branch-admin', role: 'admin', approved: 1 },
    { id: 'ceo-user', role: 'ceo', approved: 1 },
  ]);

  assert.equal(PROPERTY_REPORT_TEMPLATE_ID, 'tpl-work-008');
  assert.deepEqual(
    await buildPropertyReportApprovalChain(db, 'author', ['manager', 'branch-admin', 'ceo-user']),
    ['ceo-user'],
  );
});

test('조직도 결재선에 대표이사가 없으면 활성 대표이사 계정을 단일 결재자로 사용한다', async () => {
  const db = approvalDb([
    { id: 'branch-admin', role: 'admin', approved: 1 },
    { id: 'ceo-user', role: 'ceo', approved: 1, login_type: 'employee' },
  ]);

  assert.deepEqual(
    await buildPropertyReportApprovalChain(db, 'author', ['branch-admin']),
    ['ceo-user'],
  );
});

test('작성자 본인 또는 비활성·프리랜서 대표 계정은 결재자로 사용하지 않는다', async () => {
  const db = approvalDb([
    { id: 'author', role: 'ceo', approved: 1 },
    { id: 'disabled-ceo', role: 'ceo', approved: 0 },
    { id: 'freelancer-ceo', role: 'ceo', approved: 1, login_type: 'freelancer' },
  ]);

  assert.deepEqual(
    await buildPropertyReportApprovalChain(
      db,
      'author',
      ['author', 'disabled-ceo', 'freelancer-ceo'],
    ),
    [],
  );
});
