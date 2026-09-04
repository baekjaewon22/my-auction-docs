import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {
  MAX_NOTICE_ATTACHMENT_BYTES,
  MAX_NOTICE_ATTACHMENTS_TOTAL_BYTES,
  NoticeAttachmentValidationError,
  decodeAttachmentDataUrl,
  hasPdfSignature,
  normalizeNoticeAttachments,
  noticePdfDownloadResponseHeaders,
  noticePdfResponseHeaders,
} from '../src/worker/lib/admin-note-attachments.ts';

function dataUrl(contentType: string, bytes: Uint8Array): string {
  return `data:${contentType};base64,${Buffer.from(bytes).toString('base64')}`;
}

test('notice PDF normalization trusts decoded bytes rather than client size and MIME', () => {
  const pdf = new TextEncoder().encode('%PDF-1.7\nbody');
  const [normalized] = normalizeNoticeAttachments([{
    file_name: 'notice.pdf',
    file_type: 'application/octet-stream',
    file_size: 1,
    file_data: dataUrl('application/octet-stream', pdf),
  }]);

  assert.equal(normalized.file_type, 'application/pdf');
  assert.equal(normalized.file_size, pdf.byteLength);
  assert.equal(hasPdfSignature(decodeAttachmentDataUrl(normalized.file_data)!.buffer), true);
});

test('notice attachment rejects active content and HTML disguised as PDF', () => {
  const html = new TextEncoder().encode('<script>alert(1)</script>');

  assert.throws(
    () => normalizeNoticeAttachments([{
      file_name: 'disguised.pdf',
      file_type: 'application/pdf',
      file_data: dataUrl('text/html', html),
    }]),
    (error: unknown) => error instanceof NoticeAttachmentValidationError
      && /실제 PDF/.test(error.message)
      && error.status === 400,
  );

  assert.throws(
    () => normalizeNoticeAttachments([{
      file_name: 'page.html',
      file_type: 'text/html',
      file_data: dataUrl('text/html', html),
    }]),
    (error: unknown) => error instanceof NoticeAttachmentValidationError
      && /실행 가능한 웹 문서/.test(error.message),
  );
});

test('notice attachment enforces decoded per-file and per-notice byte limits', () => {
  const tooLarge = new Uint8Array(MAX_NOTICE_ATTACHMENT_BYTES + 1);
  assert.throws(
    () => normalizeNoticeAttachments([{
      file_name: 'large.bin',
      file_type: 'application/octet-stream',
      file_data: dataUrl('application/octet-stream', tooLarge),
    }]),
    (error: unknown) => error instanceof NoticeAttachmentValidationError && error.status === 413,
  );

  const half = new Uint8Array(MAX_NOTICE_ATTACHMENTS_TOTAL_BYTES / 2);
  half.set(new TextEncoder().encode('%PDF-'));
  const one = new TextEncoder().encode('%PDF-x');
  assert.throws(
    () => normalizeNoticeAttachments([
      { file_name: 'first.pdf', file_type: 'application/pdf', file_data: dataUrl('application/pdf', half) },
      { file_name: 'second.pdf', file_type: 'application/pdf', file_data: dataUrl('application/pdf', half) },
      { file_name: 'third.pdf', file_type: 'application/pdf', file_data: dataUrl('application/pdf', one) },
    ]),
    (error: unknown) => error instanceof NoticeAttachmentValidationError
      && error.status === 413
      && /합계/.test(error.message),
  );
});

test('notice PDF response is inline, non-cacheable, and nosniff', () => {
  assert.deepEqual(noticePdfResponseHeaders('안내 문서.pdf', 123), {
    'Content-Type': 'application/pdf',
    'Content-Length': '123',
    'Content-Disposition': "inline; filename*=UTF-8''%EC%95%88%EB%82%B4%20%EB%AC%B8%EC%84%9C.pdf",
    'Cache-Control': 'private, no-store',
    'X-Content-Type-Options': 'nosniff',
  });
  assert.deepEqual(noticePdfDownloadResponseHeaders('안내 문서.pdf', 123), {
    'Content-Type': 'application/pdf',
    'Content-Length': '123',
    'Content-Disposition': "attachment; filename*=UTF-8''%EC%95%88%EB%82%B4%20%EB%AC%B8%EC%84%9C.pdf",
    'Cache-Control': 'private, no-store',
    'X-Content-Type-Options': 'nosniff',
  });
});

test('legacy notice PDF download decoding remains compatible above the preview cap', () => {
  const legacyPdf = new Uint8Array(MAX_NOTICE_ATTACHMENT_BYTES + 1);
  legacyPdf.set(new TextEncoder().encode('%PDF-'));
  const encoded = dataUrl('application/pdf', legacyPdf);

  assert.throws(
    () => decodeAttachmentDataUrl(encoded, MAX_NOTICE_ATTACHMENT_BYTES),
    (error: unknown) => error instanceof NoticeAttachmentValidationError && error.status === 413,
  );
  const downloadable = decodeAttachmentDataUrl(encoded);
  assert.ok(downloadable);
  assert.equal(downloadable.buffer.byteLength, legacyPdf.byteLength);
  assert.equal(hasPdfSignature(downloadable.buffer), true);
});

test('notice PDF route keeps raw data URLs out of notice PDF detail metadata', () => {
  const source = readFileSync(new URL('../src/worker/routes/admin-notes.ts', import.meta.url), 'utf8');
  const storage = readFileSync(new URL('../src/worker/lib/notice-pdfs.ts', import.meta.url), 'utf8');
  assert.match(source, /adminNotes\.get\('\/attachments\/:attachmentId\/view'/);
  assert.match(source, /adminNotes\.get\('\/attachments\/:attachmentId\/download'/);
  assert.match(source, /loadNoticePdfForDelivery\([\s\S]*\(row\) => canReadNote\(row, user, viewerInfo, role\)/);
  assert.match(storage, /JOIN admin_notes n ON n\.id = a\.note_id[\s\S]*n\.category = 'notice'/);
  const handlerStart = storage.indexOf('export async function loadNoticePdfForDelivery');
  const permissionCheck = storage.indexOf('if (!await canRead(row))', handlerStart);
  const payloadRead = storage.indexOf("'SELECT file_data FROM admin_note_attachments", handlerStart);
  const r2Read = storage.indexOf("await bucket.get(String(row.object_key || ''))", handlerStart);
  assert.ok(handlerStart >= 0 && permissionCheck > handlerStart && payloadRead > permissionCheck && r2Read > permissionCheck,
    'authorization must run before loading the stored PDF payload');
  assert.match(source, /if \(note\.category !== 'notice' \|\| !isPdfAttachmentMetadata\(file\)\) return file;[\s\S]*file_data: '',[\s\S]*download_url: downloadUrl,[\s\S]*view_url: viewUrl/);
});
