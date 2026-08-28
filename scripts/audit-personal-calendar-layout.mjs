import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import net from 'node:net';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const fixtureUrl = pathToFileURL(path.join(root, 'tests', 'fixtures', 'personal-calendar-layout-audit.html')).href;
const chromePath = process.env.MOBILE_AUDIT_CHROME || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const viewports = [
  { width: 320, height: 568, touch: true },
  { width: 360, height: 640, touch: true },
  { width: 390, height: 780, touch: true },
  { width: 430, height: 780, touch: true },
  { width: 600, height: 800, touch: true },
  { width: 667, height: 375, touch: true },
  { width: 736, height: 414, touch: true },
  { width: 768, height: 1024, touch: true },
  { width: 812, height: 375, touch: true },
  { width: 844, height: 390, touch: true },
  { width: 896, height: 414, touch: true },
  { width: 932, height: 430, touch: true },
  ...[900, 1024, 1280, 1366, 1440, 1920, 2560].map((width) => ({ width, height: 900, touch: false })),
];

const getFreePort = () => new Promise((resolve, reject) => {
  const server = net.createServer();
  server.once('error', reject);
  server.listen(0, '127.0.0.1', () => {
    const address = server.address();
    server.close(() => resolve(address.port));
  });
});

const delay = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));
const port = await getFreePort();
const chromeProfile = mkdtempSync(path.join(root, '.tmp-personal-calendar-audit-'));
const chrome = spawn(chromePath, [
  '--headless=new',
  '--disable-gpu',
  '--allow-file-access-from-files',
  `--user-data-dir=${chromeProfile}`,
  `--remote-debugging-port=${port}`,
  'about:blank',
], { stdio: 'ignore', windowsHide: true });

