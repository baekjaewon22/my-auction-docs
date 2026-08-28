import { Hono } from 'hono';
import type { AuthEnv, DocStatus } from '../types';
import { authMiddleware, requireHumanUser } from '../middleware/auth';
import { ensureExpenseReceiptApprovalSchema } from '../lib/expense-receipt-approval';
import {
  EXPENSE_RECEIPT_TEMPLATE_ID,
  MAX_EXPENSE_RECEIPT_FILES,
  MAX_EXPENSE_RECEIPT_FILE_BYTES,
  MAX_EXPENSE_RECEIPT_TOTAL_BYTES,
  MAX_EXPENSE_RECEIPT_TOTAL_PIXELS,
  acquireExpenseReceiptAttachmentMutationClaim,
  canEditExpenseReceipt,
  canReadExpenseReceipt,
  deleteExpenseReceiptR2ObjectsOrQueue,
  ensureExpenseReceiptSchema,
  expenseReceiptImageDimensions,
  hasExpenseReceiptImageContainer,
  expenseReceiptObjectKey,
  listActiveExpenseReceiptAttachments,
  releaseExpenseReceiptAttachmentMutationClaim,
  safeExpenseReceiptFileName,
  sha256Hex,
  sniffExpenseReceiptImage,
  type ExpenseReceiptAttachment,
} from '../lib/expense-receipts';

const expenseReceipts = new Hono<AuthEnv>();
expenseReceipts.use('*', authMiddleware, requireHumanUser());
expenseReceipts.use('*', async (c, next) => {
  await ensureExpenseReceiptSchema(c.env.DB);
  await ensureExpenseReceiptApprovalSchema(c.env.DB);
  await next();
});

const FULL_READ_ROLES = new Set(['master', 'ceo', 'accountant', 'accountant_asst']);

type ReceiptDocument = {
  id: string;
  title: string;
  content: string;
  template_id: string | null;
  author_id: string;
  author_name: string;
  branch: string;
  department: string;
  status: DocStatus;
  cancel_requested: number;
  cancel_reason: string;
  cancelled: number;
  created_at: string;
  updated_at: string;
};

type ReceiptArtifact = {
  object_key: string | null;
  file_name: string;
  file_size: number;
  drive_file_id: string;
  drive_folder_path: string;
  drive_backed_up_at: string | null;
  purged_at: string | null;
};

async function findReceiptDocument(db: D1Database, documentId: string): Promise<ReceiptDocument | null> {
  return await db.prepare(`SELECT d.id, d.title, d.content, d.template_id, d.author_id,
      COALESCE(u.name, '') AS author_name, d.branch, d.department, d.status,
      COALESCE(d.cancel_requested, 0) AS cancel_requested,
      COALESCE(d.cancel_reason, '') AS cancel_reason,
      COALESCE(d.cancelled, 0) AS cancelled,
      d.created_at, d.updated_at
    FROM documents d LEFT JOIN users u ON u.id=d.author_id
    WHERE d.id=? AND d.template_id=? LIMIT 1`)
    .bind(documentId, EXPENSE_RECEIPT_TEMPLATE_ID).first<ReceiptDocument>() || null;
}

function attachmentResponse(documentId: string, attachment: ExpenseReceiptAttachment) {
  return {
    id: attachment.id,
    file_name: attachment.file_name,
    file_type: attachment.file_type,
    file_size: Number(attachment.file_size || 0),
    sha256: attachment.sha256,
    sort_order: Number(attachment.sort_order || 0),
    created_at: attachment.created_at,
    preview_url: `/api/expense-receipts/${encodeURIComponent(documentId)}/attachments/${encodeURIComponent(attachment.id)}/content`,
  };
}

async function activeAttachmentResponse(db: D1Database, documentId: string) {
  return (await listActiveExpenseReceiptAttachments(db, documentId))
    .map((attachment) => attachmentResponse(documentId, attachment));
}

function extensionForMime(mime: string): string {
  if (mime === 'image/jpeg') return '.jpg';
  if (mime === 'image/png') return '.png';
  return '.webp';
}

