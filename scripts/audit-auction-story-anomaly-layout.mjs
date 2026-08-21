import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const fixtureUrl = pathToFileURL(path.join(root, 'tests', 'fixtures', 'auction-story-anomaly-layout-audit.html')).href;
const chromePath = process.env.MOBILE_AUDIT_CHROME || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const widths = [320, 360, 390, 430, 600, 768, 900, 1024, 1280, 1440, 1920, 2560];
const port = await new Promise((resolve, reject) => { const server = net.createServer(); server.once('error', reject); server.listen(0, '127.0.0.1', () => { const address = server.address(); server.close(() => resolve(address.port)); }); });
const profile = mkdtempSync(path.join(os.tmpdir(), 'auction-story-audit-'));
const chrome = spawn(chromePath, ['--headless=new', '--disable-gpu', '--allow-file-access-from-files', `--user-data-dir=${profile}`, `--remote-debugging-port=${port}`, 'about:blank'], { stdio: 'ignore', windowsHide: true });
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

try {
  let target;
  for (let attempt = 0; attempt < 60; attempt += 1) { try { const response = await fetch(`http://127.0.0.1:${port}/json/list`); target = (await response.json()).find(item => item.type === 'page'); if (target) break; } catch {} await delay(100); }
  if (!target) throw new Error('Chrome DevTools target was not available');
  const socket = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => { socket.addEventListener('open', resolve, { once: true }); socket.addEventListener('error', reject, { once: true }); });
  let sequence = 0;
  const pending = new Map();
  socket.addEventListener('message', ({ data }) => { const message = JSON.parse(data); const request = pending.get(message.id); if (!request) return; pending.delete(message.id); message.error ? request.reject(new Error(message.error.message)) : request.resolve(message.result); });
  const send = (method, params = {}) => new Promise((resolve, reject) => { const id = ++sequence; pending.set(id, { resolve, reject }); socket.send(JSON.stringify({ id, method, params })); });
  await send('Page.enable'); await send('Runtime.enable');
  const results = [];
  for (const width of widths) {
    await send('Emulation.setDeviceMetricsOverride', { width, height: width <= 430 ? 780 : 900, deviceScaleFactor: 1, mobile: width <= 600 });
    await send('Page.navigate', { url: fixtureUrl }); await delay(250);
    const evaluation = await send('Runtime.evaluate', { returnByValue: true, expression: `(() => { const cards=[...document.querySelectorAll('.auction-story-card')]; const controls=document.querySelector('.auction-story-controls'); return { documentWidth:document.documentElement.scrollWidth, cardOverflow:cards.some(card=>card.scrollWidth>card.clientWidth), controlsOverflow:controls.scrollWidth>controls.clientWidth, columns:getComputedStyle(document.querySelector('.auction-story-list')).gridTemplateColumns.split(' ').filter(Boolean).length, stageColumns:getComputedStyle(document.querySelector('.auction-story-stages')).gridTemplateColumns.split(' ').filter(Boolean).length }; })()` });
    results.push({ width, ...evaluation.result.value });
  }
  socket.close();
  console.log(JSON.stringify(results, null, 2));
  const failures = results.filter(item => item.documentWidth > item.width || item.cardOverflow || item.controlsOverflow || (item.width <= 900 ? item.columns !== 1 : item.columns !== 2) || (item.width <= 390 ? item.stageColumns !== 1 : item.stageColumns !== 3));
  if (failures.length) { console.error(`Auction story layout audit failed at: ${failures.map(item => item.width).join(', ')}`); process.exitCode = 1; }
} finally {
  chrome.kill();
  if (chrome.exitCode === null) await new Promise(resolve => chrome.once('exit', resolve));
  rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
}
