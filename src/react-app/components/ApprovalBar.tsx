import type { Signature } from '../types';

interface Props {
  signatures: Signature[];
  currentUserId?: string;
  currentUserRole?: string;
  docStatus: string;
  onSign: (type: 'author' | 'approver') => void;
}

const SLOTS = [
  { key: 'author', label: '작성자' },
  { key: 'manager', label: '팀장' },
  { key: 'director', label: '대표' },
];

export default function ApprovalBar({ signatures, currentUserId, currentUserRole, docStatus, onSign }: Props) {
  const slotData = SLOTS.map((slot, idx) => {
    const sig = signatures[idx] || null;
    return { ...slot, signature: sig };
  });

  const isAuthor = docStatus === 'draft' || docStatus === 'rejected';
  const isApprover = (docStatus === 'submitted' || docStatus === 'approved') &&
    ['master', 'ceo', 'admin', 'manager'].includes(currentUserRole || '');

  const authorSigned = signatures.some(s => s.user_id === currentUserId);
  const alreadyApproved = signatures.find(s => s.user_id === currentUserId && signatures.indexOf(s) >= 1);

  // 관리자(admin)는 대표(director) 슬롯에도 서명 가능
  const canSignSlot = (idx: number) => {
    if (idx === 0) return isAuthor && !authorSigned;
    if (!isApprover || alreadyApproved) return false;
    if (idx === 1) return ['master', 'ceo', 'admin', 'manager'].includes(currentUserRole || '');
    if (idx === 2) return ['master', 'ceo', 'admin'].includes(currentUserRole || ''); // 관리자도 대표란 서명 가능
    return false;
  };

  return (
    <div className="approval-bar">
      <div className="approval-label">결재</div>
      <div className="approval-slots">
        {slotData.map((slot, idx) => (
          <div key={slot.key} className="approval-slot">
            <div className="approval-slot-header">{slot.label}</div>
            <div className="approval-slot-body">
              {slot.signature ? (
                <>
                  <img src={slot.signature.signature_data} alt={`${slot.signature.user_name} 서명`} className="approval-slot-img" />
                  <div className="approval-slot-name">{slot.signature.user_name}</div>
                  <div className="approval-slot-date">{new Date(slot.signature.signed_at).toLocaleDateString('ko-KR')}</div>
                </>
              ) : (
                <div className="approval-slot-empty">
                  {canSignSlot(idx) && (
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