function normalizedImageName(originalName: string, mime: string): string {
  const safe = safeExpenseReceiptFileName(originalName).replace(/\.[^.]+$/, '');
  return `${safe || 'receipt'}${extensionForMime(mime)}`;
}

function isHeic(file: File): boolean {
  return /image\/(heic|heif)/i.test(file.type) || /\.(heic|heif)$/i.test(file.name);
}

function isExpenseReceiptEditConflict(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error || '');
  return message.includes('expense receipt document is not editable')
    || message.includes('expense receipt attachment mutation is locked');
}

async function releaseAttachmentMutationClaim(
  db: D1Database,
  documentId: string,
  claimToken: string,
): Promise<void> {
  await releaseExpenseReceiptAttachmentMutationClaim(db, documentId, claimToken).catch((error) => {
    console.error('Expense receipt attachment mutation claim release failed:', error);
  });
}

async function getApprovalSummary(db: D1Database, documentId: string) {
  const action = await db.prepare(`SELECT actual_actor_id, actual_actor_name, actual_actor_role, action, created_at
    FROM expense_receipt_approval_actions WHERE document_id=?
    ORDER BY created_at DESC LIMIT 1`).bind(documentId).first<{
      actual_actor_id: string;
      actual_actor_name: string;
      actual_actor_role: string;
      action: 'approved' | 'rejected';
      created_at: string;
    }>().catch(() => null);
  const fallback = action?.action === 'approved' ? null : await db.prepare(`SELECT MAX(signed_at) AS approved_at
    FROM approval_steps WHERE document_id=? AND status='approved'`).bind(documentId)
    .first<{ approved_at: string | null }>();
  return {
    approved_at: action?.action === 'approved' ? action.created_at : (fallback?.approved_at || null),
    actual_approver_id: action?.action === 'approved' ? action.actual_actor_id : null,
    actual_approver_name: action?.action === 'approved' ? action.actual_actor_name : '',
    actual_approver_role: action?.action === 'approved' ? action.actual_actor_role : '',
  };
}

expenseReceipts.get('/:documentId', async (c) => {
  await ensureExpenseReceiptSchema(c.env.DB);
  const documentId = c.req.param('documentId');
  const document = await findReceiptDocument(c.env.DB, documentId);
  if (!document) return c.json({ error: '영수증 첨부 지출결의서를 찾을 수 없습니다.' }, 404);
  if (!canReadExpenseReceipt(c.get('user'), document)) return c.json({ error: '이 문서를 열람할 권한이 없습니다.' }, 403);

  const [attachments, artifact, driveLog, approval] = await Promise.all([
    activeAttachmentResponse(c.env.DB, documentId),
    c.env.DB.prepare(`SELECT object_key, file_name, file_size, drive_file_id, drive_folder_path,
      drive_backed_up_at, purged_at FROM expense_receipt_pdf_artifacts WHERE document_id=?`)
      .bind(documentId).first<ReceiptArtifact>(),
    c.env.DB.prepare(`SELECT status, COALESCE(error_message, '') AS error_message
      FROM drive_backup_logs WHERE document_id=? ORDER BY run_at DESC, created_at DESC LIMIT 1`)
      .bind(documentId).first<{ status: 'success' | 'failed'; error_message: string }>().catch(() => null),
    getApprovalSummary(c.env.DB, documentId),
  ]);
  const sitePurged = !!artifact?.purged_at;
  const approvedAtMs = approval.approved_at ? Date.parse(approval.approved_at) : Number.NaN;
  return c.json({
    document_id: documentId,
    status: document.status,
    cancel_requested: Number(document.cancel_requested || 0),
    cancel_reason: document.cancel_reason || '',
    cancelled: Number(document.cancelled || 0),
    attachments,
    artifact: artifact ? {
      file_name: artifact.file_name,
      file_size: Number(artifact.file_size || 0),
      drive_file_id: artifact.drive_file_id,
      drive_folder_path: artifact.drive_folder_path,
      drive_backed_up_at: artifact.drive_backed_up_at,
      purged_at: artifact.purged_at,
      download_url: artifact.object_key && !artifact.purged_at
        ? `/api/expense-receipts/${encodeURIComponent(documentId)}/pdf`
        : '',
    } : null,
    drive_status: driveLog?.status || 'pending',
    drive_error: driveLog?.error_message || '',
    ...approval,
    site_purged: sitePurged,
    retention_eligible_at: Number.isFinite(approvedAtMs)
      ? new Date(approvedAtMs + 30 * 86_400_000).toISOString()
      : null,
  });
});

