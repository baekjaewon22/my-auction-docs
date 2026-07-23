import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluateSignaturePolicy, type PendingSignatureStep } from '../src/shared/signature-policy.ts';

const steps: PendingSignatureStep[] = [
  { id: 'step-1', approver_id: 'first', step_order: 1, approver_role: 'manager' },
  { id: 'step-2', approver_id: 'second', step_order: 2, approver_role: 'manager' },
  { id: 'step-ceo', approver_id: 'ceo', step_order: 3, approver_role: 'ceo' },
];

const base = {
  userId: 'author',
  userRole: 'member',
  documentAuthorId: 'author',
  documentStatus: 'draft',
  signatureType: 'author' as const,
  isCeoStamp: false,
  pendingSteps: [] as PendingSignatureStep[],
  totalStepCount: 0,
};

test('only the author can add an author signature while the document is editable', () => {
  assert.equal(evaluateSignaturePolicy(base).allowed, true);
  assert.equal(evaluateSignaturePolicy({ ...base, userId: 'outsider' }).allowed, false);
  assert.equal(evaluateSignaturePolicy({ ...base, documentStatus: 'submitted' }).allowed, false);
  assert.equal(evaluateSignaturePolicy({ ...base, isCeoStamp: true }).allowed, false);
});

test('an approver cannot skip an earlier pending step', () => {
  const decision = evaluateSignaturePolicy({
    ...base,
    userId: 'second',
    userRole: 'manager',
    documentStatus: 'submitted',
    signatureType: 'approver',
    stepId: 'step-2',
    pendingSteps: steps,
    totalStepCount: steps.length,
  });
  assert.equal(decision.allowed, false);
  if (!decision.allowed) assert.equal(decision.status, 400);
});

test('the current approver and an authorized proxy can sign only the head step', () => {
  assert.equal(evaluateSignaturePolicy({
    ...base,
    userId: 'first', userRole: 'manager', documentStatus: 'submitted', signatureType: 'approver',
    stepId: 'step-1', pendingSteps: steps, totalStepCount: steps.length,
  }).allowed, true);
  assert.equal(evaluateSignaturePolicy({
    ...base,
    userId: 'master', userRole: 'master', documentStatus: 'submitted', signatureType: 'approver',
    stepId: 'step-1', pendingSteps: steps, totalStepCount: steps.length,
  }).allowed, true);
});

test('the CEO stamp is accepted only for the CEO step when it becomes current', () => {
  assert.equal(evaluateSignaturePolicy({
    ...base,
    userId: 'master', userRole: 'master', documentStatus: 'submitted', signatureType: 'approver',
    isCeoStamp: true, stepId: 'step-1', pendingSteps: steps, totalStepCount: steps.length,
  }).allowed, false);
  assert.equal(evaluateSignaturePolicy({
    ...base,
    userId: 'master', userRole: 'master', documentStatus: 'submitted', signatureType: 'approver',
    isCeoStamp: true, stepId: 'step-ceo', pendingSteps: [steps[2]], totalStepCount: steps.length,
  }).allowed, true);
});

test('a submitted workflow with no pending steps cannot receive another signature', () => {
  const decision = evaluateSignaturePolicy({
    ...base,
    userId: 'master', userRole: 'master', documentStatus: 'submitted', signatureType: 'approver',
    pendingSteps: [], totalStepCount: 3,
  });
  assert.equal(decision.allowed, false);
  if (!decision.allowed) assert.equal(decision.status, 409);
});
