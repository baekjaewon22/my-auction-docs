// Drive 자동 백업 배치 실행기 — Cron + 수동 트리거 공용
// - refresh_token → access_token
// - pending 문서 루프: PDF 렌더(Browser Rendering) → Drive 업로드 → 로그

import puppeteer from '@cloudflare/puppeteer';
import {
  decryptToken, refreshAccessToken,
  findOrCreateFolder, resolveFolderPath, uploadPdfBuffer, uploadFileBuffer,
} from './drive-oauth';
import { ensureBriefingMaterialSchema, safeBriefingFileName } from './lib/briefing-materials';
import {
  EXPENSE_RECEIPT_TEMPLATE_ID,
  acquireExpenseReceiptDriveClaim,
  countActiveExpenseReceiptAttachments,
  ensureExpenseReceiptSchema,
  releaseExpenseReceiptDriveClaim,
  storeExpenseReceiptPdfArtifact,
} from './lib/expense-receipts';
import { consumePrintRenderSession, issuePrintToken } from './lib/print-render-session';
import { driveFileStillExists } from './lib/drive-file-verification.ts';
import {
  validateExpenseReceiptPrintState,
  type ExpenseReceiptPrintState,
} from './lib/expense-receipt-print-validation.ts';
export { driveFileStillExists } from './lib/drive-file-verification.ts';
export { verifyPrintToken } from './lib/print-render-session';

const KST_OFFSET = 9 * 60 * 60 * 1000;

function nowKST() {
  return new Date(Date.now() + KST_OFFSET);
}

function kstDateStr(iso?: string | null) {
  const d = iso ? new Date(iso) : nowKST();
  const yyyy = String(d.getUTCFullYear());
  const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(d.getUTCDate()).padStart(2, '0');
  return { yyyy, mm, dd };
}

function sanitizeName(s: string): string {
  return (s || '').replace(/[\/\\]+/g, '_').replace(/\s+/g, ' ').trim();
}

function applyPattern(pattern: string, meta: any): string {
  const { yyyy, mm, dd } = kstDateStr(meta.approved_at || meta.created_at);
  const vars: Record<string, string> = {
    'yyyy': yyyy,
    'yyyy-mm': `${yyyy}-${mm}`,
    'yyyy-mm-dd': `${yyyy}-${mm}-${dd}`,
    'yyyy.mm.dd': `${yyyy}.${mm}.${dd}`,
    'yyyy.mm': `${yyyy}.${mm}`,
    'branch': meta.author_branch || meta.branch || '미지정',
    'department': meta.author_department || meta.department || '',
    'doc_type': meta.template_name || '문서',
    'author': meta.author_name || '',
    'position': meta.author_position || '',
    'title': meta.title || '',
    'client_name': meta.title || '',
    'status': 'approved',
  };
  return pattern.replace(/\{([^}]+)\}/g, (_, key) => vars[key.trim()] ?? '').replace(/\s+/g, ' ').trim();
}

function buildFolderSegments(pattern: string, meta: any): string[] {
  return applyPattern(pattern, meta).split('/').map(sanitizeName).filter(Boolean);
}