expenseReceipts.get('/', async (c) => {
  await ensureExpenseReceiptSchema(c.env.DB);
  const user = c.get('user');
  const pageInput = Number(c.req.query('page') || 1);
  const pageSizeInput = Number(c.req.query('page_size') || 20);
  const page = Number.isFinite(pageInput) && pageInput > 0 ? Math.floor(pageInput) : 1;
  const pageSize = Number.isFinite(pageSizeInput) && pageSizeInput > 0
    ? Math.min(100, Math.floor(pageSizeInput))
    : 20;
  const conditions = ['d.template_id=?'];
  const params: Array<string | number> = [EXPENSE_RECEIPT_TEMPLATE_ID];
  const hasFullRead = user.role === 'master'
    || (user.login_type !== 'freelancer' && FULL_READ_ROLES.has(user.role));
  if (!hasFullRead) {
    conditions.push('d.author_id=?');
    params.push(user.sub);
  } else if (user.role !== 'master') {
    conditions.push("(d.status!='draft' OR d.author_id=?)");
    params.push(user.sub);
  }
  const status = c.req.query('status');
  if (status === 'cancelled') {
    conditions.push('COALESCE(d.cancelled,0)=1');
  } else if (status === 'cancel_requested') {
    conditions.push('COALESCE(d.cancelled,0)=0 AND COALESCE(d.cancel_requested,0)=1');
  } else if (status && ['draft', 'submitted', 'approved', 'rejected'].includes(status)) {
    conditions.push('d.status=? AND COALESCE(d.cancelled,0)=0 AND COALESCE(d.cancel_requested,0)=0');
    params.push(status);
  }
  const month = c.req.query('month');
  if (month && /^\d{4}-\d{2}$/.test(month)) {
    conditions.push("substr(datetime(d.created_at,'+9 hours'),1,7)=?");
    params.push(month);
  }
  for (const [queryKey, column] of [['branch', 'd.branch'], ['author', 'u.name']] as const) {
    const value = c.req.query(queryKey)?.trim();
    if (value) {
      conditions.push(`${column} LIKE ?`);
      params.push(`%${value}%`);
    }
  }
  const search = c.req.query('search')?.trim();
  if (search) {
    conditions.push('(d.title LIKE ? OR u.name LIKE ? OR d.department LIKE ?)');
    params.push(`%${search}%`, `%${search}%`, `%${search}%`);
  }
  const where = conditions.join(' AND ');
  const total = await c.env.DB.prepare(`SELECT COUNT(*) AS count FROM documents d
    LEFT JOIN users u ON u.id=d.author_id WHERE ${where}`).bind(...params).first<{ count: number }>();
  const rows = await c.env.DB.prepare(`SELECT d.id AS document_id, d.title, d.status,
      COALESCE(d.cancel_requested,0) AS cancel_requested,
      COALESCE(d.cancel_reason,'') AS cancel_reason,
      COALESCE(d.cancelled,0) AS cancelled,
      d.author_id,
      COALESCE(u.name,'') AS author_name, d.branch, d.department, d.created_at, d.updated_at,
      COALESCE(a.attachment_count,0) AS attachment_count, COALESCE(a.total_file_size,0) AS total_file_size,
      CASE WHEN aa.action='approved' THEN aa.created_at ELSE NULL END AS approved_at,
      CASE WHEN aa.action='approved' THEN aa.actual_actor_id ELSE NULL END AS actual_approver_id,
      CASE WHEN aa.action='approved' THEN aa.actual_actor_name ELSE '' END AS actual_approver_name,
      CASE WHEN aa.action='approved' THEN aa.actual_actor_role ELSE '' END AS actual_approver_role,
      COALESCE(d.reject_reason,'') AS reject_reason,
      COALESCE(aa.action,'') AS last_action,
      COALESCE(aa.actual_actor_name,'') AS last_actor_name,
      COALESCE(aa.actual_actor_role,'') AS last_actor_role,
      COALESCE(aa.comment,'') AS last_action_comment,
      aa.created_at AS last_action_at,
      COALESCE(bl.status,'pending') AS drive_status, p.drive_file_id, p.drive_backed_up_at,
      CASE WHEN p.object_key IS NOT NULL AND p.object_key!='' AND p.purged_at IS NULL THEN 1 ELSE 0 END AS pdf_available,
      CASE WHEN p.purged_at IS NULL THEN 0 ELSE 1 END AS site_purged
    FROM documents d LEFT JOIN users u ON u.id=d.author_id
    LEFT JOIN (SELECT document_id, COUNT(*) AS attachment_count, SUM(file_size) AS total_file_size
      FROM expense_receipt_attachments WHERE deleted_at IS NULL GROUP BY document_id) a ON a.document_id=d.id
    LEFT JOIN expense_receipt_pdf_artifacts p ON p.document_id=d.id
    LEFT JOIN expense_receipt_approval_actions aa ON aa.id=(SELECT id FROM expense_receipt_approval_actions
      WHERE document_id=d.id ORDER BY created_at DESC LIMIT 1)
    LEFT JOIN drive_backup_logs bl ON bl.id=(SELECT id FROM drive_backup_logs
      WHERE document_id=d.id ORDER BY run_at DESC, created_at DESC LIMIT 1)
    WHERE ${where} ORDER BY d.created_at DESC LIMIT ? OFFSET ?`)
    .bind(...params, pageSize, (page - 1) * pageSize).all();
  return c.json({ items: rows.results || [], total: Number(total?.count || 0), page, page_size: pageSize });
});

