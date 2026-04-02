import type { Signature, ApprovalStep } from '../types';

interface Props {
  signatures: Signature[];
  approvalSteps: ApprovalStep[];
  currentUserId?: string;
  currentUserRole?: string;
  docStatus: string;
  authorName?: string;
  onSign: (type: 'author' | 'approver') => void;
}

export default function ApprovalBar({ signatures, approvalSteps, currentUserId, currentUserRole, docStatus, authorName, onSign }: Props) {
  const authorSig = signatures[0] || null;
  const isAuthor = docStatus === 'draft' || docStatus === 'rejected';
  const authorSigned = signatures.some(s => s.user_id === currentUserId);

  // 동적 결재선: 작성자 + approval_steps
  const slots: { label: string; name?: string; status: 'empty' | 'signed' | 'approved' | 'rejected' | 'pending'; signature?: Signature; canSign: boolean }[] = [];

  // 1) 작성자 슬롯
  slots.push({
    label: '작성자',
    name: authorName,
    status: authorSig ? 'signed' : 'empty',
    signature: authorSig || undefined,
    canSign: isAuthor && !authorSigned,
  });

  // 2) 결재선 단계별 슬롯
  if (approvalSteps.length > 0) {
    for (const step of approvalSteps) {
      // 해당 step의 서명 찾기 (signatures에서 step의 approver_id 매칭)
      const stepSig = signatures.find(s => s.user_id === step.approver_id && signatures.indexOf(s) >= 1);

      // 내 차례인지 확인: 앞 단계가 모두 approved이고 이 단계가 pending이면
      const prevAllApproved = approvalSteps
        .filter(s => s.step_order < step.step_order)
        .every(s => s.status === 'approved');
      const isMyTurn = step.status === 'pending' && prevAllApproved &&
        step.approver_id === currentUserId && docStatus === 'submitted';

      // master/ceo는 pending 단계면 서명 가능
      const isSuperApprover = (currentUserRole === 'master' || currentUserRole === 'ceo' || currentUserRole === 'cc_ref') &&
        step.status === 'pending' && docStatus === 'submitted';

      slots.push({
        label: step.approver_name || `승인 ${step.step_order}`,
        name: step.approver_name,
        status: step.status === 'approved' ? 'approved' : step.status === 'rejected' ? 'rejected' : 'pending',
        signature: stepSig || undefined,
        canSign: isMyTurn || isSuperApprover,
      });
    }
  } else if (docStatus !== 'draft') {
    // 결재선 없는 레거시 문서: 기존 고정 슬롯 표시
    const isApprover = (docStatus === 'submitted' || docStatus === 'approved') &&
      ['master', 'ceo', 'cc_ref', 'admin', 'manager'].includes(currentUserRole || '');
    const alreadyApproved = signatures.find(s => s.user_id === currentUserId && signatures.indexOf(s) >= 1);

    slots.push({
      label: '승인자',
      status: signatures.length > 1 ? 'signed' : 'empty',
      signature: signatures[1] || undefined,
      canSign: isApprover && !alreadyApproved,
    });
  }

  return (
    <div className="approval-bar">
      <div className="approval-label">결재</div>
      <div className="approval-slots">
        {slots.map((slot, idx) => (
          <div key={idx} className={`approval-slot ${slot.status === 'approved' ? 'approval-slot-done' : ''} ${slot.status === 'rejected' ? 'approval-slot-rejected' : ''}`}>
            <div className="approval-slot-header">{slot.label}</div>
            <div className="approval-slot-body">
              {slot.signature ? (
                <>
                  <img src={slot.signature.signature_data} alt={`${slot.signature.user_name} 서명`} className="approval-slot-img" />
                  <div className="approval-slot-name">{slot.signature.user_name}</div>
                  <div className="approval-slot-date">{new Date(slot.signature.signed_at).toLocaleDateString('ko-KR')}</div>
                </>
              ) : slot.status === 'approved' ? (
                <div className="approval-slot-status" style={{ color: '#188038' }}>
                  <span style={{ fontSize: '1.2rem' }}>✓</span>
                  <div className="approval-slot-name">{slot.name}</div>
                </div>
              ) : slot.status === 'rejected' ? (
                <div className="approval-slot-status" style={{ color: '#d32f2f' }}>
                  <span style={{ fontSize: '1.2rem' }}>✕</span>
                  <div className="approval-slot-name">{slot.name}</div>
                </div>
              ) : (
                <div className="approval-slot-empty">
                  {slot.canSign && (
                    <button className="approval-sign-btn" onClick={() => onSign(idx === 0 ? 'author' : 'approver')}>
                      서명
                    </button>
                  )}
                </div>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
