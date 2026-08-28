import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';

const baseUrl = process.env.MOBILE_AUDIT_BASE_URL || 'http://127.0.0.1:5173';
const email = process.env.MOBILE_AUDIT_EMAIL;
const password = process.env.MOBILE_AUDIT_PASSWORD;
const chromePath = process.env.MOBILE_AUDIT_CHROME || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const widths = (process.env.MOBILE_AUDIT_WIDTHS || '320,360,390,430,600,768,769,900,1024')
  .split(',').map(Number).filter(Number.isFinite);

if (!email || !password) {
  throw new Error('MOBILE_AUDIT_EMAIL and MOBILE_AUDIT_PASSWORD are required for the local route audit.');
}

const allRoutes = [
  '/dashboard', '/documents', '/property-report', '/templates', '/journal', '/case-progress', '/archive',
  '/statistics', '/cases', '/lawitgo-settlement-ledger', '/lawitgo-winning-admin', '/profile',
  '/personal-calendar', '/personal-calendar/anomalies', '/freelancer-bids', '/bid-history', '/review',
  '/teams', '/org', '/users', '/phone-directory', '/sales', '/missing-documents', '/leave', '/payroll',
  '/payroll-business-income', '/payroll-employee-bonus', '/accounting', '/accounting-card-usage',
  '/accounting-staff', '/finance-analytics', '/management-support', '/management-support/holidays',
  '/accounting-session1', '/accounting-session1/bank', '/accounting-session1/check-card',
  '/accounting-session1/engine', '/accounting-session1/rules', '/accounting-session2',
  '/accounting-session2/review', '/accounting-session2/reports', '/accounting-session2/reports/sales',
  '/accounting-session2/reports/expense', '/accounting-session2/reports/profit-loss',
  '/accounting-session2/reports/forecast', '/accounting-session2/reports/labor-cost',
  '/accounting-session2/reports/check-card', '/accounting-session2/reports/tax',
  '/accounting-session2/reports/audit', '/minutes', '/alimtalk-logs', '/admin-notes', '/rooms',
  '/briefing-materials', '/auction-schedule', '/rights-analysis-guarantee', '/automation-diagnostics',
  '/contract-tracker', '/link-review',
];
const requestedRoutes = (process.env.MOBILE_AUDIT_ROUTES || '').split(',').map((value) => value.trim()).filter(Boolean);
const routes = requestedRoutes.length ? allRoutes.filter((route) => requestedRoutes.includes(route)) : allRoutes;

const delay = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));
const port = await new Promise((resolve, reject) => {
  const server = net.createServer();
  server.once('error', reject);
  server.listen(0, '127.0.0.1', () => {
    const address = server.address();
    server.close(() => resolve(address.port));
  });
});

const loginResponse = await fetch(`${baseUrl}/api/auth/login`, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ email, password, login_type: 'employee' }),
});
if (!loginResponse.ok) throw new Error(`Local audit login failed (${loginResponse.status})`);
const { token, user } = await loginResponse.json();
if (!token || user?.role !== 'master') throw new Error('The live route audit requires a local master test account.');

const profile = mkdtempSync(path.join(os.tmpdir(), 'live-mobile-route-audit-'));
const chrome = spawn(chromePath, [
  '--headless=new', '--disable-gpu', `--user-data-dir=${profile}`,
  `--remote-debugging-port=${port}`, 'about:blank',
], { stdio: 'ignore', windowsHide: true });

