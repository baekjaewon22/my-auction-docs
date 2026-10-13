import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const root = path.resolve(import.meta.dirname, '..');
const fixtureUrl = pathToFileURL(path.join(root, 'tests', 'fixtures', 'marketing-briefing-mobile.html')).href;
const output = path.join(root, 'artifacts', 'marketing-briefing-360.png');
const chromePath = process.env.MOBILE_AUDIT_CHROME || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const getFreePort = () => new Promise((resolve, reject) => { const server = net.createServer(); server.once('error', reject); server.listen(0, '127.0.0.1', () => { const address = server.address(); server.close(() => resolve(address.port)); }); });
const delay = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));
const port = await getFreePort();
const chrome = spawn(chromePath, ['--headless=new', '--disable-gpu', '--allow-file-access-from-files', `--remote-debugging-port=${port}`, 'about:blank'], { stdio: 'ignore', windowsHide: true });
try {
  let target;
  for (let attempt = 0; attempt < 50; attempt += 1) { try { const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json(); target = targets.find((item) => item.type === 'page'); if (target) break; } catch { /* starting */ } await delay(100); }
  if (!target) throw new Error('Chrome DevTools target was not available');
  const socket = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => { socket.addEventListener('open', resolve, { once: true }); socket.addEventListener('error', reject, { once: true }); });
  let sequence = 0; const pending = new Map();
  socket.addEventListener('message', ({ data }) => { const message = JSON.parse(data); if (!message.id || !pending.has(message.id)) return; const callbacks = pending.get(message.id); pending.delete(message.id); if (message.error) callbacks.reject(new Error(message.error.message)); else callbacks.resolve(message.result); });
  const send = (method, params = {}) => new Promise((resolve, reject) => { const id = ++sequence; pending.set(id, { resolve, reject }); socket.send(JSON.stringify({ id, method, params })); });
  await send('Page.enable'); await send('Runtime.enable');
  await send('Emulation.setDeviceMetricsOverride', { width: 360, height: 900, deviceScaleFactor: 1, mobile: true, screenWidth: 360, screenHeight: 900 });
  await send('Page.navigate', { url: fixtureUrl }); await delay(800);
  const audit = await send('Runtime.evaluate', { expression: `JSON.stringify({ready:Boolean(document.querySelector('.briefing-detail-hero')),overflow:document.documentElement.scrollWidth>document.documentElement.clientWidth,alerts:window.__briefingAlertCalls||[]})`, returnByValue: true });
  const result = JSON.parse(audit.result.value || '{}'); if (!result.ready) throw new Error('fixture did not render');
  const heightResult = await send('Runtime.evaluate', { expression: 'Math.ceil(Math.max(document.body.scrollHeight, document.documentElement.scrollHeight))', returnByValue: true });
  const height = Number(heightResult.result.value || 900);
  await send('Emulation.setDeviceMetricsOverride', { width: 360, height, deviceScaleFactor: 1, mobile: true, screenWidth: 360, screenHeight: height });
  await delay(200);
  const screenshot = await send('Page.captureScreenshot', { format: 'png', fromSurface: true, captureBeyondViewport: true, clip: { x: 0, y: 0, width: 360, height, scale: 1 } });
  mkdirSync(path.dirname(output), { recursive: true }); writeFileSync(output, Buffer.from(screenshot.data, 'base64'));
  console.log(JSON.stringify({ width: 360, height, overflow: result.overflow, alert_calls: result.alerts.length, output }));
  socket.close(); process.exitCode = result.overflow || result.alerts.length ? 1 : 0;
} finally { chrome.kill(); }