try {
  let target;
  for (let attempt = 0; attempt < 60; attempt += 1) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/json/list`);
      const targets = await response.json();
      target = targets.find((item) => item.type === 'page');
      if (target) break;
    } catch {
      // Chrome is still starting.
    }
    await delay(100);
  }
  if (!target) throw new Error('Chrome DevTools target was not available');

  const socket = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    socket.addEventListener('open', resolve, { once: true });
    socket.addEventListener('error', reject, { once: true });
  });

  let sequence = 0;
  const pending = new Map();
  socket.addEventListener('message', ({ data }) => {
    const message = JSON.parse(data);
    if (!message.id || !pending.has(message.id)) return;
    const request = pending.get(message.id);
    pending.delete(message.id);
    if (message.error) request.reject(new Error(message.error.message));
    else request.resolve(message.result);
  });
  const send = (method, params = {}) => new Promise((resolve, reject) => {
    const id = ++sequence;
    pending.set(id, { resolve, reject });
    socket.send(JSON.stringify({ id, method, params }));
  });

  await send('Page.enable');
  await send('Runtime.enable');
  const results = [];
  for (const { width, height, touch } of viewports) {
    await send('Emulation.setTouchEmulationEnabled', { enabled: touch, ...(touch ? { maxTouchPoints: 5 } : {}) });
    await send('Emulation.setDeviceMetricsOverride', {
      width,
      height,
      deviceScaleFactor: 1,
      mobile: touch,
      screenWidth: width,
      screenHeight: height,
    });
    await send('Page.navigate', { url: fixtureUrl });
    await delay(350);
    const evaluation = await send('Runtime.evaluate', {
      returnByValue: true,
      expression: `(() => {
        const grid = document.querySelector('.personal-calendar-grid');
        const viewport = document.querySelector('.personal-calendar-grid-scroll');
        const stage = document.querySelector('.personal-calendar-grid-stage');
        const canvas = document.querySelector('.personal-calendar-grid-canvas');
        const days = [...document.querySelectorAll('.personal-calendar-day')];
        const columns = getComputedStyle(grid).gridTemplateColumns.split(' ').filter(Boolean).length;
        const rowHeights = Array.from({ length: 6 }, (_, row) =>
          days.slice(row * 7, row * 7 + 7).map((day) => Math.round(day.getBoundingClientRect().height))
        );
        const equalRows = rowHeights.every((row) => row.every((height) => height === row[0]));
        const expandedEventRow = rowHeights[1][0] > rowHeights[0][0];
        const chip = document.querySelector('.personal-calendar-event-chip:not(.auction)');
        const chipRect = chip?.getBoundingClientRect();
        const auctionChip = document.querySelector('.personal-calendar-event-chip.auction');
        const auctionChipRect = auctionChip?.getBoundingClientRect();
        const inspectionChip = document.querySelector('.personal-calendar-event-chip.inspection');
        const inspectionChipRect = inspectionChip?.getBoundingClientRect();
        const toolbar = document.querySelector('.personal-calendar-toolbar');
        const viewSlider = document.querySelector('.personal-calendar-view-slider');
        const viewSliderRect = viewSlider.getBoundingClientRect();
        const detail = document.querySelector('#calendar-detail-audit');
        const detailRect = detail.getBoundingClientRect();
        const initialStageWidth = stage.getBoundingClientRect().width;
        const initialCanvasWidth = canvas.getBoundingClientRect().width;
        const initialWeekdayHeight = document.querySelector('.personal-calendar-weekdays span').getBoundingClientRect().height;
        const initialScale = new DOMMatrixReadOnly(getComputedStyle(canvas).transform).a;
        const touchCalendar = matchMedia('(max-width: 600px), (pointer: coarse)').matches || navigator.maxTouchPoints > 0;
        const initialFit = !touchCalendar || (
          Math.abs(initialStageWidth - viewport.clientWidth) <= 1
          && Math.abs(initialCanvasWidth - viewport.clientWidth) <= 1
          && viewport.scrollWidth <= viewport.clientWidth + 1
        );
        let zoomRestoresReadability = true;
        let fitResetWorks = true;
        let zoomDiagnostics = null;
        if (touchCalendar) {
          const targetZoom = Math.min(1.8, Math.max(1, initialScale + 0.4));
          window.setCalendarAuditZoom(targetZoom);
          const zoomedWeekdayHeight = document.querySelector('.personal-calendar-weekdays span').getBoundingClientRect().height;
          const zoomedAuctionHeight = auctionChip.getBoundingClientRect().height;
          const zoomedScale = new DOMMatrixReadOnly(getComputedStyle(canvas).transform).a;
          const zoomCreatedPanArea = viewport.scrollWidth > viewport.clientWidth;
          zoomDiagnostics = { targetZoom, zoomedWeekdayHeight, zoomedAuctionHeight, zoomedScale, zoomCreatedPanArea };
          zoomRestoresReadability = Math.abs(zoomedScale - targetZoom) < 0.001
            && zoomedScale > initialScale
            && zoomedWeekdayHeight > initialWeekdayHeight
            && zoomedAuctionHeight >= 24
            && zoomCreatedPanArea;
          viewport.scrollLeft = 100;
          const movedBeforeFit = viewport.scrollLeft > 0;
          window.fitCalendarAudit();
          fitResetWorks = movedBeforeFit && viewport.scrollLeft === 0;
        }
        return {
          documentWidth: document.documentElement.scrollWidth,
          columns,
          equalRows,
          expandedEventRow,
          toolbarFits: toolbar.scrollWidth <= toolbar.clientWidth,
          viewSliderFits: viewSlider.scrollWidth <= viewSlider.clientWidth && viewSliderRect.left >= 0 && viewSliderRect.right <= innerWidth,
          eventMode: innerWidth <= 600 && chipRect ? (chipRect.width <= 8 && chipRect.height <= 8 ? 'dot' : 'invalid') : 'label',
          auctionLabelVisible: auctionChipRect && auctionChipRect.height > 0 && getComputedStyle(auctionChip).color !== 'rgba(0, 0, 0, 0)',
          auctionChipFits: auctionChip.scrollWidth <= auctionChip.clientWidth,
          inspectionVisible: inspectionChipRect && inspectionChipRect.height > 0 && getComputedStyle(inspectionChip).color !== 'rgba(0, 0, 0, 0)',
          detailFitsViewport: detailRect.top >= 0 && detailRect.bottom <= innerHeight && detail.scrollWidth <= detail.clientWidth,
          initialFit,
          initialScale,
          touchCalendar,
          zoomRestoresReadability,
          zoomDiagnostics,
          fitResetWorks,
          gridWidth: Math.round(grid.getBoundingClientRect().width),
          rowHeights: rowHeights.map((row) => row[0]),
        };
      })()`,
    });
    results.push({ width, height, touch, ...evaluation.result.value });
  }
  socket.close();
  console.log(JSON.stringify(results, null, 2));

  const failures = results.filter((result) => (
    result.documentWidth > result.width
    || result.columns !== 7
    || !result.equalRows
    || !result.expandedEventRow
    || !result.toolbarFits
    || !result.viewSliderFits
    || result.eventMode === 'invalid'
    || !result.auctionLabelVisible
    || !result.auctionChipFits
    || !result.inspectionVisible
    || !result.detailFitsViewport
    || !result.initialFit
    || !result.zoomRestoresReadability
    || !result.fitResetWorks
  ));
  if (failures.length > 0) {
    console.error(`Personal calendar layout audit failed at: ${failures.map((item) => item.width).join(', ')}`);
    process.exitCode = 1;
  }
} finally {
  chrome.kill();
  if (chrome.exitCode === null) await new Promise((resolve) => chrome.once('exit', resolve));
  rmSync(chromeProfile, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
}
