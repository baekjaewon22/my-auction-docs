import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';

const viewer = readFileSync(new URL('../src/react-app/components/PdfCanvasViewer.tsx', import.meta.url), 'utf8');
const css = readFileSync(new URL('../src/react-app/index.css', import.meta.url), 'utf8');
const adminNotes = readFileSync(new URL('../src/react-app/pages/AdminNotes.tsx', import.meta.url), 'utf8');
const meetingMinutes = readFileSync(new URL('../src/react-app/pages/MeetingMinutes.tsx', import.meta.url), 'utf8');

test('PDF 문서 시작 시 모든 페이지 proxy를 한꺼번에 불러오지 않는다', () => {
  assert.doesNotMatch(viewer, /Promise\.all\([\s\S]*?pdf\.getPage/);
  assert.doesNotMatch(viewer, /Array\.from\([\s\S]*?pdf\.getPage\(index \+ 1\)/);
  assert.match(viewer, /setDocumentState\(\{ url, pdf \}\)/);
  assert.match(viewer, /function ActivePdfPage[\s\S]*?pdf\.getPage\(pageNumber\)/);
  assert.match(viewer, /function PdfPageSlot[\s\S]*?active \? \([\s\S]*?<ActivePdfPage/);
  assert.match(viewer, /active=\{activePages\.has\(pageNumber\)\}/);
});

test('화면 주변 canvas 수를 제한하고 멀어진 페이지 자원을 회수한다', () => {
  assert.match(viewer, /const MAX_ACTIVE_PDF_CANVASES = 5/);
  assert.match(viewer, /\.slice\(0, MAX_ACTIVE_PDF_CANVASES\)/);
  assert.match(viewer, /new IntersectionObserver\(handleLayoutChange,[\s\S]*?rootMargin: '100% 0px'/);
  assert.match(viewer, /addEventListener\('scroll', handleLayoutChange, \{ passive: true \}\)/);
  assert.match(viewer, /renderTask\.cancel\(\);[\s\S]*?canvas\.width = 0;[\s\S]*?canvas\.height = 0/);
  assert.match(viewer, /activeRenderTask\?\.cancel\(\);[\s\S]*?activeRenderTask\.promise[\s\S]*?finally\(\(\) => loadedPage\.cleanup\(\)\)/);
  assert.match(viewer, /pageRef\.current = null/);
  assert.match(css, /\.minutes-pdf-page-placeholder[\s\S]*?width: 100%; height: 100%/);
});

test('확대·핀치와 기존 공지·오늘의 뉴스·회의록 소비 계약을 유지한다', () => {
  assert.match(viewer, /setZoom\(clamp\(startZoom \* \(distance\(event\.touches\) \/ startDist\)\)\)/);
  assert.match(viewer, /setZoom\(\(current\) => \(current > 1 \? 1 : 2\)\)/);
  assert.match(viewer, /changeZoom\(zoom - 0\.25\)/);
  assert.match(viewer, /changeZoom\(zoom \+ 0\.25\)/);
  assert.match(adminNotes, /<PdfCanvasViewer[\s\S]*?url=\{articlePdfUrl\}/);
  assert.match(adminNotes, /<PdfCanvasViewer[\s\S]*?url=\{noticePdfPreviewUrl\}/);
  assert.match(meetingMinutes, /<PdfCanvasViewer key=\{pdfUrl\} url=\{pdfUrl\} title=\{viewItem\.title\}/);
});
