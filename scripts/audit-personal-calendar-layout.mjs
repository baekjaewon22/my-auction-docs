import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const fixtureUrl = pathToFileURL(path.join(root, 'tests', 'fixtures', 'personal-calendar-layout-audit.html')).href;
const chromePath = process.env.MOBILE_AUDIT_CHROME || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const widths = [320, 360, 390, 430, 600, 768, 900, 1024, 1280, 1366, 1440, 1920, 2560];
const viewportHeight = (width) => width === 320 ? 568 : width === 360 ? 640 : width <= 430 ? 780 : width <= 600 ? 800 : width <= 768 ? 1024 : 900;

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
const chromeProfile = mkdtempSync(path.join(os.tmpdir(), 'personal-calendar-audit-'));
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
  for (const width of widths) {
    const height = viewportHeight(width);
    await send('Emulation.setDeviceMetricsOverride', {
      width,
      height,
      deviceScaleFactor: 1,
      mobile: width <= 600,
      screenWidth: width,
      screenHeight: height,
    });
    await send('Page.navigate', { url: fixtureUrl });
    await delay(350);
    const evaluation = await send('Runtime.evaluate', {
      returnByValue: true,
      expression: `(() => {
        const grid = document.querySelector('.personal-calendar-grid');
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
        return {
          documentWidth: document.documentElement.scrollWidth,
          columns,
          equalRows,
          expandedEventRow,
          toolbarFits: toolbar.scrollWidth <= toolbar.clientWidth,
          viewSliderFits: viewSlider.scrollWidth <= viewSlider.clientWidth && viewSliderRect.left >= 0 && viewSliderRect.right <= innerWidth,
          eventMode: innerWidth <= 600 && chipRect ? (chipRect.width <= 8 && chipRect.height <= 8 ? 'dot' : 'invalid') : 'label',
          auctionLabelVisible: innerWidth > 600 || (auctionChipRect && auctionChipRect.height >= 24 && getComputedStyle(auctionChip).color !== 'rgba(0, 0, 0, 0)'),
          auctionChipFits: auctionChip.scrollWidth <= auctionChip.clientWidth,
          inspectionVisible: innerWidth > 600
            ? inspectionChipRect && getComputedStyle(inspectionChip).color !== 'rgba(0, 0, 0, 0)'
            : inspectionChipRect && inspectionChipRect.height >= 24 && getComputedStyle(inspectionChip).color !== 'rgba(0, 0, 0, 0)',
          detailFitsViewport: detailRect.top >= 0 && detailRect.bottom <= innerHeight && detail.scrollWidth <= detail.clientWidth,
          gridWidth: Math.round(grid.getBoundingClientRect().width),
          rowHeights: rowHeights.map((row) => row[0]),
        };
      })()`,
    });
    results.push({ width, height, ...evaluation.result.value });
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
