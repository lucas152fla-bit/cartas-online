import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');

const PORT = 3100; // porta isolada — nunca usa a 3000 (produção)
const BASE = `http://127.0.0.1:${PORT}`;
const tmp = mkdtempSync(join(tmpdir(), 'cartas-test-'));
const DB_PATH = join(tmp, 'cartas.db');

const suites = [
  ['full-smoke', 'scripts/full-smoke.mjs'],
  ['bot-smoke', 'scripts/bot-smoke.mjs'],
  ['guest-e2e', 'scripts/guest-e2e.mjs'],
  ['poker-smoke', 'scripts/poker-smoke.mjs'],
];
const SUITE_TIMEOUT = 90_000;

const server = spawn(process.execPath, ['server/index.js'], {
  cwd: root,
  env: { ...process.env, PORT: String(PORT), HOST: '127.0.0.1', DB_PATH },
  stdio: ['ignore', 'pipe', 'pipe'],
});
let serverLog = '';
server.stdout.on('data', (d) => (serverLog += d));
server.stderr.on('data', (d) => (serverLog += d));

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitReady(timeoutMs = 15_000) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    try {
      const r = await fetch(`${BASE}/`);
      if (r.ok) return true;
    } catch { /* ainda subindo */ }
    await sleep(200);
  }
  return false;
}

function runSuite(name, file) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [file], {
      cwd: root,
      env: { ...process.env, SMOKE_BASE: BASE, DB_PATH },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let out = '';
    child.stdout.on('data', (d) => (out += d));
    child.stderr.on('data', (d) => (out += d));
    const t = setTimeout(() => {
      child.kill('SIGKILL');
      resolve({ name, ok: false, error: `timeout (${SUITE_TIMEOUT / 1000}s)`, out });
    }, SUITE_TIMEOUT);
    child.on('exit', (code) => {
      clearTimeout(t);
      resolve({ name, ok: code === 0, error: code === 0 ? null : `exit ${code}`, out });
    });
  });
}

let failed = 0;
const results = [];
console.log(`\n🧪  Cartas Online — suítes (porta ${PORT}, banco temporário ${tmp})\n`);
try {
  const ready = await waitReady();
  if (!ready) {
    failed++;
    console.error('FALHA do harness: servidor isolado não respondeu em 15s.');
    console.error(serverLog.slice(-2000));
  } else {
    for (const [name, file] of suites) {
      const r = await runSuite(name, file);
      results.push(r);
      if (!r.ok) failed++;
      console.log(`\n===== ${r.name}: ${r.ok ? 'PASS' : `FAIL (${r.error})`} =====`);
      console.log(r.out.length > 3000 ? r.out.slice(-3000) : r.out);
    }
  }
} finally {
  server.kill('SIGKILL');
  rmSync(tmp, { recursive: true, force: true });
}

console.log('\n== RESUMO ==');
for (const r of results) console.log(`  ${r.ok ? 'PASS' : 'FAIL'}  ${r.name}`);
console.log(failed ? `\n✗ ${failed} suíte(s) falharam` : '\n✓ todas as suítes passaram');
process.exit(failed ? 1 : 0);