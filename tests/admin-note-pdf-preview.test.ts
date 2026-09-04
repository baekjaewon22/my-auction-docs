import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import {
  ADMIN_NOTE_PDF_PREVIEW_MAX_BYTES,
  assertSafeAdminNotePdfBlob,
  safeAdminNotePdfDataUrlBlob,
} from '../src/react-app/lib/admin-note-pdf-preview.ts';

const page = readFileSync(new URL('../src/react-app/pages/AdminNotes.tsx', import.meta.url), 'utf8');
const css = readFileSync(new URL('../src/react-app/index.css', import.meta.url), 'utf8');
const api = readFileSync(new URL('../src/react-app/api.ts', import.meta.url), 'utf8');

test('공지사항 PDF는 인증 Blob을 앱 내 공용 PDF 뷰어로 바로 본다', () => {
  assert.match(page, /detail\?\.category === 'notice'[\s\S]*?attachments\.filter\(isPdfAttachment\)/);
  assert.match(page, /첨부 PDF 자동 열람/);
  assert.match(page, /view_url\?: string/);
  assert.match(page, /const previewUrl = file\.view_url \|\| file\.download_url;[\s\S]*?downloadAttachment\(previewUrl\)/);
  assert.match(page, /URL\.createObjectURL\(blob\)/);
  assert.match(page, /<PdfCanvasViewer[\s\S]*?url=\{noticePdfPreviewUrl\}/);
  assert.match(api, /downloadAttachment:[\s\S]*?return res\.blob\(\)/);
});

test('PDF 바로보기는 Blob과 Data URL의 실제 서명과 10MB 상한을 검증한다', async () => {
  await assert.doesNotReject(assertSafeAdminNotePdfBlob(new Blob(['%PDF-1.7\n'])));
  await assert.rejects(assertSafeAdminNotePdfBlob(new Blob(['not-pdf'])), /PDF 형식/);
  await assert.rejects(
    assertSafeAdminNotePdfBlob(new Blob([new Uint8Array(ADMIN_NOTE_PDF_PREVIEW_MAX_BYTES + 1)])),
    /10MB/,
  );
  const base64Blob = safeAdminNotePdfDataUrlBlob('data:application/pdf;base64,JVBERi0xLjcK');
  const percentBlob = safeAdminNotePdfDataUrlBlob('data:application/pdf,%25PDF-1.7');
  assert.equal(base64Blob.type, 'application/pdf');
  assert.equal(percentBlob.type, 'application/pdf');
  assert.equal(new TextDecoder().decode(await base64Blob.slice(0, 5).arrayBuffer()), '%PDF-');
  assert.throws(() => safeAdminNotePdfDataUrlBlob('data:application/pdf;base64,bm90LXBkZg=='), /PDF 형식/);
  assert.throws(() => safeAdminNotePdfDataUrlBlob('data:text/plain;base64,JVBERi0='), /주소/);
});

test('바로보기와 다운로드를 분리하고 Blob URL을 회수한다', () => {
  assert.match(page, /link\.download = file\.file_name/);
  assert.match(page, /window\.open\(url, '_blank'/);
  assert.match(page, /const downloadAttachment = async/);
  assert.match(page, /const downloadAttachment = async[\s\S]*?if \(file\.download_url\)[\s\S]*?downloadAttachment\(file\.download_url\)/);
  assert.match(page, /URL\.revokeObjectURL\(noticePdfPreviewObjectUrl\.current\)/);
  assert.match(page, /\+\+noticePdfPreviewRequestId\.current/);
  assert.match(page, /noticePdfPreviewDetailId\.current !== detailId/);
  assert.match(page, /원본 열기/);
  assert.match(page, /safeAdminNotePdfDataUrlBlob\(String\(file\.file_data \|\| ''\)\)/);
  assert.match(page, /setComments\(\[\]\);[\s\S]*?setAttachments\(\[\]\);[\s\S]*?detailRequestId\.current !== requestId/);
  assert.match(page, /const clearDetail = useCallback\(\(\) => \{[\s\S]*?detailRequestId\.current \+= 1;[\s\S]*?nextParams\.delete\('note'\)/);
  assert.match(page, /\}, \[activeCategory, activeLegalSubcategory, communitySection\]\);/);
});

test('공지 상세에서 첫 PDF를 자동 선택하고 여러 PDF를 접근 가능한 탭으로 전환한다', () => {
  assert.match(page, /noticePdfAttachments\.find\(file => file\.id === current\?\.id\) \|\| noticePdfAttachments\[0\]/);
  assert.match(page, /noticePdfPreview && noticePdfAttachments\.some\(attachment => attachment\.id === noticePdfPreview\.id\)/);
  assert.match(page, /className="admin-note-inline-pdf" aria-labelledby="admin-note-inline-pdf-title"/);
  assert.match(page, /role="tablist" aria-label="공지사항 PDF 선택"/);
  assert.match(page, /role="tab"[\s\S]*?aria-controls="admin-note-inline-pdf-panel"[\s\S]*?aria-selected=\{noticePdfPreview\.id === file\.id\}[\s\S]*?tabIndex=\{noticePdfPreview\.id === file\.id \? 0 : -1\}/);
  assert.match(page, /event\.key === 'ArrowRight'[\s\S]*?event\.key === 'ArrowLeft'[\s\S]*?tabs\[nextIndex\]\.focus\(\)/);
  assert.match(page, /role="tabpanel"[\s\S]*?aria-labelledby=/);
  assert.match(page, /role="status">PDF를 불러오는 중/);
  assert.match(page, /role="alert"[\s\S]*?다시 시도/);
  assert.doesNotMatch(page, /className="admin-note-pdf-preview-overlay"/);
});

test('커뮤니티 저장·댓글·팝업 동작은 동기 ref로 중복 요청을 차단한다', () => {
  assert.match(page, /const savingRef = useRef\(false\)/);
  assert.match(page, /const save = async \(\) => \{[\s\S]*?if \(savingRef\.current\) return;[\s\S]*?savingRef\.current = true;[\s\S]*?finally \{[\s\S]*?savingRef\.current = false/);
  assert.match(page, /const handleCreate = async \(\) => \{[\s\S]*?if \(submittingRef\.current\) return;[\s\S]*?submittingRef\.current = true;[\s\S]*?finally \{[\s\S]*?submittingRef\.current = false/);
  assert.match(page, /const handleAddComment = async \(\) => \{[\s\S]*?if \(commentLoadingRef\.current\) return;[\s\S]*?commentLoadingRef\.current = true;[\s\S]*?finally \{[\s\S]*?commentLoadingRef\.current = false/);
});

test('PDF 뷰어와 커뮤니티 버튼은 모바일 44px 터치 영역을 사용한다', () => {
  assert.match(css, /@media \(max-width: 768px\)[\s\S]*?\.admin-notes-page \.btn,[\s\S]*?\.admin-note-inline-pdf-tab\s*\{[\s\S]*?min-height:\s*44px/);
  assert.match(css, /\.admin-note-inline-pdf-viewer\s*\{[\s\S]*?height:\s*72vh;[\s\S]*?min-height:\s*68vh/);
  assert.match(css, /\.admin-notes-page :where\(\.btn, \.btn-icon-sm, \.admin-notes-search-button\):focus-visible/);
});