expenseReceipts.post('/:documentId/attachments', async (c) => {
  await ensureExpenseReceiptSchema(c.env.DB);
  if (!c.env.ARTICLE_BUCKET) return c.json({ error: '영수증 이미지 저장소가 설정되지 않았습니다.' }, 503);
  const documentId = c.req.param('documentId');
  const document = await findReceiptDocument(c.env.DB, documentId);
  if (!document) return c.json({ error: '영수증 첨부 지출결의서를 찾을 수 없습니다.' }, 404);
  if (!canEditExpenseReceipt(c.get('user'), document)) return c.json({ error: '초안 또는 반려 문서의 작성자만 영수증을 편집할 수 있습니다.' }, 403);
  const contentLength = Number(c.req.header('Content-Length') || 0);
  if (contentLength > MAX_EXPENSE_RECEIPT_TOTAL_BYTES + 2 * 1024 * 1024) {
    return c.json({ error: '영수증 첨부 요청 전체 크기가 허용 범위를 넘었습니다.' }, 413);
  }
  const form = await c.req.formData().catch(() => null);
  if (!form) return c.json({ error: 'multipart/form-data 형식으로 이미지를 첨부해 주세요.' }, 400);
  const files = form.getAll('files').filter((entry): entry is File => entry instanceof File && entry.size > 0);
  if (files.length === 0) return c.json({ error: '첨부할 영수증 이미지를 선택해 주세요.' }, 400);

  const claimToken = await acquireExpenseReceiptAttachmentMutationClaim(c.env.DB, documentId);
  if (!claimToken) {
    return c.json({ error: '다른 제출·서명·삭제 또는 첨부 변경 작업이 진행 중입니다. 잠시 후 다시 시도해 주세요.' }, 409);
  }
  try {
  const existing = await listActiveExpenseReceiptAttachments(c.env.DB, documentId);
  if (existing.length + files.length > MAX_EXPENSE_RECEIPT_FILES) {
    return c.json({ error: `영수증은 문서당 최대 ${MAX_EXPENSE_RECEIPT_FILES}장까지 첨부할 수 있습니다.` }, 400);
  }
  const existingBytes = existing.reduce((sum, item) => sum + Number(item.file_size || 0), 0);
  const incomingBytes = files.reduce((sum, file) => sum + file.size, 0);
  if (incomingBytes + existingBytes > MAX_EXPENSE_RECEIPT_TOTAL_BYTES) {
    return c.json({ error: '영수증 전체 용량은 문서당 40MB를 넘을 수 없습니다.' }, 413);
  }

  const prepared: Array<{ id: string; key: string; name: string; mime: string; size: number; width: number; height: number; sha: string; bytes: ArrayBuffer }> = [];
  const knownHashes = new Set(existing.map((item) => item.sha256).filter(Boolean));
  let totalPixels = existing.reduce(
    (sum, item) => sum + Number(item.image_width || 0) * Number(item.image_height || 0),
    0,
  );
  for (const file of files) {
    if (file.size > MAX_EXPENSE_RECEIPT_FILE_BYTES) return c.json({ error: `${file.name}: 파일 하나는 10MB를 넘을 수 없습니다.` }, 413);
    if (isHeic(file)) return c.json({ error: `${file.name}: HEIC/HEIF는 서버에서 지원하지 않습니다. 휴대폰에서 JPG, PNG 또는 WEBP로 변환한 뒤 다시 첨부해 주세요.` }, 415);
    const bytes = await file.arrayBuffer();
    const mime = sniffExpenseReceiptImage(new Uint8Array(bytes));
    if (!mime) return c.json({ error: `${file.name}: 실제 파일 내용이 JPG, PNG 또는 WEBP 이미지가 아닙니다.` }, 415);
    if (!hasExpenseReceiptImageContainer(new Uint8Array(bytes), mime)) {
      return c.json({ error: `${file.name}: 이미지 파일이 손상되었거나 끝까지 업로드되지 않았습니다.` }, 415);
    }
    const dimensions = expenseReceiptImageDimensions(new Uint8Array(bytes), mime);
    if (!dimensions) return c.json({ error: `${file.name}: 손상되었거나 크기 정보를 확인할 수 없는 이미지입니다.` }, 415);
    if (dimensions.width > 16_000 || dimensions.height > 16_000 || dimensions.width * dimensions.height > 60_000_000) {
      return c.json({ error: `${file.name}: 이미지 해상도가 너무 큽니다. 6천만 화소 이하로 줄인 뒤 첨부해 주세요.` }, 413);
    }
    totalPixels += dimensions.width * dimensions.height;
    if (totalPixels > MAX_EXPENSE_RECEIPT_TOTAL_PIXELS) {
      return c.json({ error: '첨부 이미지의 전체 해상도가 너무 큽니다. 합계 6천만 화소 이하로 줄여서 첨부해 주세요.' }, 413);
    }
    const sha = await sha256Hex(bytes);
    if (knownHashes.has(sha)) return c.json({ error: `${file.name}: 같은 이미지가 이미 첨부되어 있습니다.` }, 409);
    knownHashes.add(sha);
    const id = crypto.randomUUID();
    const name = normalizedImageName(file.name, mime);
    prepared.push({ id, key: expenseReceiptObjectKey(documentId, id, name), name, mime, size: file.size,
      width: dimensions.width, height: dimensions.height, sha, bytes });
  }

  try {
    for (const item of prepared) {
      await c.env.ARTICLE_BUCKET.put(item.key, item.bytes, {
        httpMetadata: { contentType: item.mime },
        customMetadata: { documentId, attachmentId: item.id, sha256: item.sha },
      });
    }
    const startOrder = existing.reduce((max, item) => Math.max(max, Number(item.sort_order || 0)), -1) + 1;
    await c.env.DB.batch([
      ...prepared.map((item, index) => c.env.DB.prepare(`INSERT INTO expense_receipt_attachments
        (id, document_id, object_key, file_name, file_type, file_size, image_width, image_height, sha256, sort_order)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .bind(item.id, documentId, item.key, item.name, item.mime, item.size, item.width, item.height, item.sha, startOrder + index)),
      c.env.DB.prepare(`DELETE FROM signatures
        WHERE document_id=? AND user_id=? AND signature_data != '/LNCstemp.png'`)
        .bind(documentId, document.author_id),
    ]);
  } catch (error) {
    if (prepared.length) {
      await deleteExpenseReceiptR2ObjectsOrQueue(
        c.env,
        prepared.map((item) => item.key),
        'attachment-upload-rollback',
        documentId,
      ).catch((cleanupError) => console.error('Expense receipt upload cleanup was not persisted:', cleanupError));
    }
    console.error('Expense receipt upload rollback:', error);
    if (isExpenseReceiptEditConflict(error)) {
      return c.json({ error: '문서가 이미 제출되어 영수증 첨부를 변경할 수 없습니다.' }, 409);
    }
    return c.json({ error: '영수증 저장 중 오류가 발생하여 이번 첨부를 모두 되돌렸습니다.' }, 500);
  }
    return c.json({ attachments: await activeAttachmentResponse(c.env.DB, documentId) }, 201);
  } finally {
    await releaseAttachmentMutationClaim(c.env.DB, documentId, claimToken);
  }
});

expenseReceipts.put('/:documentId/attachments/order', async (c) => {
  await ensureExpenseReceiptSchema(c.env.DB);
  const documentId = c.req.param('documentId');
  const document = await findReceiptDocument(c.env.DB, documentId);
  if (!document) return c.json({ error: '영수증 첨부 지출결의서를 찾을 수 없습니다.' }, 404);
  if (!canEditExpenseReceipt(c.get('user'), document)) return c.json({ error: '초안 또는 반려 문서만 순서를 변경할 수 있습니다.' }, 403);
  const body: { attachment_ids?: unknown } = await c.req.json<{ attachment_ids?: unknown }>()
    .catch(() => ({}));
  const rawIds: unknown[] = Array.isArray(body.attachment_ids) ? body.attachment_ids : [];
  const requested: string[] = rawIds.filter((id: unknown): id is string => typeof id === 'string');
  const claimToken = await acquireExpenseReceiptAttachmentMutationClaim(c.env.DB, documentId);
  if (!claimToken) {
    return c.json({ error: '다른 제출·서명·삭제 또는 첨부 변경 작업이 진행 중입니다. 잠시 후 다시 시도해 주세요.' }, 409);
  }
  try {
  const active = await listActiveExpenseReceiptAttachments(c.env.DB, documentId);
  const expected = active.map((item) => item.id);
  if (requested.length !== expected.length || new Set(requested).size !== expected.length
    || requested.some((id) => !expected.includes(id))) {
    return c.json({ error: '현재 첨부된 전체 영수증 ID를 중복 없이 정확히 보내야 합니다.' }, 400);
  }
  if (requested.every((id, index) => id === expected[index])) {
    return c.json({ success: true, attachments: await activeAttachmentResponse(c.env.DB, documentId) });
  }
  try {
    await c.env.DB.batch([
      c.env.DB.prepare(`UPDATE expense_receipt_attachments SET sort_order=sort_order+1000,
        updated_at=datetime('now') WHERE document_id=? AND deleted_at IS NULL AND purged_at IS NULL`)
        .bind(documentId),
      ...requested.map((id, index) => c.env.DB.prepare(`UPDATE expense_receipt_attachments
        SET sort_order=?, updated_at=datetime('now') WHERE id=? AND document_id=? AND deleted_at IS NULL`)
        .bind(index, id, documentId)),
      c.env.DB.prepare(`DELETE FROM signatures
        WHERE document_id=? AND user_id=? AND signature_data != '/LNCstemp.png'`)
        .bind(documentId, document.author_id),
    ]);
  } catch (error) {
    if (isExpenseReceiptEditConflict(error)) {
      return c.json({ error: '문서가 이미 제출되어 영수증 순서를 변경할 수 없습니다.' }, 409);
    }
    throw error;
  }
    return c.json({ success: true, attachments: await activeAttachmentResponse(c.env.DB, documentId) });
  } finally {
    await releaseAttachmentMutationClaim(c.env.DB, documentId, claimToken);
  }
});

expenseReceipts.delete('/:documentId/attachments/:attachmentId', async (c) => {
  await ensureExpenseReceiptSchema(c.env.DB);
  if (!c.env.ARTICLE_BUCKET) return c.json({ error: '영수증 이미지 저장소가 설정되지 않았습니다.' }, 503);
  const documentId = c.req.param('documentId');
  const document = await findReceiptDocument(c.env.DB, documentId);
  if (!document) return c.json({ error: '영수증 첨부 지출결의서를 찾을 수 없습니다.' }, 404);
  if (!canEditExpenseReceipt(c.get('user'), document)) return c.json({ error: '초안 또는 반려 문서만 영수증을 삭제할 수 있습니다.' }, 403);
  const claimToken = await acquireExpenseReceiptAttachmentMutationClaim(c.env.DB, documentId);
  if (!claimToken) {
    return c.json({ error: '다른 제출·서명·삭제 또는 첨부 변경 작업이 진행 중입니다. 잠시 후 다시 시도해 주세요.' }, 409);
  }
  try {
  const attachment = await c.env.DB.prepare(`SELECT id, object_key FROM expense_receipt_attachments
    WHERE id=? AND document_id=? AND deleted_at IS NULL AND object_key IS NOT NULL`)
    .bind(c.req.param('attachmentId'), documentId).first<{ id: string; object_key: string }>();
  if (!attachment) return c.json({ error: '영수증 이미지를 찾을 수 없습니다.' }, 404);
  try {
    const tombstoneResults = await c.env.DB.batch([
      c.env.DB.prepare(`UPDATE expense_receipt_attachments SET deleted_at=datetime('now'), updated_at=datetime('now')
        WHERE id=? AND document_id=? AND deleted_at IS NULL AND purged_at IS NULL AND object_key=?`)
        .bind(attachment.id, documentId, attachment.object_key),
      c.env.DB.prepare(`DELETE FROM signatures
        WHERE document_id=? AND user_id=? AND signature_data != '/LNCstemp.png'`)
        .bind(documentId, document.author_id),
    ]);
    if (Number(tombstoneResults[0]?.meta?.changes || 0) !== 1) {
      return c.json({ error: '영수증 이미지 상태가 변경되었습니다. 새로고침 후 다시 시도해 주세요.' }, 409);
    }
  } catch (error) {
    if (isExpenseReceiptEditConflict(error)) {
      return c.json({ error: '문서가 이미 제출되어 영수증을 삭제할 수 없습니다.' }, 409);
    }
    throw error;
  }
  try {
    await c.env.ARTICLE_BUCKET.delete(attachment.object_key);
  } catch (error) {
    let restored = false;
    try {
      const rollback = await c.env.DB.prepare(`UPDATE expense_receipt_attachments
        SET deleted_at=NULL, updated_at=datetime('now')
        WHERE id=? AND document_id=? AND deleted_at IS NOT NULL
          AND purged_at IS NULL AND object_key=?`)
        .bind(attachment.id, documentId, attachment.object_key).run();
      restored = Number(rollback.meta?.changes || 0) === 1;
    } catch (rollbackError) {
      console.error('Expense receipt attachment delete rollback metadata failure:', rollbackError);
    }
    console.error('Expense receipt attachment delete rollback:', error);
    if (!restored) {
      return c.json({ error: '원본 삭제는 실패했고 첨부 상태 복구도 완료하지 못했습니다. 관리자 확인이 필요합니다.' }, 503);
    }
    return c.json({ error: '영수증 이미지를 삭제하지 못해 변경을 되돌렸습니다.' }, 500);
  }
  try {
    const finalized = await c.env.DB.prepare(`UPDATE expense_receipt_attachments SET object_key=NULL, purged_at=datetime('now'),
      updated_at=datetime('now') WHERE id=? AND document_id=? AND deleted_at IS NOT NULL AND object_key=?`)
      .bind(attachment.id, documentId, attachment.object_key).run();
    if (Number(finalized.meta?.changes || 0) !== 1) {
      throw new Error('expense receipt attachment tombstone finalization changed no rows');
    }
  } catch (error) {
    // R2 삭제가 이미 성공했으므로 없는 원본을 active 상태로 되살리지 않는다.
    // deleted_at tombstone과 기존 key를 남겨 다음 정리에서 메타 갱신을 재시도할 수 있게 한다.
    console.error('Expense receipt attachment tombstone finalization failed:', error);
    return c.json({ error: '이미지는 삭제되었지만 정리 메타데이터 저장에 실패했습니다. 항목은 비활성 상태로 유지됩니다.' }, 500);
  }
    return c.json({ success: true, attachments: await activeAttachmentResponse(c.env.DB, documentId) });
  } finally {
    await releaseAttachmentMutationClaim(c.env.DB, documentId, claimToken);
  }
});

expenseReceipts.get('/:documentId/attachments/:attachmentId/content', async (c) => {
  await ensureExpenseReceiptSchema(c.env.DB);
  if (!c.env.ARTICLE_BUCKET) return c.json({ error: '영수증 이미지 저장소가 설정되지 않았습니다.' }, 503);
  const documentId = c.req.param('documentId');
  const document = await findReceiptDocument(c.env.DB, documentId);
  if (!document) return c.json({ error: '영수증 첨부 지출결의서를 찾을 수 없습니다.' }, 404);
  if (!canReadExpenseReceipt(c.get('user'), document)) return c.json({ error: '이 문서를 열람할 권한이 없습니다.' }, 403);
  const attachment = await c.env.DB.prepare(`SELECT object_key, file_type FROM expense_receipt_attachments
    WHERE id=? AND document_id=? AND deleted_at IS NULL AND purged_at IS NULL AND object_key IS NOT NULL`)
    .bind(c.req.param('attachmentId'), documentId).first<{ object_key: string; file_type: string }>();
  if (!attachment) return c.json({ error: '영수증 이미지가 없거나 사이트 보존기간이 만료되었습니다.' }, 404);
  const object = await c.env.ARTICLE_BUCKET.get(attachment.object_key);
  if (!object?.body) return c.json({ error: '영수증 이미지 원본을 찾을 수 없습니다.' }, 404);
  return new Response(object.body, {
    headers: {
      'Content-Type': attachment.file_type,
      'Content-Length': String(object.size),
      'Cache-Control': 'private, no-store',
      'X-Content-Type-Options': 'nosniff',
    },
  });
});

expenseReceipts.get('/:documentId/pdf', async (c) => {
  await ensureExpenseReceiptSchema(c.env.DB);
  if (!c.env.ARTICLE_BUCKET) return c.json({ error: '합본 PDF 저장소가 설정되지 않았습니다.' }, 503);
  const documentId = c.req.param('documentId');
  const document = await findReceiptDocument(c.env.DB, documentId);
  if (!document) return c.json({ error: '영수증 첨부 지출결의서를 찾을 수 없습니다.' }, 404);
  if (!canReadExpenseReceipt(c.get('user'), document)) return c.json({ error: '이 문서를 열람할 권한이 없습니다.' }, 403);
  const artifact = await c.env.DB.prepare(`SELECT object_key, file_name FROM expense_receipt_pdf_artifacts
    WHERE document_id=? AND object_key IS NOT NULL AND purged_at IS NULL`)
    .bind(documentId).first<{ object_key: string; file_name: string }>();
  if (!artifact) return c.json({ error: 'Drive 백업이 완료된 합본 PDF가 아직 없거나 사이트 보존기간이 만료되었습니다.' }, 404);
  const object = await c.env.ARTICLE_BUCKET.get(artifact.object_key);
  if (!object?.body) return c.json({ error: '합본 PDF 원본을 찾을 수 없습니다.' }, 404);
  const encoded = encodeURIComponent(safeExpenseReceiptFileName(artifact.file_name));
  return new Response(object.body, { headers: {
    'Content-Type': 'application/pdf',
    'Content-Length': String(object.size),
    'Content-Disposition': `attachment; filename*=UTF-8''${encoded}`,
    'Cache-Control': 'private, no-store',
    'X-Content-Type-Options': 'nosniff',
  } });
});

export default expenseReceipts;
