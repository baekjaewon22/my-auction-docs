export type SignatureKind = 'author' | 'approver';

export interface PendingSignatureStep {
  id: string;
  approver_id: string;
  step_order: number;
  approver_role: string;
}

interface SignaturePolicyInput {
  userId: string;
  userRole: string;
  documentAuthorId: string;
  documentStatus: string;
  signatureType: SignatureKind;
  isCeoStamp: boolean;
  stepId?: string;
  pendingSteps: PendingSignatureStep[];
  totalStepCount: number;
}

type SignaturePolicyDecision =
  | { allowed: true }
  | { allowed: false; status: 400 | 403 | 404 | 409; error: string };

const PROXY_ROLES = new Set(['master', 'ceo', 'cc_ref', 'admin', 'accountant']);
const LEGACY_APPROVER_ROLES = new Set(['master', 'ceo', 'cc_ref', 'admin', 'manager', 'accountant']);

export function canProxyApproval(role: string): boolean {
  return PROXY_ROLES.has(role);
}

export function evaluateSignaturePolicy(input: SignaturePolicyInput): SignaturePolicyDecision {
  if (input.signatureType === 'author') {
    if (input.isCeoStamp) return { allowed: false, status: 400, error: '대표 직인은 작성자 서명으로 사용할 수 없습니다.' };
    if (input.documentAuthorId !== input.userId) return { allowed: false, status: 403, error: '작성자만 작성자 서명을 할 수 있습니다.' };
    if (!['draft', 'rejected'].includes(input.documentStatus)) {
      return { allowed: false, status: 400, error: '작성 중이거나 반려된 문서에만 작성자 서명을 할 수 있습니다.' };
    }
    return { allowed: true };
  }

  if (input.documentStatus !== 'submitted') {
    return { allowed: false, status: 400, error: '제출된 문서만 결재 서명할 수 있습니다.' };
  }

  if (input.pendingSteps.length > 0) {
    const targetStep = input.stepId
      ? input.pendingSteps.find((step) => step.id === input.stepId)
      : input.pendingSteps.find((step) => step.approver_id === input.userId)
        ?? (canProxyApproval(input.userRole) ? input.pendingSteps[0] : undefined);
    if (!targetStep) return { allowed: false, status: 403, error: '승인 대기 중인 본인 결재 단계를 찾을 수 없습니다.' };
    if (targetStep.approver_id !== input.userId && !canProxyApproval(input.userRole)) {
      return { allowed: false, status: 403, error: '해당 결재 단계에 서명할 권한이 없습니다.' };
    }
    if (input.pendingSteps[0].id !== targetStep.id) {
      return { allowed: false, status: 400, error: '이전 단계 승인이 완료되지 않았습니다.' };
    }
    if (input.isCeoStamp && (!canProxyApproval(input.userRole) || targetStep.approver_role !== 'ceo')) {
      return { allowed: false, status: 403, error: '대표 직인은 대표 결재 단계에서만 사용할 수 있습니다.' };
    }
    return { allowed: true };
  }

  if (input.totalStepCount > 0) return { allowed: false, status: 409, error: '승인 대기 중인 결재 단계가 없습니다.' };
  if (!LEGACY_APPROVER_ROLES.has(input.userRole)) return { allowed: false, status: 403, error: '결재 서명 권한이 없습니다.' };
  if (input.stepId) return { allowed: false, status: 404, error: '승인 대기 중인 결재 단계를 찾을 수 없습니다.' };
  if (input.isCeoStamp && input.userRole !== 'ceo') {
    return { allowed: false, status: 403, error: '대표 결재 단계가 없는 문서에는 대표 직인을 사용할 수 없습니다.' };
  }
  return { allowed: true };
}
