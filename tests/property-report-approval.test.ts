import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {
  buildPropertyReportApprovalChain,
  PROPERTY_REPORT_APPROVERS,
  PROPERTY_REPORT_TEMPLATE_ID,
} from '../src/worker/lib/property-report-approval.ts';

type UserRow = {
  id: string;
  name: string;
  role: string;
  approved: number;
  login_type?: string | null;
};

function approvalDb(users: UserRow[]) {
  return {
    prepare() {
      let bindings: unknown[] = [];
      return {
        bind(...values: unknown[]) {
          bindings = values;
          return this;
        },
        async first() {
          const [name, role] = bindings;
          return users
            .filter((user) => user.name === name
              && user.role === role
              && user.approved === 1
              && user.login_type !== 'freelancer')
            .sort((a, b) => a.id.localeCompare(b.id))[0] || null;
        },
      };
    },
  } as unknown as D1Database;
}

const configuredUsers: UserRow[] = [
  { id: 'minho', name: '정민호', role: 'admin', approved: 1, login_type: 'employee' },
  { id: 'seongheon', name: '진성헌', role: 'admin', approved: 1, login_type: 'employee' },
  { id: 'jeongsu', name: '서정수', role: 'director', approved: 1, login_type: 'employee' },
  { id: 'ceo', name: '이재성', role: 'ceo', approved: 1, login_type: 'employee' },
];

test('물건분석보고서는 네 지사의 지정 관리자를 단일 실제 결재자로 사용한다', async () => {
  const db = approvalDb(configuredUsers);

  assert.equal(PROPERTY_REPORT_TEMPLATE_ID, 'tpl-work-008');
  assert.deepEqual(PROPERTY_REPORT_APPROVERS, {
    '의정부본사': { name: '정민호', role: 'admin' },
    '대전지사': { name: '진성헌', role: 'admin' },
    '서초지사': { name: '진성헌', role: 'admin' },
    '부산지사': { name: '서정수', role: 'director' },
  });
  assert.deepEqual(await buildPropertyReportApprovalChain(db, '의정부지사'), ['minho']);
  assert.deepEqual(await buildPropertyReportApprovalChain(db, '대전'), ['seongheon']);
  assert.deepEqual(await buildPropertyReportApprovalChain(db, '서초지사'), ['seongheon']);
  assert.deepEqual(await buildPropertyReportApprovalChain(db, '부산'), ['jeongsu']);
});

test('지정되지 않은 지사 또는 비활성·프리랜서 관리자는 결재선을 만들지 않는다', async () => {
  assert.deepEqual(await buildPropertyReportApprovalChain(approvalDb(configuredUsers), '본사 관리'), []);
  assert.deepEqual(await buildPropertyReportApprovalChain(approvalDb([
    { id: 'minho', name: '정민호', role: 'admin', approved: 0 },
  ]), '의정부본사'), []);
  assert.deepEqual(await buildPropertyReportApprovalChain(approvalDb([
    { id: 'seongheon', name: '진성헌', role: 'admin', approved: 1, login_type: 'freelancer' },
  ]), '대전지사'), []);
});

test('지정 관리자만 승인하고 완료 시 그 관리자 명의로 대표 직인을 기록한다', () => {
  const source = readFileSync('src/worker/routes/documents.ts', 'utf8');
  assert.match(source, /PROPERTY_REPORT_TEMPLATE_ID[\s\S]*?assigned\.approver_id !== user\.sub/);
  assert.match(source, /property-report-stamp-[\s\S]*?'\/LNCstemp\.png'[\s\S]*?branch-manager-representative-stamp/);
});
