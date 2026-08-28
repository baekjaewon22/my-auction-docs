import { EXPENSE_RECEIPT_TEMPLATE_ID } from '../../shared/expense-receipt.ts';
import type { JwtPayload } from '../types.ts';
import { canReadExpenseReceipt } from './expense-receipts.ts';

export type DriveDocumentAccessRow = {
  template_id?: string | null;
  author_id?: string | null;
  status?: string | null;
};

type DriveAccessUser = Pick<JwtPayload, 'sub' | 'role' | 'login_type' | 'auth_type'>;

export function isHumanDriveUser(user: DriveAccessUser): boolean {
  return user.auth_type === 'user' && !user.sub.startsWith('service-token:');
}

/**
 * Generic Drive documents retain the existing Drive-role policy. Expense
 * receipts additionally require a real signed-in user and their receipt read
 * scope; a service token's synthetic master/CEO/accountant role must never
 * grant access to receipt metadata or manual delivery.
 */
export function canAccessDriveDocument(user: DriveAccessUser, document: DriveDocumentAccessRow): boolean {
  if (document.template_id !== EXPENSE_RECEIPT_TEMPLATE_ID) return true;
  if (!isHumanDriveUser(user) || !document.author_id || !document.status) return false;
  return canReadExpenseReceipt(user, {
    author_id: document.author_id,
    status: document.status,
  });
}

export type DriveDocumentSqlAliases = {
  templateId?: string;
  authorId?: string;
  status?: string;
};

/**
 * SQL equivalent of canAccessDriveDocument for joined document rows. Role and
 * login type are trusted fresh values installed by authMiddleware.
 */
export function driveDocumentAccessSql(
  user: DriveAccessUser,
  aliases: DriveDocumentSqlAliases = {},
): { clause: string; bindings: Array<string> } {
  const templateId = aliases.templateId || 'd.template_id';
  const authorId = aliases.authorId || 'd.author_id';
  const status = aliases.status || 'd.status';
  const genericDocument = `COALESCE(${templateId}, '') != ?`;

  if (!isHumanDriveUser(user)) {
    return { clause: genericDocument, bindings: [EXPENSE_RECEIPT_TEMPLATE_ID] };
  }

  if (user.role === 'master') {
    return { clause: '1 = 1', bindings: [] };
  }

  const ownDocument = `${authorId} = ?`;
  const canReadAllCompletedReceipts = user.login_type !== 'freelancer'
    && ['ceo', 'accountant', 'accountant_asst'].includes(user.role);

  if (canReadAllCompletedReceipts) {
    return {
      clause: `(${genericDocument} OR (${ownDocument} OR ${status} != 'draft'))`,
      bindings: [EXPENSE_RECEIPT_TEMPLATE_ID, user.sub],
    };
  }

  return {
    clause: `(${genericDocument} OR ${ownDocument})`,
    bindings: [EXPENSE_RECEIPT_TEMPLATE_ID, user.sub],
  };
}
