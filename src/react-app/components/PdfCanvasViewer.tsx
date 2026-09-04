import { useCallback, useEffect, useRef, useState } from 'react';
import { Maximize2, Minus, Plus } from 'lucide-react';
import {
  GlobalWorkerOptions,
  getDocument,
  type PDFDocumentProxy,
  type PDFPageProxy,
} from 'pdfjs-dist';
import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';

GlobalWorkerOptions.workerSrc = pdfWorkerUrl;

const MAX_ACTIVE_PDF_CANVASES = 5;
const DEFAULT_PAGE_ASPECT_RATIO = Math.SQRT2;

interface PdfPageSlotProps {
  active: boolean;
  containerWidth: number;
  pageNumber: number;
  pdf: PDFDocumentProxy;
  registerElement: (pageNumber: number, element: HTMLDivElement | null) => void;
  zoom: number;
}

interface ActivePdfPageProps {
  availableWidth: number;
  onAspectRatio: (aspectRatio: number) => void;
  pageNumber: number;
  pdf: PDFDocumentProxy;
  zoom: number;
}

function ActivePdfPage({ availableWidth, onAspectRatio, pageNumber, pdf, zoom }: ActivePdfPageProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const pageRef = useRef<PDFPageProxy | null>(null);
  const renderTaskRef = useRef<ReturnType<PDFPageProxy['render']> | null>(null);
  const [page, setPage] = useState<PDFPageProxy | null>(null);
  const [pageError, setPageError] = useState(false);

  useEffect(() => {
    let cancelled = false;
    pdf.getPage(pageNumber)
      .then((loadedPage) => {
        if (cancelled) {
          loadedPage.cleanup();
          return;
        }
        const viewport = loadedPage.getViewport({ scale: 1 });
        onAspectRatio(viewport.height / viewport.width);
        pageRef.current = loadedPage;
        setPage(loadedPage);
      })
      .catch((loadError) => {
        if (!cancelled) {
          console.error(`PDF page ${pageNumber} load failed`, loadError);
          setPageError(true);
        }
      });

    return () => {
      cancelled = true;
      const loadedPage = pageRef.current;
      const activeRenderTask = renderTaskRef.current;
      activeRenderTask?.cancel();
      renderTaskRef.current = null;
      pageRef.current = null;
      if (activeRenderTask && loadedPage) {
        void activeRenderTask.promise.catch(() => undefined).finally(() => loadedPage.cleanup());
      } else {
        loadedPage?.cleanup();
      }
    };
  }, [onAspectRatio, pageNumber, pdf]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !page || availableWidth <= 1) return;

    const baseViewport = page.getViewport({ scale: 1 });
    const fitScale = Math.max(0.1, availableWidth / baseViewport.width);
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
    renderTaskRef.current = renderTask;
    renderTask.promise.catch((renderError) => {
      if (renderError?.name !== 'RenderingCancelledException') console.error('PDF page render failed', renderError);
    });

    return () => {
      renderTask.cancel();
      if (renderTaskRef.current === renderTask) renderTaskRef.current = null;
      canvas.width = 0;
      canvas.height = 0;
    };
  }, [availableWidth, page, zoom]);

  if (pageError) {
    return <div className="minutes-pdf-page-placeholder error">페이지를 표시할 수 없습니다.</div>;
  }
  if (!page) {
    return <div className="minutes-pdf-page-placeholder">페이지 불러오는 중...</div>;
  }
  return <canvas ref={canvasRef} className="minutes-pdf-page" aria-label={`${pageNumber}페이지`} />;
}

function PdfPageSlot({ active, containerWidth, pageNumber, pdf, registerElement, zoom }: PdfPageSlotProps) {
  const [aspectRatio, setAspectRatio] = useState(DEFAULT_PAGE_ASPECT_RATIO);
  const availableWidth = Math.max(1, containerWidth - 24);
  const displayWidth = Math.floor(availableWidth * zoom);
  const displayHeight = Math.floor(displayWidth * aspectRatio);
  const updateAspectRatio = useCallback((nextAspectRatio: number) => setAspectRatio(nextAspectRatio), []);

  return (
    <div
      ref={(element) => registerElement(pageNumber, element)}
      className="minutes-pdf-page-slot"
      data-page-number={pageNumber}
      style={{ width: displayWidth, height: displayHeight }}
    >
      {active ? (
        <ActivePdfPage
          availableWidth={availableWidth}
          onAspectRatio={updateAspectRatio}
          pageNumber={pageNumber}
          pdf={pdf}
          zoom={zoom}
        />
      ) : (
        <div className="minutes-pdf-page-placeholder" aria-label={`${pageNumber}페이지`}>
          {pageNumber}페이지
        </div>
      )}
    </div>
  );
}

