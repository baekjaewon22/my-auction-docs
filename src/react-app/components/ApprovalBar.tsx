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
  // Map signatures to slots by order
  // First signature = author, second = manager, third = director
  const slotData = SLOTS.map((slot, idx) => {
    const sig = signatures[idx] || null;
    return { ...slot, signature: sig };
  });

  const isAuthor = docStatus === 'draft' || docStatus === 'rejected';
  const isApprover = (docStatus === 'submitted' || docStatus === 'approved') &&
    ['master', 'ceo', 'admin', 'manager'].includes(currentUserRole || '');

  const authorSigned = signatures.some(s => s.user_id === currentUserId);

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
                  <img
                    src={slot.signature.signature_data}
                    alt={`${slot.signature.user_name} 서명`}
                    className="approval-slot-img"
                  />
                  <div className="approval-slot-name">{slot.signature.user_name}</div>
                  <div className="approval-slot-date">
                    {new Date(slot.signature.signed_at).toLocaleDateString('ko-KR')}
                  </div>
                </>
              ) : (
                <div className="approval-slot-empty">
                  {/* Author slot - show sign button for draft */}
                  {idx === 0 && isAuthor && !authorSigned && (
                    <button className="approval-sign-btn" onClick={() => onSign('author')}>
                      서명
                    </button>
                  )}
                  {/* Approver slots - show sign button for submitted docs */}
                  {idx > 0 && isApprover && !signatures.find(s => s.user_id === currentUserId && signatures.indexOf(s) >= 1) && (
                    <button className="approval-sign-btn" onClick={() => onSign('approver')}>
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
