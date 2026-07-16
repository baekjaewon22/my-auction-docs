import { spawn } from 'node:child_process';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const port = 8799;
const wranglerBin = new URL('../node_modules/wrangler/bin/wrangler.js', import.meta.url);
const config = new URL('../tests/fixtures/wrangler.web-push-smoke.json', import.meta.url);
const child = spawn(process.execPath, [
  fileURLToPath(wranglerBin),
  'dev',
  '--config', fileURLToPath(config),
  '--ip', '127.0.0.1',
  '--port', String(port),
], { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });

let output = '';
child.stdout.on('data', (chunk) => { output += chunk.toString(); });
child.stderr.on('data', (chunk) => { output += chunk.toString(); });

const deadline = Date.now() + 30_000;
let result;
try {
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`wrangler dev exited early (${child.exitCode})\n${output}`);
    try {
      const response = await fetch(`http://127.0.0.1:${port}/`);
      result = await response.json();
      if (!response.ok || !result?.runtime_compatible) {
        throw new Error(`workerd web-push smoke failed: ${JSON.stringify(result)}\n${output}`);
      }
      break;
    } catch (error) {
      if (String(error?.message || '').startsWith('workerd web-push smoke failed:')) throw error;
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
  }
  if (!result) throw new Error(`Timed out waiting for workerd smoke server.\n${output}`);
  console.log(`workerd web-push smoke passed (push service HTTP ${result.upstream_status})`);
} finally {
  child.kill('SIGTERM');
}
