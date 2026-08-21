import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const fixtureUrl = pathToFileURL(path.join(root, 'tests', 'fixtures', 'auction-schedule-layout-audit.html')).href;
const chromePath = process.env.MOBILE_AUDIT_CHROME || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const widths = [320, 360, 390, 430, 479, 480, 600, 768, 769, 900, 1023, 1024, 1280, 1366, 1399, 1400, 1440, 1920, 2560];
const viewportHeight = (width) => width === 320 ? 568 : width === 360 ? 640 : width <= 479 ? 780 : width <= 600 ? 800 : width <= 768 ? 1024 : 900;

const expectedColumns = (width) => width <= 479 ? 1 : width <= 768 ? 2 : width <= 1023 ? 3 : width <= 1399 ? 4 : 7;
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
const chromeProfile = mkdtempSync(path.join(os.tmpdir(), 'auction-schedule-audit-'));
const chrome = spawn(chromePath, [
  '--headless=new', '--disable-gpu', '--allow-file-access-from-files',
  `--user-data-dir=${chromeProfile}`,
  `--remote-debugging-port=${port}`, 'about:blank',
], { stdio: 'ignore', windowsHide: true });

try {
  let target;
  for (let attempt = 0; attempt < 60; attempt += 1) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/json/list`);
      const targets = await response.json();
      target = targets.find((item) => item.type === 'page');
      if (target) break;
    } catch {}
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
      width, height, deviceScaleFactor: 1, mobile: width <= 600,
      screenWidth: width, screenHeight: height,
    });
    await send('Page.navigate', { url: fixtureUrl });
    await delay(300);
    const evaluation = await send('Runtime.evaluate', {
      returnByValue: true,
      expression: `(() => {
        const grid = document.querySelector('.auction-schedule-week-grid');
        const cards = [...document.querySelectorAll('.auction-schedule-day')];
        const toolbar = document.querySelector('.auction-schedule-toolbar');
        const item = document.querySelector('.auction-schedule-item');
        const form = document.querySelector('#schedule-form-audit');
        const formBody = document.querySelector('#schedule-form-body-audit');
        const autofill = document.querySelector('.auction-inspection-autofill');
        const bidDateGrid = document.querySelector('.auction-inspection-bid-date-selects');
        const bidDateSelects = [...bidDateGrid.querySelectorAll('select')];
        const bidDate = document.querySelector('#bid-date-audit');
        const bidDay = document.querySelector('#bid-day-audit');
        formBody.scrollTop = formBody.scrollHeight;
        bidDay.value = '31';
        bidDay.dispatchEvent(new Event('change', { bubbles: true }));
        const formRect = form.getBoundingClientRect();
        const formBodyRect = formBody.getBoundingClientRect();
        const bidDateRect = bidDate.getBoundingClientRect();
        return {
          documentWidth: document.documentElement.scrollWidth,
          columns: getComputedStyle(grid).gridTemplateColumns.split(' ').filter(Boolean).length,
          cardCount: cards.length,
          minCardWidth: Math.round(Math.min(...cards.map(card => card.getBoundingClientRect().width))),
          toolbarFits: toolbar.scrollWidth <= toolbar.clientWidth,
          itemFits: item.scrollWidth <= item.clientWidth,
          weekendCount: document.querySelectorAll('.auction-schedule-day.weekend').length,
          holidayCount: document.querySelectorAll('.auction-schedule-day.holiday').length,
          formFits: form.scrollWidth <= form.clientWidth,
          autofillFits: autofill.scrollWidth <= autofill.clientWidth,
          bidDateColumns: getComputedStyle(bidDateGrid).gridTemplateColumns.split(' ').filter(Boolean).length,
          minBidDateSelectWidth: Math.round(Math.min(...bidDateSelects.map(select => select.getBoundingClientRect().width))),
          modalFitsViewport: formRect.top >= 0 && formRect.bottom <= innerHeight,
          bidDateVisibleAfterScroll: bidDateRect.top >= formBodyRect.top && bidDateRect.bottom <= Math.min(formBodyRect.bottom, innerHeight),
          dayOptionCount: bidDay.options.length,
          lastDaySelectable: bidDay.value === '31',
        };
      })()`,
    });
    results.push({ width, height, expectedColumns: expectedColumns(width), ...evaluation.result.value });
  }
  socket.close();
  console.log(JSON.stringify(results, null, 2));
  const failures = results.filter((result) => (
    result.documentWidth > result.width
    || result.columns !== result.expectedColumns
    || result.cardCount !== 7
    || !result.toolbarFits
    || !result.itemFits
    || result.weekendCount !== 2
    || result.holidayCount !== 1
    || result.minCardWidth < 145
    || !result.formFits
    || !result.autofillFits
    || result.bidDateColumns !== 3
    || result.minBidDateSelectWidth < 65
    || !result.modalFitsViewport
    || !result.bidDateVisibleAfterScroll
    || result.dayOptionCount !== 32
    || !result.lastDaySelectable
  ));
  if (failures.length) {
    console.error(`Auction schedule layout audit failed at: ${failures.map(item => item.width).join(', ')}`);
    process.exitCode = 1;
  }
} finally {
  chrome.kill();
  if (chrome.exitCode === null) await new Promise((resolve) => chrome.once('exit', resolve));
  rmSync(chromeProfile, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
}
