import { useEffect, useRef, useState } from 'react';
import { Maximize2, Minus, Plus } from 'lucide-react';
import {
  GlobalWorkerOptions,
  getDocument,
  type PDFDocumentProxy,
  type PDFPageProxy,
} from 'pdfjs-dist';
import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';

GlobalWorkerOptions.workerSrc = pdfWorkerUrl;

interface PdfPageProps {
  page: PDFPageProxy;
  containerWidth: number;
  zoom: number;
}

function PdfPage({ page, containerWidth, zoom }: PdfPageProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || containerWidth <= 0) return;

    const baseViewport = page.getViewport({ scale: 1 });
    const fitScale = Math.max(0.1, (containerWidth - 24) / baseViewport.width);
    const displayScale = fitScale * zoom;
    const pixelRatio = Math.min(window.devicePixelRatio || 1, 2);
    const renderViewport = page.getViewport({ scale: displayScale * pixelRatio });
    const context = canvas.getContext('2d');
    if (!context) return;

    canvas.width = Math.floor(renderViewport.width);
    canvas.height = Math.floor(renderViewport.height);
    canvas.style.width = `${Math.floor(baseViewport.width * displayScale)}px`;
    canvas.style.height = `${Math.floor(baseViewport.height * displayScale)}px`;

    const renderTask = page.render({ canvasContext: context, viewport: renderViewport, canvas });
    renderTask.promise.catch((error) => {
      if (error?.name !== 'RenderingCancelledException') console.error('PDF page render failed', error);
    });

    return () => renderTask.cancel();
  }, [containerWidth, page, zoom]);

  return <canvas ref={canvasRef} className="minutes-pdf-page" aria-label={`${page.pageNumber}페이지`} />;
}

export default function PdfCanvasViewer({ url, title }: { url: string; title: string }) {
  const viewportRef = useRef<HTMLDivElement>(null);
  const [document, setDocument] = useState<PDFDocumentProxy | null>(null);
  const [pages, setPages] = useState<PDFPageProxy[]>([]);
  const [containerWidth, setContainerWidth] = useState(0);
  const [zoom, setZoom] = useState(1);
  const [error, setError] = useState('');
  const zoomRef = useRef(zoom);
  useEffect(() => { zoomRef.current = zoom; }, [zoom]);

  useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    const updateWidth = () => setContainerWidth(viewport.clientWidth);
    updateWidth();
    const observer = new ResizeObserver(updateWidth);
    observer.observe(viewport);
    return () => observer.disconnect();
  }, []);

  // 모바일 제스처 줌: 두 손가락 핀치 + 한 손가락 더블탭. touch-action이 네이티브 핀치를
  // 막아 두 손가락 이벤트가 우리 핸들러로 들어오므로, 여기서 zoom 상태를 직접 구동한다
  // (pdf.js가 새 배율로 재렌더 → 선명한 확대). 회의록·오늘의 뉴스 두 화면 공용.
  useEffect(() => {
    const el = viewportRef.current;
    if (!el) return;
    let startDist = 0;
    let startZoom = 1;
    let lastTap = 0;
    const distance = (touches: TouchList) => Math.hypot(
      touches[0].clientX - touches[1].clientX,
      touches[0].clientY - touches[1].clientY,
    );
    const clamp = (value: number) => Math.min(2.5, Math.max(0.5, value));
    const onTouchStart = (event: TouchEvent) => {
      if (event.touches.length === 2) {
        startDist = distance(event.touches);
        startZoom = zoomRef.current;
      } else if (event.touches.length === 1) {
        const now = Date.now();
        if (now - lastTap < 300) {
          event.preventDefault();
          setZoom((current) => (current > 1 ? 1 : 2));
        }
        lastTap = now;
      }
    };
    const onTouchMove = (event: TouchEvent) => {
      if (event.touches.length === 2 && startDist > 0) {
        event.preventDefault();
        setZoom(clamp(startZoom * (distance(event.touches) / startDist)));
      }
    };
    const onTouchEnd = (event: TouchEvent) => {
      if (event.touches.length < 2) startDist = 0;
    };
    el.addEventListener('touchstart', onTouchStart, { passive: false });
    el.addEventListener('touchmove', onTouchMove, { passive: false });
    el.addEventListener('touchend', onTouchEnd);
    return () => {
      el.removeEventListener('touchstart', onTouchStart);
      el.removeEventListener('touchmove', onTouchMove);
      el.removeEventListener('touchend', onTouchEnd);
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    const loadingTask = getDocument(url);

    loadingTask.promise
      .then(async (pdf) => {
        if (cancelled) {
          await pdf.destroy();
          return;
        }
        const loadedPages = await Promise.all(
          Array.from({ length: pdf.numPages }, (_, index) => pdf.getPage(index + 1)),
        );
        if (!cancelled) {
          setDocument(pdf);
          setPages(loadedPages);
        }
      })
      .catch((loadError) => {
        if (!cancelled) {
          console.error('PDF document load failed', loadError);
          setError('PDF를 표시할 수 없습니다.');
        }
      });

    return () => {
      cancelled = true;
      loadingTask.destroy();
    };
  }, [url]);

  useEffect(() => () => { document?.destroy(); }, [document]);

  const changeZoom = (next: number) => setZoom(Math.min(2.5, Math.max(0.5, next)));

  return (
    <div className="minutes-pdf-viewer">
      <div className="minutes-pdf-toolbar" aria-label="PDF 확대 및 축소">
        <button type="button" className="btn btn-sm" onClick={() => changeZoom(zoom - 0.25)} disabled={zoom <= 0.5} title="축소">
          <Minus size={15} />
        </button>
        <span className="minutes-pdf-zoom">{Math.round(zoom * 100)}%</span>
        <button type="button" className="btn btn-sm" onClick={() => changeZoom(zoom + 0.25)} disabled={zoom >= 2.5} title="확대">
          <Plus size={15} />
        </button>
        <button type="button" className="btn btn-sm" onClick={() => setZoom(1)} title="화면 너비에 맞춤">
          <Maximize2 size={14} /> 맞춤
        </button>
        {document && <span className="minutes-pdf-page-count">{document.numPages}페이지</span>}
      </div>
      <div ref={viewportRef} className="minutes-pdf-scroll" role="document" aria-label={title}>
        {error ? (
          <div className="minutes-pdf-loading">{error}</div>
        ) : pages.length === 0 ? (
          <div className="minutes-pdf-loading">PDF 표시 준비 중...</div>
        ) : (
          <div className="minutes-pdf-pages">
            {pages.map(page => (
              <PdfPage key={page.pageNumber} page={page} containerWidth={containerWidth} zoom={zoom} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
