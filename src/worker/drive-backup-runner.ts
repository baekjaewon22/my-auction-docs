// Drive 자동 백업 배치 실행기 — Cron + 수동 트리거 공용
// - refresh_token → access_token
// - pending 문서 루프: PDF 렌더(Browser Rendering) → Drive 업로드 → 로그

import puppeteer from '@cloudflare/puppeteer';
import {
  decryptToken, refreshAccessToken,
  findOrCreateFolder, resolveFolderPath, uploadPdfBuffer,
} from './drive-oauth';

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
import { SignJWT } from 'jose';
const PRINT_JWT_SECRET = new TextEncoder().encode('print-token-internal-key-2026');

async function issuePrintToken(docId: string): Promise<string> {
  return await new SignJWT({ sub: 'print-bot', docId })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime('10m')
    .sign(PRINT_JWT_SECRET);
}

export async function verifyPrintToken(token: string): Promise<{ docId: string } | null> {
  try {
    const { jwtVerify } = await import('jose');
    const { payload } = await jwtVerify(token, PRINT_JWT_SECRET);
    if (payload.sub !== 'print-bot' || typeof payload.docId !== 'string') return null;
    return { docId: payload.docId };
  } catch { return null; }
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// PDF 생성 (Browser Rendering)
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

async function generatePdfForDoc(
  env: any,
  doc: { id: string; title: string },
  baseUrl: string,
): Promise<ArrayBuffer> {
  const printToken = await issuePrintToken(doc.id);
  const url = `${baseUrl}/print/${doc.id}?token=${encodeURIComponent(printToken)}`;

  const browser = await puppeteer.launch(env.BROWSER);
  try {
    const page = await browser.newPage();
    // A4: 210mm × 297mm = 794px × 1123px at 96dpi. deviceScaleFactor=2로 고해상도 렌더링
    await page.setViewport({ width: 794, height: 1123, deviceScaleFactor: 2 });
    await page.goto(url, { waitUntil: 'networkidle0', timeout: 45_000 });

    // 물건분석보고서는 외부 이미지가 많아 추가 대기
    const isPropertyReport = (doc.title || '').includes('물건') || (doc.title || '').includes('분석');
    if (isPropertyReport) {
      await new Promise(r => setTimeout(r, 4_000));
    } else {
      await new Promise(r => setTimeout(r, 1_500));
    }

    // 이미지 로딩 완료 대기 + SPA의 __printReady 신호 대기
    await page.evaluate(`new Promise(resolve => {
      const imgs = Array.from(document.querySelectorAll('img'));
      const waitImgs = Promise.all(imgs.map(img => {
        if (img.complete) return Promise.resolve();
        return new Promise(r => {
          img.addEventListener('load', () => r(null), { once: true });
          img.addEventListener('error', () => r(null), { once: true });
        });
      }));
      const waitReady = new Promise(r => {
        if (window.__printReady) return r(null);
        const iv = setInterval(() => {
          if (window.__printReady) { clearInterval(iv); r(null); }
        }, 100);
        setTimeout(() => { clearInterval(iv); r(null); }, 10000);
      });
      Promise.all([waitImgs, waitReady]).then(() => resolve(null));
    })`);

    // 마진은 HTML에서 내부 padding으로 제어 — Puppeteer 마진 0으로 설정하여
    // 뷰포트(210mm) 와 PDF 페이지(210mm)가 1:1 매칭되도록 함 (스케일링으로 잘리는 문제 방지)
    const pdf = await page.pdf({
      format: 'A4',
      printBackground: true,
      margin: { top: '0', right: '0', bottom: '0', left: '0' },
      preferCSSPageSize: true,
    });
    // @cloudflare/puppeteer는 Uint8Array 반환 — ArrayBuffer로 정규화
    const pdfBuffer: ArrayBuffer = pdf.buffer.slice(
      pdf.byteOffset,
      pdf.byteOffset + pdf.byteLength,
    );
    return pdfBuffer;
  } finally {
    await browser.close();
  }
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 배치 실행
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

export async function runBackupBatch(
  env: any,
  opts: { triggered_by?: string; limit?: number; document_ids?: string[] } = {},
): Promise<{ processed: number; success: number; failed: number; skipped: number; error?: string; details?: Array<{ id: string; title: string; status: 'success' | 'failed'; folder?: string; file_id?: string; error?: string }> }> {
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
  const limit = Math.min(50, Math.max(1, opts.limit || 30));

  // 특정 문서 ID 지정 시: 해당 문서만 처리 (중복 체크 무시하여 재백업 허용)
  let docs: any[] = [];
  if (opts.document_ids && opts.document_ids.length > 0) {
    const placeholders = opts.document_ids.map(() => '?').join(',');
    const selected = await db.prepare(`
      SELECT d.id, d.title, d.template_id, d.branch, d.department, d.created_at, d.updated_at,
        u.name as author_name, u.branch as author_branch, u.department as author_department,
        u.position_title as author_position,
        t.title as template_name,
        (SELECT MAX(s.signed_at) FROM approval_steps s WHERE s.document_id = d.id AND s.status = 'approved') as approved_at
      FROM documents d
      LEFT JOIN users u ON u.id = d.author_id
      LEFT JOIN templates t ON t.id = d.template_id
      WHERE d.id IN (${placeholders}) AND d.status = 'approved' AND d.cancelled = 0
    `).bind(...opts.document_ids).all<any>();
    docs = selected.results || [];
  } else {
    const pending = await db.prepare(`
      SELECT d.id, d.title, d.template_id, d.branch, d.department, d.created_at, d.updated_at,
        u.name as author_name, u.branch as author_branch, u.department as author_department,
        u.position_title as author_position,
        t.title as template_name,
        (SELECT MAX(s.signed_at) FROM approval_steps s WHERE s.document_id = d.id AND s.status = 'approved') as approved_at
      FROM documents d
      LEFT JOIN users u ON u.id = d.author_id
      LEFT JOIN templates t ON t.id = d.template_id
      WHERE d.status = 'approved' AND d.cancelled = 0
        AND NOT EXISTS (SELECT 1 FROM approval_steps s WHERE s.document_id = d.id AND s.status != 'approved')
        AND NOT EXISTS (SELECT 1 FROM drive_backup_logs b WHERE b.document_id = d.id AND b.status = 'success')
      ORDER BY approved_at ASC
      LIMIT ?
    `).bind(limit).all<any>();
    docs = pending.results || [];
  }
  let success = 0, failed = 0;
  const skipped = 0;
  const details: Array<{ id: string; title: string; status: 'success' | 'failed'; folder?: string; file_id?: string; error?: string }> = [];

  for (const doc of docs) {
    try {
      // 폴더 해결
      const segments = buildFolderSegments(folderPattern, doc);
      const folderId = segments.length > 0
        ? await resolveFolderPath(accessToken, rootId, segments)
        : rootId;
      const filename = buildFilename(filenamePattern, doc);

      // PDF 생성
      const pdfBuffer = await generatePdfForDoc(env, doc, baseUrl);

      // 업로드
      const uploaded = await uploadPdfBuffer(accessToken, folderId, filename, pdfBuffer);

      // 로그
      await db.prepare(`
        INSERT INTO drive_backup_logs (id, document_id, run_at, status, drive_file_id, drive_folder_path, file_size, triggered_by)
        VALUES (?, ?, datetime('now'), 'success', ?, ?, ?, ?)
      `).bind(
        crypto.randomUUID(), doc.id, uploaded.id, segments.join('/') || '/', uploaded.size,
        opts.triggered_by || 'cron',
      ).run();
      success++;
      details.push({ id: doc.id, title: doc.title, status: 'success', folder: segments.join('/') || '/', file_id: uploaded.id });
    } catch (err: any) {
      const errMsg = String(err.message || err).slice(0, 500);
      await db.prepare(`
        INSERT INTO drive_backup_logs (id, document_id, run_at, status, error_message, triggered_by)
        VALUES (?, ?, datetime('now'), 'failed', ?, ?)
      `).bind(
        crypto.randomUUID(), doc.id, errMsg,
        opts.triggered_by || 'cron',
      ).run();
      failed++;
      details.push({ id: doc.id, title: doc.title, status: 'failed', error: errMsg });
    }
  }

  const summary = `성공 ${success} / 실패 ${failed} / 대기 ${docs.length === limit ? '50+' : 0}`;
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

  return { processed: docs.length, success, failed, skipped, details };
}