try {
  let target;
  for (let attempt = 0; attempt < 80; attempt += 1) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/json/list`);
      target = (await response.json()).find((item) => item.type === 'page');
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
    if (message.method === 'Page.javascriptDialogOpening') {
      socket.send(JSON.stringify({
        id: ++sequence,
        method: 'Page.handleJavaScriptDialog',
        params: { accept: true },
      }));
      return;
    }
    const request = pending.get(message.id);
    if (!request) return;
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
  await send('Page.addScriptToEvaluateOnNewDocument', {
    source: `try { localStorage.setItem('token', ${JSON.stringify(token)}); } catch {}`,
  });
  await send('Page.navigate', { url: `${baseUrl}/dashboard` });
  await delay(1600);

  const results = [];
  for (const width of widths) {
    await send('Emulation.setDeviceMetricsOverride', {
      width,
      height: width <= 430 ? 780 : 900,
      deviceScaleFactor: 1,
      mobile: width <= 600,
      screenWidth: width,
      screenHeight: width <= 430 ? 780 : 900,
    });
    await delay(80);

    for (const route of routes) {
      await send('Runtime.evaluate', {
        expression: `history.pushState({}, '', ${JSON.stringify(route)}); window.dispatchEvent(new PopStateEvent('popstate'));`,
      });
      await delay(260);
      for (let attempt = 0; attempt < 8; attempt += 1) {
        const loadingState = await send('Runtime.evaluate', {
          returnByValue: true,
          expression: `Boolean(document.querySelector('.page-loading'))`,
        });
        if (!loadingState.result.value) break;
        await delay(150);
      }
      const evaluation = await send('Runtime.evaluate', {
        returnByValue: true,
        expression: `(() => {
          const visible = (node) => {
            const style = getComputedStyle(node);
            const rect = node.getBoundingClientRect();
            return style.display !== 'none' && style.visibility !== 'hidden' && Number(style.opacity) !== 0 && rect.width > 0 && rect.height > 0;
          };
          const selectorFor = (node) => {
            if (node.id) return '#' + CSS.escape(node.id);
            const classes = [...node.classList].slice(0, 3).map((name) => '.' + CSS.escape(name)).join('');
            return node.tagName.toLowerCase() + classes;
          };
          const scrollAncestor = (node) => {
            for (let parent = node.parentElement; parent && parent !== document.body; parent = parent.parentElement) {
              const style = getComputedStyle(parent);
              if ((style.overflowX === 'auto' || style.overflowX === 'scroll') && parent.scrollWidth > parent.clientWidth + 1) return true;
            }
            return false;
          };
          const ignored = (node) => node.closest('.sidebar:not(.mobile-open), .react-datepicker-popper, .sales-customer-suggestions, .diagnosis-floating-box, .diagnosis-floating-toggle');
          const candidates = document.querySelectorAll('.main-content .page, .main-content .card, .main-content .section, .main-content .page-header, .main-content [class*="grid"], .main-content [class*="toolbar"], .main-content [class*="controls"], .main-content [class*="summary"], .main-content [class*="modal"], .main-content button, .main-content label, .main-content input, .main-content select, .main-content textarea');
          const outside = [...candidates].filter((node) => {
            if (!visible(node) || ignored(node) || scrollAncestor(node) || node instanceof SVGElement) return false;
            const rect = node.getBoundingClientRect();
            return rect.left < -2 || rect.right > innerWidth + 2;
          }).slice(0, 12).map((node) => {
            const rect = node.getBoundingClientRect();
            return { selector: selectorFor(node), left: Math.round(rect.left), right: Math.round(rect.right), text: (node.textContent || '').trim().slice(0, 45) };
          });
          const squeezed = [...document.querySelectorAll('.acc-kpi-value, .acc-stat-value, .lawitgo-winning-summary-card, button, label')].filter((node) => {
            if (!visible(node) || scrollAncestor(node)) return false;
            const text = (node.textContent || '').replace(/\\s+/g, ' ').trim();
            if (text.length < 3) return false;
            return node.scrollWidth > node.clientWidth + 2 || node.scrollHeight > node.clientHeight + 2;
          }).slice(0, 12).map((node) => ({ selector: selectorFor(node), client: [node.clientWidth, node.clientHeight], scroll: [node.scrollWidth, node.scrollHeight], text: (node.textContent || '').trim().slice(0, 45) }));
          const main = document.querySelector('.main-content');
          const page = document.querySelector('.page');
          const widthDetails = [...document.querySelectorAll('.main-content *')].filter((node) => {
            if (!visible(node) || ignored(node) || node instanceof SVGElement) return false;
            return node.scrollWidth > node.clientWidth + 2;
          }).slice(0, 16).map((node) => {
            const style = getComputedStyle(node);
            const rect = node.getBoundingClientRect();
            return {
              selector: selectorFor(node),
              clientWidth: node.clientWidth,
              scrollWidth: node.scrollWidth,
              overflowX: style.overflowX,
              rect: [Math.round(rect.left), Math.round(rect.right)],
              text: (node.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 45),
            };
          });
          const pageRect = page?.getBoundingClientRect();
          const edgeDetails = pageRect ? [...page.querySelectorAll('*')].filter((node) => {
            if (!visible(node) || ignored(node) || scrollAncestor(node) || node instanceof SVGElement) return false;
            const rect = node.getBoundingClientRect();
            return rect.left < pageRect.left - 2 || rect.right > pageRect.right + 2;
          }).slice(0, 16).map((node) => {
            const rect = node.getBoundingClientRect();
            return {
              selector: selectorFor(node),
              rect: [Math.round(rect.left), Math.round(rect.right)],
              text: (node.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 45),
            };
          }) : [];
          return {
            pathname: location.pathname,
            documentWidth: document.documentElement.scrollWidth,
            mainOverflow: main ? main.scrollWidth > main.clientWidth + 2 : false,
            pageOverflow: page ? page.scrollWidth > page.clientWidth + 2 : false,
            loading: Boolean(document.querySelector('.page-loading')),
            outside,
            squeezed,
            widthDetails,
            edgeDetails,
          };
        })()`,
      });
      results.push({ width, route, ...evaluation.result.value });
    }
  }
  socket.close();

  const allowedRedirects = new Map();
  const failures = results.filter((item) => (
    item.documentWidth > item.width + 1
    || item.loading
    || item.outside.length > 0
    || item.squeezed.length > 0
    || item.edgeDetails.length > 0
    || (item.pathname !== item.route && allowedRedirects.get(item.route) !== item.pathname)
  ));
  const summary = {
    account: user.email,
    routeCount: routes.length,
    widths,
    checks: results.length,
    failureCount: failures.length,
    failures,
  };
  console.log(JSON.stringify(summary, null, 2));
  if (failures.length) process.exitCode = 1;
} finally {
  chrome.kill();
  if (chrome.exitCode === null) await new Promise((resolve) => chrome.once('exit', resolve));
  rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
}
