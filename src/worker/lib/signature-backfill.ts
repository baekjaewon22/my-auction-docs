export interface SignatureBackfillActor {
  role: string;
  auth_type?: 'user' | 'service_token';
}

export const SIGNATURE_BACKFILL_CANDIDATES_SQL = `SELECT DISTINCT s.approver_id, s.document_id
 FROM approval_steps s
 INNER JOIN documents d ON d.id = s.document_id
 WHERE s.status = 'approved'
   AND COALESCE(d.template_id, '') != ?
   AND NOT EXISTS (
     SELECT 1 FROM signatures sig
     WHERE sig.document_id = s.document_id AND sig.user_id = s.approver_id
   )`;

export function canRunSignatureBackfill(
  actor: SignatureBackfillActor,
  isFreelancerView: boolean,
): boolean {
  return actor.auth_type === 'user' && actor.role === 'master' && !isFreelancerView;
}
