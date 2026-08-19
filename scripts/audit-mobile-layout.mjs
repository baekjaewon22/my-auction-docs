import { spawn } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import net from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const root = path.resolve(import.meta.dirname, '..');
const fixtureUrl = pathToFileURL(path.join(root, 'tests', 'fixtures', 'mobile-layout-audit.html')).href;
const chromePath = process.env.MOBILE_AUDIT_CHROME || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const widths = [360, 390, 430];

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
const chrome = spawn(chromePath, [
  '--headless=new',
  '--disable-gpu',
  '--allow-file-access-from-files',
  `--remote-debugging-port=${port}`,
  'about:blank',
], { stdio: 'ignore', windowsHide: true });

try {
  let target;
  for (let attempt = 0; attempt < 50; attempt += 1) {
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
    const { resolve, reject } = pending.get(message.id);
    pending.delete(message.id);
    if (message.error) reject(new Error(message.error.message));
    else resolve(message.result);
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
    await send('Emulation.setDeviceMetricsOverride', {
      width,
      height: 900,
      deviceScaleFactor: 1,
      mobile: true,
      screenWidth: width,
      screenHeight: 900,
    });
    await send('Page.navigate', { url: fixtureUrl });
    await delay(500);
    const evaluation = await send('Runtime.evaluate', {
      returnByValue: true,
      expression: `(() => {
        const result = document.querySelector('#audit-result');
        return {
          viewport: [innerWidth, innerHeight],
          documentWidth: document.documentElement.scrollWidth,
          failures: Number(result?.dataset.failures || -1),
          tableScroll: result?.dataset.tableScroll === 'true',
          titleHeight: document.querySelector('.page-header h1')?.getBoundingClientRect().height || 0,
        };
      })()`,
    });
    const screenshot = await send('Page.captureScreenshot', { format: 'png', fromSurface: true });
    const output = path.join(process.env.MOBILE_AUDIT_OUTPUT_DIR || tmpdir(), `my-auction-mobile-${width}.png`);
    writeFileSync(output, Buffer.from(screenshot.data, 'base64'));
    results.push({ width, output, ...evaluation.result.value });
  }
  socket.close();
  console.log(JSON.stringify(results, null, 2));
  if (results.some((result) => result.failures !== 0 || result.documentWidth > result.width || !result.tableScroll)) {
    process.exitCode = 1;
  }
} finally {
  chrome.kill();
}
