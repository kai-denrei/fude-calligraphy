// cdp-shot.mjs <url> <outfile> <waitMs> — real-time headless screenshot via DevTools
// Protocol (no virtual time), so animations actually play before capture.
import { writeFileSync } from 'node:fs';
import { spawn } from 'node:child_process';

const [url, out, waitMs = '6000'] = process.argv.slice(2);
const PORT = 9333 + Math.floor(Math.random() * 200);
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const prof = `/tmp/cdp-${PORT}`;

const chrome = spawn(CHROME, [
  '--headless=new', '--hide-scrollbars', '--no-first-run', '--no-default-browser-check',
  `--user-data-dir=${prof}`, '--enable-unsafe-swiftshader',
  '--window-size=1500,950', `--remote-debugging-port=${PORT}`, url,
], { stdio: 'ignore' });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function getJSON(path) {
  const res = await fetch(`http://127.0.0.1:${PORT}${path}`);
  return res.json();
}

try {
  // wait for devtools endpoint
  let ready = false;
  for (let i = 0; i < 40 && !ready; i++) {
    try { await getJSON('/json/version'); ready = true; } catch { await sleep(250); }
  }
  if (!ready) throw new Error('devtools endpoint never came up');
  await sleep(500);
  const targets = await getJSON('/json');
  const page = targets.find((t) => t.type === 'page' && t.webSocketDebuggerUrl);
  if (!page) throw new Error('no page target');

  const ws = new WebSocket(page.webSocketDebuggerUrl);
  let id = 0;
  const pending = new Map();
  const send = (method, params = {}) => new Promise((resolve) => {
    const mid = ++id; pending.set(mid, resolve);
    ws.send(JSON.stringify({ id: mid, method, params }));
  });
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  ws.onmessage = (m) => {
    const d = JSON.parse(m.data);
    if (d.id && pending.has(d.id)) { pending.get(d.id)(d.result); pending.delete(d.id); }
  };

  await send('Page.enable');
  // page already navigated via CLI arg; give the animation real wall-clock time
  await sleep(parseInt(waitMs, 10));
  const { data } = await send('Page.captureScreenshot', { format: 'png' });
  writeFileSync(out, Buffer.from(data, 'base64'));
  console.log('captured', out);
  ws.close();
} catch (e) {
  console.error('CDP error:', e.message);
} finally {
  chrome.kill('SIGKILL');
}