function buildFilename(pattern: string, meta: any): string {
  const raw = sanitizeName(applyPattern(pattern, meta)).slice(0, 120);
  return raw.endsWith('.pdf') ? raw : `${raw}.pdf`;
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 인쇄용 JWT 토큰 — Browser Rendering이 /print/:id 에 접근할 때 사용
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// PDF 생성 (Browser Rendering)
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

// browser 인스턴스를 재사용하여 PDF 생성 — Cloudflare Browser Rendering Rate limit(429) 회피
// 한 invocation 안에서 launch 1번 + 여러 page 처리하는 패턴
async function generatePdfWithBrowser(
  env: any,
  browser: any,
  doc: { id: string; title: string; template_id?: string | null },
  baseUrl: string,
): Promise<ArrayBuffer> {
  const isExpenseReceipt = doc.template_id === EXPENSE_RECEIPT_TEMPLATE_ID;
  const expectedReceiptAttachmentCount = isExpenseReceipt
    ? await countActiveExpenseReceiptAttachments(env.DB, doc.id)
    : 0;
  if (isExpenseReceipt && expectedReceiptAttachmentCount < 1) {
    throw new Error('영수증 원본이 없어 합본 PDF를 생성할 수 없습니다.');
  }
  const session = await issuePrintToken(env, doc.id);
  const url = `${baseUrl}/print/${doc.id}?token=${encodeURIComponent(session.token)}`;

  const page = await browser.newPage();
  try {
    await page.setViewport({ width: 794, height: 1123, deviceScaleFactor: 2 });

    // networkidle0(모든 네트워크 종료)는 외부 이미지가 있는 SPA에서 자주 도달 못해 timeout.
    // 'load' 이벤트로 완화하고 이후 명시적 이미지/__printReady 대기로 보강.
    try {
      await page.goto(url, { waitUntil: 'load', timeout: 60_000 });
    } catch (gotoErr: any) {
      // load 실패 시 domcontentloaded 로 한 번 더 시도 — 콘텐츠는 React가 그릴 것
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30_000 });
      console.log(`[drive-pdf] goto fallback for ${doc.id}: ${gotoErr.message || gotoErr}`);
    }

    const isPropertyReport = (doc.title || '').includes('물건') || (doc.title || '').includes('분석');
    await new Promise(r => setTimeout(r, isPropertyReport ? 4_000 : 1_500));

    // React publishes this handshake only after print-data has rendered and
    // all images have settled. This avoids accepting a loading-screen PDF when
    // the initial API response is slow and the DOM still contains zero images.
    const printState = await page.evaluate(`new Promise(resolve => {
      let settled = false;
      const finish = () => {
        if (settled) return;
        settled = true;
        clearInterval(interval);
        clearTimeout(timeout);
        const receiptImages = Array.from(document.querySelectorAll('img'))
          .filter(img => String(img.alt || '').startsWith('영수증'));
        resolve({
          ready: window.__printReady === true,
          error: window.__printError ? String(window.__printError) : null,
          meta: window.__printMeta || null,
          receiptImageCount: receiptImages.length,
          loadedReceiptImageCount: receiptImages.filter(img => img.complete && img.naturalWidth > 0).length,
        });
      };
      const interval = setInterval(() => {
        if (window.__printReady === true || window.__printError) finish();
      }, 100);
      const timeout = setTimeout(finish, 30000);
      if (window.__printReady === true || window.__printError) finish();
    })`) as ExpenseReceiptPrintState;

    if (isExpenseReceipt) {
      validateExpenseReceiptPrintState(doc.id, expectedReceiptAttachmentCount, printState);
    } else if (printState.error) {
      throw new Error(`인쇄 리소스 로딩 실패: ${printState.error}`);
    }

    const pdf = await page.pdf({
      format: 'A4',
      printBackground: true,
      margin: { top: '0', right: '0', bottom: '0', left: '0' },
      preferCSSPageSize: true,
    });
    // pdf.buffer는 ArrayBuffer | SharedArrayBuffer 유니온 — copy로 ArrayBuffer 보장
    const out = new ArrayBuffer(pdf.byteLength);
    new Uint8Array(out).set(new Uint8Array(pdf.buffer as ArrayBuffer, pdf.byteOffset, pdf.byteLength));
    return out;
  } finally {
    await page.close().catch(() => {});
    await consumePrintRenderSession(env.DB, session.jti).catch((error) => {
      console.error(`[drive-pdf] print session revoke failed for ${doc.id}:`, error);
    });
  }
}

// 온디맨드 단일 문서 PDF 렌더 — 문서보관함 'PDF 열람'용. runBackupBatch와 동일 파이프라인(Browser Rendering + /print) 재사용.
export async function renderApprovedDocumentPdf(
  env: any,
  doc: { id: string; title: string; template_id?: string | null },
): Promise<ArrayBuffer> {
  const baseUrl = env.ENVIRONMENT === 'development'
    ? 'http://localhost:5173'
    : 'https://my-docs.kr';
  const browser = await puppeteer.launch(env.BROWSER);
  try {
    return await generatePdfWithBrowser(env, browser, doc, baseUrl);
  } finally {
    await browser.close().catch(() => {});
  }
}