export default function PdfCanvasViewer({ url, title }: { url: string; title: string }) {
  const viewportRef = useRef<HTMLDivElement>(null);
  const pageElementsRef = useRef<Map<number, HTMLDivElement>>(new Map());
  const layoutFrameRef = useRef<number | null>(null);
  const [documentState, setDocumentState] = useState<{ url: string; pdf: PDFDocumentProxy } | null>(null);
  const [activePages, setActivePages] = useState<Set<number>>(() => new Set([1]));
  const [containerWidth, setContainerWidth] = useState(0);
  const [zoom, setZoom] = useState(1);
  const [errorState, setErrorState] = useState<{ url: string; message: string } | null>(null);
  const pdfDocument = documentState?.url === url ? documentState.pdf : null;
  const error = errorState?.url === url ? errorState.message : '';
  const zoomRef = useRef(zoom);
  useEffect(() => { zoomRef.current = zoom; }, [zoom]);

  const updateActivePages = useCallback(() => {
    const viewport = viewportRef.current;
    if (!viewport || pageElementsRef.current.size === 0) return;
    const viewportRect = viewport.getBoundingClientRect();
    const overscan = Math.max(viewportRect.height, 480);
    const viewportCenter = (viewportRect.top + viewportRect.bottom) / 2;
    const measured = Array.from(pageElementsRef.current.entries()).map(([pageNumber, element]) => {
      const rect = element.getBoundingClientRect();
      return {
        pageNumber,
        distance: Math.abs((rect.top + rect.bottom) / 2 - viewportCenter),
        nearby: rect.bottom >= viewportRect.top - overscan && rect.top <= viewportRect.bottom + overscan,
      };
    });
    const nearby = measured.filter(item => item.nearby);
    const candidates = (nearby.length > 0 ? nearby : measured)
      .sort((left, right) => left.distance - right.distance)
      .slice(0, MAX_ACTIVE_PDF_CANVASES)
      .map(item => item.pageNumber)
      .sort((left, right) => left - right);
    setActivePages(previous => {
      if (previous.size === candidates.length && candidates.every(pageNumber => previous.has(pageNumber))) return previous;
      return new Set(candidates);
    });
  }, []);

  const scheduleActivePageUpdate = useCallback(() => {
    if (layoutFrameRef.current !== null) window.cancelAnimationFrame(layoutFrameRef.current);
    layoutFrameRef.current = window.requestAnimationFrame(() => {
      layoutFrameRef.current = null;
      updateActivePages();
    });
  }, [updateActivePages]);

  const registerPageElement = useCallback((pageNumber: number, element: HTMLDivElement | null) => {
    if (element) pageElementsRef.current.set(pageNumber, element);
    else pageElementsRef.current.delete(pageNumber);
  }, []);

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
  // (pdf.js가 새 배율로 재렌더 → 선명한 확대). 회의록·오늘의 뉴스·공지 PDF 화면 공용.
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
        pageElementsRef.current.clear();
        setActivePages(new Set([1]));
        setErrorState(null);
        setDocumentState({ url, pdf });
      })
      .catch((loadError) => {
        if (!cancelled) {
          console.error('PDF document load failed', loadError);
          setErrorState({ url, message: 'PDF를 표시할 수 없습니다.' });
        }
      });

    return () => {
      cancelled = true;
      loadingTask.destroy();
    };
  }, [url]);

  useEffect(() => {
    if (!pdfDocument) return;
    const viewport = viewportRef.current;
    if (!viewport) return;
    const handleLayoutChange = () => scheduleActivePageUpdate();
    viewport.addEventListener('scroll', handleLayoutChange, { passive: true });
    const observer = typeof IntersectionObserver === 'undefined'
      ? null
      : new IntersectionObserver(handleLayoutChange, { root: viewport, rootMargin: '100% 0px' });
    pageElementsRef.current.forEach(element => observer?.observe(element));
    scheduleActivePageUpdate();
    return () => {
      viewport.removeEventListener('scroll', handleLayoutChange);
      observer?.disconnect();
      if (layoutFrameRef.current !== null) window.cancelAnimationFrame(layoutFrameRef.current);
      layoutFrameRef.current = null;
    };
  }, [pdfDocument, scheduleActivePageUpdate]);

  useEffect(() => {
    if (pdfDocument) scheduleActivePageUpdate();
  }, [containerWidth, pdfDocument, scheduleActivePageUpdate, zoom]);

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
        {pdfDocument && <span className="minutes-pdf-page-count">{pdfDocument.numPages}페이지</span>}
      </div>
      <div ref={viewportRef} className="minutes-pdf-scroll" role="document" aria-label={title}>
        {error ? (
          <div className="minutes-pdf-loading">{error}</div>
        ) : !pdfDocument ? (
          <div className="minutes-pdf-loading">PDF 표시 준비 중...</div>
        ) : (
          <div className="minutes-pdf-pages">
            {Array.from({ length: pdfDocument.numPages }, (_, index) => index + 1).map(pageNumber => (
              <PdfPageSlot
                key={pageNumber}
                active={activePages.has(pageNumber)}
                containerWidth={containerWidth}
                pageNumber={pageNumber}
                pdf={pdfDocument}
                registerElement={registerPageElement}
                zoom={zoom}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
