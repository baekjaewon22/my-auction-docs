import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const separator = args.indexOf('--');
const forwarded = separator >= 0 ? args.slice(0, separator) : [];
const payload = separator >= 0 ? args.slice(separator + 1) : args;

function run(command, commandArgs) {
  return new Promise((resolve) => {
    const child = spawn(command, commandArgs, { windowsHide: true, stdio: 'ignore' });
    child.once('error', () => resolve());
    child.once('exit', () => resolve());
  });
}

const tasks = [];
if (forwarded.length) tasks.push(run(forwarded[0], [...forwarded.slice(1), ...payload]));
tasks.push(run(process.execPath, [path.join(scriptDir, 'sync-codex-conversations.mjs'), '--notify', ...payload]));
await Promise.all(tasks);