// 에러 객체를 사람이 읽을 수 있는 메시지로 정규화 — Error 외에도 puppeteer/HTTP/문자열 예외 포함
function formatError(err: any, ctx: string): string {
  if (err == null) return `${ctx}: (null error)`;
  if (err instanceof Error) {
    const name = err.name || 'Error';
    const msg = err.message || '(no message)';
    return `${ctx}: ${name}: ${msg}`.slice(0, 800);
  }
  if (typeof err === 'string') return `${ctx}: ${err}`.slice(0, 800);
  try { return `${ctx}: ${JSON.stringify(err)}`.slice(0, 800); }
  catch { return `${ctx}: ${String(err)}`.slice(0, 800); }
}

async function deleteUploadedDriveFile(accessToken: string, fileId: string): Promise<void> {
  const response = await fetch(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!response.ok && response.status !== 404) {
    throw new Error(`Drive 보상 삭제 실패 (${response.status}): ${(await response.text()).slice(0, 300)}`);
  }
}

export async function createDriveFileVerifier(env: any): Promise<(
  fileId: string,
  expectedSize: number,
  expectedMd5Checksum: string,
  expectedSha256: string,
) => Promise<boolean>> {
  const clientSecret = String(env.GOOGLE_CLIENT_SECRET || '');
  if (!clientSecret) throw new Error('GOOGLE_CLIENT_SECRET 미설정');
  const setting = await (env.DB as D1Database).prepare(
    "SELECT refresh_token_encrypted, token_iv FROM drive_settings WHERE id='default'",
  ).first<{ refresh_token_encrypted: string; token_iv: string }>();
  if (!setting?.refresh_token_encrypted || !setting.token_iv) {
    throw new Error('Google Drive 미연결');
  }
  const refreshToken = await decryptToken(
    setting.refresh_token_encrypted,
    setting.token_iv,
    clientSecret,
  );
  const token = await refreshAccessToken(refreshToken, clientSecret);
  return (fileId, expectedSize, expectedMd5Checksum, expectedSha256) => driveFileStillExists(
    token.access_token,
    fileId,
    expectedSize,
    expectedMd5Checksum,
    expectedSha256,
  );
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 배치 실행
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

export type DriveBackupDocumentAccessRow = {
  id: string;
  template_id: string | null;
  author_id: string;
  status: string;
};

export type DriveBackupBatchOptions = {
  triggered_by?: string;
  limit?: number;
  document_ids?: string[];
  document_access_sql?: { clause: string; bindings: string[] };
  document_access_filter?: (document: DriveBackupDocumentAccessRow) => boolean;
};

export async function runBackupBatch(
  env: any,
  opts: DriveBackupBatchOptions = {},
): Promise<{ processed: number; success: number; failed: number; skipped: number; briefing_processed?: number; briefing_success?: number; briefing_failed?: number; error?: string; details?: Array<{ id: string; title: string; status: 'success' | 'failed'; folder?: string; file_id?: string; error?: string }> }> {
  const db = env.DB as D1Database;
  const clientSecret = env.GOOGLE_CLIENT_SECRET as string | undefined;
  const baseUrl = env.ENVIRONMENT === 'development'
    ? 'http://localhost:5173'
    : 'https://my-docs.kr';

  if (!clientSecret) {
    return { processed: 0, success: 0, failed: 0, skipped: 0, error: 'GOOGLE_CLIENT_SECRET 미설정' };
  }

  const s = await db.prepare(
    "SELECT refresh_token_encrypted, token_iv, root_folder_id, root_folder_name, folder_pattern, filename_pattern, auto_enabled FROM drive_settings WHERE id = 'default'"
  ).first<any>();

  if (!s || !s.refresh_token_encrypted || !s.auto_enabled) {
    return { processed: 0, success: 0, failed: 0, skipped: 0, error: '자동 백업 비활성 또는 미연결' };
  }

  let accessToken: string;
  try {
    const refresh = await decryptToken(s.refresh_token_encrypted, s.token_iv, clientSecret);
    const tok = await refreshAccessToken(refresh, clientSecret);
    accessToken = tok.access_token;
  } catch (err: any) {
    await db.prepare(`UPDATE drive_settings SET last_cron_status = 'token_error', last_cron_summary = ?, last_cron_run_at = datetime('now') WHERE id = 'default'`)
      .bind(`refresh_token 오류: ${err.message || err}`).run();
    return { processed: 0, success: 0, failed: 0, skipped: 0, error: 'refresh_token 갱신 실패' };
  }

  // 루트 폴더 확보 — drive.file scope라 앱이 만든 폴더만 접근 가능
  const rootName = s.root_folder_name || '마이옥션 문서백업';
  let rootId = s.root_folder_id;
  if (!rootId) {
    rootId = await findOrCreateFolder(accessToken, 'root', rootName);
    await db.prepare(`UPDATE drive_settings SET root_folder_id = ?, root_folder_name = ?, updated_at = datetime('now') WHERE id = 'default'`)
      .bind(rootId, rootName).run();
  }

  const folderPattern = s.folder_pattern || '{yyyy-mm}/{branch}';
  const filenamePattern = s.filename_pattern || '[{yyyy-mm-dd}] {author} {doc_type}';
  // Cloudflare Workers Subrequest 한도(1000) + Browser Rendering Rate limit(429) 회피를 위해
  // 한 번에 5건씩만 처리. 빈도를 높여 cron이 자주 돌도록 함 (스케줄: 30분마다)
  const limit = Math.min(10, Math.max(1, opts.limit || 5));

  await ensureBriefingMaterialSchema(db);
  // Cron/manual runs can be the first request after deployment. Backfill the
  // Drive fingerprint column before any receipt-artifact query touches it so
  // an older production table remains readable even before an admin opens the
  // receipt routes.
  await ensureExpenseReceiptSchema(db);
  // A single-document test send must not unexpectedly drain the shared briefing queue.
  const briefingResult = opts.document_ids
    ? { processed: 0, success: 0, failed: 0 }
    : await backupBriefingMaterials(env, db, accessToken, rootId, limit, opts.triggered_by || 'cron');

  // 특정 문서 ID 지정 시: 해당 문서만 처리 (중복 체크 무시하여 재백업 허용)
  let docs: any[] = [];
  if (opts.document_ids && opts.document_ids.length > 0) {
    const placeholders = opts.document_ids.map(() => '?').join(',');
    const accessSql = opts.document_access_sql?.clause
      ? ` AND (${opts.document_access_sql.clause})`
      : '';
    const selected = await db.prepare(`
      SELECT d.id, d.title, d.template_id, d.author_id, d.status,
        d.branch, d.department, d.created_at, d.updated_at,
        u.name as author_name, u.branch as author_branch, u.department as author_department,
        u.position_title as author_position,
        t.title as template_name,
        (SELECT MAX(s.signed_at) FROM approval_steps s WHERE s.document_id = d.id AND s.status = 'approved') as approved_at
      FROM documents d
      LEFT JOIN users u ON u.id = d.author_id
      LEFT JOIN templates t ON t.id = d.template_id
      WHERE d.id IN (${placeholders}) AND d.status = 'approved' AND d.cancelled = 0
        ${accessSql}
    `).bind(...opts.document_ids, ...(opts.document_access_sql?.bindings || [])).all<any>();
    docs = (selected.results || []).filter((document) =>
      !opts.document_access_filter || opts.document_access_filter(document));
  } else {
    // 재시도 제한: 같은 문서가 5회 이상 실패하면 큐에서 제외 (영원히 재시도되어 큐를 막는 문제 방지)
    // 사용자가 명시적 테스트 발송으로 재시도 가능
    const candidateLimit = opts.document_access_filter && !opts.document_access_sql ? 500 : limit;
    const accessSql = opts.document_access_sql?.clause
      ? ` AND (${opts.document_access_sql.clause})`
      : '';
    const pending = await db.prepare(`
      SELECT d.id, d.title, d.template_id, d.author_id, d.status,
        d.branch, d.department, d.created_at, d.updated_at,
        u.name as author_name, u.branch as author_branch, u.department as author_department,
        u.position_title as author_position,
        t.title as template_name,
        (SELECT MAX(s.signed_at) FROM approval_steps s WHERE s.document_id = d.id AND s.status = 'approved') as approved_at,
        (SELECT COUNT(*) FROM drive_backup_logs b WHERE b.document_id = d.id AND b.status = 'failed') as fail_count
      FROM documents d
      LEFT JOIN users u ON u.id = d.author_id
      LEFT JOIN templates t ON t.id = d.template_id
      WHERE d.status = 'approved' AND d.cancelled = 0
        AND NOT EXISTS (SELECT 1 FROM approval_steps s WHERE s.document_id = d.id AND s.status != 'approved')
        AND NOT EXISTS (SELECT 1 FROM drive_backup_logs b WHERE b.document_id = d.id AND b.status = 'success')
        AND (SELECT COUNT(*) FROM drive_backup_logs b WHERE b.document_id = d.id AND b.status = 'failed') < 5
        ${accessSql}
      ORDER BY approved_at ASC
      LIMIT ?
    `).bind(...(opts.document_access_sql?.bindings || []), candidateLimit).all<any>();
    docs = (pending.results || [])
      .filter((document) => !opts.document_access_filter || opts.document_access_filter(document))
      .slice(0, limit);
  }
  let success = 0, failed = 0;
  let skipped = 0;
  const details: Array<{ id: string; title: string; status: 'success' | 'failed'; folder?: string; file_id?: string; error?: string }> = [];

  // 처리할 문서가 있으면 browser를 한 번만 launch하여 재사용 (Rate limit 429 회피)
  let browser: any = null;
  if (docs.length > 0) {
    try {
      browser = await puppeteer.launch(env.BROWSER);
    } catch (err: any) {
      console.error('[drive-backup] browser launch failed', err);
      // 모든 문서 실패 처리
      for (const doc of docs) {
        const errMsg = formatError(err, '[browser-launch]');
        await db.prepare(`
          INSERT INTO drive_backup_logs (id, document_id, run_at, status, error_message, triggered_by)
          VALUES (?, ?, datetime('now'), 'failed', ?, ?)
        `).bind(crypto.randomUUID(), doc.id, errMsg, opts.triggered_by || 'cron').run();
        failed++;
        details.push({ id: doc.id, title: doc.title, status: 'failed', error: errMsg });
      }
      return { processed: docs.length, success: 0, failed, skipped, details };
    }
  }

  try {
  for (let i = 0; i < docs.length; i++) {
    const doc = docs[i];
    if (i > 0) await new Promise(r => setTimeout(r, 1_500));
    let stage = 'init';
    let segments: string[] = [];
    let failedDriveFileId = '';
    let failedDriveFolderPath = '';
    let expenseReceiptDriveClaim = '';
    try {
      if (doc.template_id === EXPENSE_RECEIPT_TEMPLATE_ID) {
        stage = 'drive-claim';
        expenseReceiptDriveClaim = await acquireExpenseReceiptDriveClaim(db, doc.id) || '';
        if (!expenseReceiptDriveClaim) {
          skipped += 1;
          continue;
        }
        const purgedArtifact = await db.prepare(`SELECT purged_at
          FROM expense_receipt_pdf_artifacts WHERE document_id=? AND purged_at IS NOT NULL`)
          .bind(doc.id).first<{ purged_at: string }>();
        if (purgedArtifact || await countActiveExpenseReceiptAttachments(db, doc.id) < 1) {
          skipped += 1;
          continue;
        }
        // Clear orphan uploads before accepting the canonical artifact. If the
        // canonical copy becomes healthy again after a transient R2/Drive
        // failure, an early success skip must not strand pending duplicates.
        stage = 'drive-compensation-retry';
        const pendingCompensations = await db.prepare(`SELECT id, drive_file_id
          FROM drive_backup_logs
          WHERE document_id=? AND status='failed' AND drive_file_id!=''
            AND error_message LIKE '%drive-compensation-pending:%'
          ORDER BY run_at ASC LIMIT 10`).bind(doc.id)
          .all<{ id: string; drive_file_id: string }>();
        for (const pending of pendingCompensations.results || []) {
          await deleteUploadedDriveFile(accessToken, pending.drive_file_id);
          await db.prepare(`UPDATE drive_backup_logs
            SET error_message=replace(error_message, 'drive-compensation-pending:', 'drive-compensation-cleared:')
            WHERE id=?`).bind(pending.id).run();
        }

        const alreadyBackedUp = await db.prepare(`SELECT p.object_key, p.file_size, p.drive_file_id,
            p.drive_md5_checksum, p.sha256
          FROM expense_receipt_pdf_artifacts p
          WHERE p.document_id=? AND p.object_key IS NOT NULL AND p.purged_at IS NULL
            AND p.drive_file_id!=''
            AND EXISTS (SELECT 1 FROM drive_backup_logs b
              WHERE b.document_id=p.document_id AND b.status='success')`)
          .bind(doc.id).first<{
            object_key: string;
            file_size: number;
            drive_file_id: string;
            drive_md5_checksum: string;
            sha256: string;
          }>();
        if (alreadyBackedUp && env.ARTICLE_BUCKET
          && await env.ARTICLE_BUCKET.head(alreadyBackedUp.object_key)
          && await driveFileStillExists(
            accessToken,
            alreadyBackedUp.drive_file_id,
            Number(alreadyBackedUp.file_size),
            alreadyBackedUp.drive_md5_checksum || '',
            alreadyBackedUp.sha256 || '',
          )) {
          skipped += 1;
          continue;
        }
      }
      // Drive 업로드 후 artifact는 저장됐지만 success log만 실패한 부분 성공 상태를 복구한다.
      // 이 경로가 없으면 다음 cron이 동일 PDF를 Drive에 중복 업로드한다.
      if (doc.template_id === EXPENSE_RECEIPT_TEMPLATE_ID) {
        await ensureExpenseReceiptSchema(db);
        const recoverable = await db.prepare(`SELECT p.object_key, p.file_size, p.drive_file_id,
            p.drive_md5_checksum, p.sha256, p.drive_folder_path
          FROM expense_receipt_pdf_artifacts p
          WHERE p.document_id=? AND p.object_key IS NOT NULL AND p.purged_at IS NULL
            AND p.drive_backed_up_at IS NOT NULL AND p.drive_file_id!=''
            AND NOT EXISTS (SELECT 1 FROM drive_backup_logs b WHERE b.document_id=p.document_id AND b.status='success')`)
          .bind(doc.id).first<{
            object_key: string;
            file_size: number;
            drive_file_id: string;
            drive_md5_checksum: string;
            sha256: string;
            drive_folder_path: string;
          }>();
        if (recoverable && env.ARTICLE_BUCKET && await env.ARTICLE_BUCKET.head(recoverable.object_key)
          && await driveFileStillExists(
            accessToken,
            recoverable.drive_file_id,
            Number(recoverable.file_size),
            recoverable.drive_md5_checksum || '',
            recoverable.sha256 || '',
          )) {
          stage = 'artifact-log-recovery';
          await db.prepare(`INSERT INTO drive_backup_logs
            (id, document_id, run_at, status, drive_file_id, drive_folder_path, file_size, triggered_by)
            VALUES (?, ?, datetime('now'), 'success', ?, ?, ?, ?)`)
            .bind(crypto.randomUUID(), doc.id, recoverable.drive_file_id, recoverable.drive_folder_path,
              recoverable.file_size, opts.triggered_by || 'cron').run();
          success++;
          details.push({ id: doc.id, title: doc.title, status: 'success',
            folder: recoverable.drive_folder_path, file_id: recoverable.drive_file_id });
          continue;
        }
      }
      stage = 'folder';
      // 지출결의서는 '지출결의서 / 지사 / 월(yyyy-mm)' 구조로 별도 백업한다.
      if (doc.template_id === EXPENSE_RECEIPT_TEMPLATE_ID) {
        const { yyyy, mm } = kstDateStr(doc.approved_at || doc.created_at);
        segments = ['지출결의서', sanitizeName(doc.author_branch || doc.branch || '미지정'), `${yyyy}-${mm}`].filter(Boolean);
      } else {
        segments = buildFolderSegments(folderPattern, doc);
      }
      const folderId = segments.length > 0
        ? await resolveFolderPath(accessToken, rootId, segments)
        : rootId;
      const filename = buildFilename(filenamePattern, doc);

      stage = 'pdf';
      const pdfBuffer = await generatePdfWithBrowser(env, browser, doc, baseUrl);
      if (!pdfBuffer || pdfBuffer.byteLength < 1000) {
        throw new Error(`PDF 크기 비정상: ${pdfBuffer?.byteLength || 0} bytes`);
      }

      stage = 'upload';
      const uploaded = await uploadPdfBuffer(accessToken, folderId, filename, pdfBuffer);
      failedDriveFileId = uploaded.id;
      failedDriveFolderPath = segments.join('/') || '/';

      if (doc.template_id === EXPENSE_RECEIPT_TEMPLATE_ID) {
        stage = 'artifact';
        try {
          await storeExpenseReceiptPdfArtifact(env, doc.id, pdfBuffer, {
            fileId: uploaded.id,
            folderPath: segments.join('/') || '/',
            fileName: filename,
            md5Checksum: uploaded.md5Checksum,
          });
        } catch (artifactError) {
          try {
            await deleteUploadedDriveFile(accessToken, uploaded.id);
            failedDriveFileId = '';
            failedDriveFolderPath = '';
          } catch (compensationError) {
            throw new Error(`drive-compensation-pending:${uploaded.id}; ${formatError(artifactError, 'R2 artifact 저장 실패')}; ${formatError(compensationError, 'Drive 중복 방지 보상 실패')}`);
          }
          throw artifactError;
        }
      }

      stage = 'log';
      await db.prepare(`
        INSERT INTO drive_backup_logs (id, document_id, run_at, status, drive_file_id, drive_folder_path, file_size, triggered_by)
        VALUES (?, ?, datetime('now'), 'success', ?, ?, ?, ?)
      `).bind(
        crypto.randomUUID(), doc.id, uploaded.id, segments.join('/') || '/', uploaded.size,
        opts.triggered_by || 'cron',
      ).run();
      success++;
      console.log(`[drive-backup] ✓ ${doc.id} (${doc.title}) → ${segments.join('/') || '/'}`);
      details.push({ id: doc.id, title: doc.title, status: 'success', folder: segments.join('/') || '/', file_id: uploaded.id });
    } catch (err: any) {
      const errMsg = formatError(err, `[${stage}]`);
      console.error(`[drive-backup] ✗ ${doc.id} (${doc.title}) ${errMsg}`);
      try {
        await db.prepare(`
          INSERT INTO drive_backup_logs
            (id, document_id, run_at, status, drive_file_id, drive_folder_path, error_message, triggered_by)
          VALUES (?, ?, datetime('now'), 'failed', ?, ?, ?, ?)
        `).bind(
          crypto.randomUUID(), doc.id, failedDriveFileId, failedDriveFolderPath, errMsg,
          opts.triggered_by || 'cron',
        ).run();
      } catch (logErr) {
        console.error(`[drive-backup] log insert failed for ${doc.id}:`, logErr);
      }
      failed++;
      details.push({ id: doc.id, title: doc.title, status: 'failed', error: errMsg });
    } finally {
      if (expenseReceiptDriveClaim) {
        await releaseExpenseReceiptDriveClaim(db, doc.id, expenseReceiptDriveClaim).catch((error) => {
          console.error(`[drive-backup] receipt claim release failed for ${doc.id}:`, error);
        });
      }
    }
  }
  } finally {
    if (browser) await browser.close().catch(() => {});
  }

  const summary = `문서 성공 ${success} / 실패 ${failed} · 브리핑 성공 ${briefingResult.success} / 실패 ${briefingResult.failed}`;
  // 단일 문서 테스트는 cron 상태 기록 생략 (설정 흔들림 방지)
  if (!opts.document_ids) {
    await db.prepare(`
      UPDATE drive_settings SET
        last_cron_run_at = datetime('now'),
        last_cron_status = ?,
        last_cron_summary = ?,
        updated_at = datetime('now')
      WHERE id = 'default'
    `).bind(failed === 0 ? 'success' : 'partial', summary).run();
  }

  return { processed: docs.length, success, failed, skipped,
    briefing_processed: briefingResult.processed, briefing_success: briefingResult.success,
    briefing_failed: briefingResult.failed, details };
}

async function backupBriefingMaterials(
  env: any,
  db: D1Database,
  accessToken: string,
  rootId: string,
  limit: number,
  triggeredBy: string,
): Promise<{ processed: number; success: number; failed: number }> {
  if (!env.ARTICLE_BUCKET) return { processed: 0, success: 0, failed: 0 };
  const pending = await db.prepare(`SELECT * FROM briefing_materials
    WHERE archived_at IS NULL AND object_key != '' AND drive_status != 'success' AND drive_attempt_count < 5
    ORDER BY created_at ASC LIMIT ?`).bind(limit).all<any>();
  const materials = pending.results || [];
  let success = 0;
  let failed = 0;
  for (const material of materials) {
    const folderSegments = [
      '브리핑자료',
      `${material.material_month || '미지정'} 브리핑자료 모음`,
      sanitizeName(material.branch || '미지정'),
      sanitizeName(material.assignee_name || material.uploader_name || '미지정'),
    ];
    try {
      const object = await env.ARTICLE_BUCKET.get(material.object_key);
      if (!object) throw new Error('R2 원본 파일을 찾을 수 없습니다.');
      const buffer = await object.arrayBuffer();
      const folderId = await resolveFolderPath(accessToken, rootId, folderSegments);
      const uploaded = await uploadFileBuffer(accessToken, folderId, safeBriefingFileName(material.file_name),
        material.file_type || object.httpMetadata?.contentType || 'application/octet-stream', buffer);
      await db.batch([
        db.prepare(`UPDATE briefing_materials SET drive_status='success', drive_file_id=?, drive_folder_path=?,
          drive_backed_up_at=datetime('now'), drive_attempt_count=drive_attempt_count+1, drive_error='', updated_at=datetime('now') WHERE id=?`)
          .bind(uploaded.id, folderSegments.join('/'), material.id),
        db.prepare(`INSERT INTO briefing_material_drive_logs
          (id, material_id, status, drive_file_id, drive_folder_path, file_size, triggered_by)
          VALUES (?, ?, 'success', ?, ?, ?, ?)`)
          .bind(crypto.randomUUID(), material.id, uploaded.id, folderSegments.join('/'), uploaded.size, triggeredBy),
      ]);
      success += 1;
    } catch (error: any) {
      const message = formatError(error, '[briefing-material]').slice(0, 800);
      await db.batch([
        db.prepare(`UPDATE briefing_materials SET drive_status='failed', drive_attempt_count=drive_attempt_count+1,
          drive_error=?, updated_at=datetime('now') WHERE id=?`).bind(message, material.id),
        db.prepare(`INSERT INTO briefing_material_drive_logs
          (id, material_id, status, error_message, triggered_by) VALUES (?, ?, 'failed', ?, ?)`)
          .bind(crypto.randomUUID(), material.id, message, triggeredBy),
      ]);
      failed += 1;
    }
  }
  return { processed: materials.length, success, failed };
}
