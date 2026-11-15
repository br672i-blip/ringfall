// Ringfall multiplayer server.
// Serves the game page and runs authoritative matches over WebSockets. The game rules are not
// duplicated here: the <script> from index.html is loaded into a sandbox and server-sim.js drives it.
'use strict';
const http = require('http'), fs = require('fs'), os = require('os'), path = require('path'), vm = require('vm');
const { WebSocketServer } = require('ws');

const PORT = +process.env.PORT || 8080;
const PAGE = path.join(__dirname, 'index.html');

function makeSandbox() {
  const noop = () => {};
  const ctx2d = new Proxy({}, {
    get: (t, k) => k in t ? t[k] : k === 'createLinearGradient' || k === 'createRadialGradient' ? () => ({ addColorStop: noop }) : noop,
    set: (t, k, v) => { t[k] = v; return true; },
  });
  const el = () => ({
    hidden: false, disabled: false, style: {}, dataset: {}, children: [], value: '', textContent: '', innerHTML: '',
    width: 380, height: 380, clientWidth: 1280, clientHeight: 800, lastChild: null,
    classList: { toggle: noop, add: noop, remove: noop, contains: () => false },
    addEventListener: noop, getContext: () => ctx2d, prepend: noop, remove: noop, closest: () => null,
  });
  const els = {};
  const sandbox = {
    console, setTimeout, clearTimeout, setInterval, clearInterval,
    document: { getElementById: id => els[id] || (els[id] = el()), createElement: el, querySelectorAll: () => [], documentElement: { clientWidth: 1280, clientHeight: 800 } },
    innerWidth: 1280, innerHeight: 800, devicePixelRatio: 1, addEventListener: noop, requestAnimationFrame: noop,
    performance: { now: () => Date.now() }, localStorage: { getItem: () => null, setItem: noop },
  };
  sandbox.window = sandbox;
  return sandbox;
}

function loadGame() {
  const html = fs.readFileSync(PAGE, 'utf8');
  const js = html.slice(html.indexOf('<script>') + 8, html.lastIndexOf('</script>'));
  const sandbox = makeSandbox(), ctx = vm.createContext(sandbox);
  vm.runInContext(js, ctx, { filename: 'index.html' });
  vm.runInContext(fs.readFileSync(path.join(__dirname, 'server-sim.js'), 'utf8'), ctx, { filename: 'server-sim.js' });
  return sandbox.SIM;
}

const SIM = loadGame();

const server = http.createServer((req, res) => {
  const url = req.url.split('?')[0];
  if (url === '/' || url === '/index.html') {
    const page = fs.readFileSync(PAGE, 'utf8');
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
    res.end('<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">' +
      '<script>window.RINGFALL_ONLINE = true</script>' + page + '</html>');
  } else if (url === '/status') {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify(SIM.status()));
  } else {
    res.writeHead(404); res.end('Not found');
  }
});

const wss = new WebSocketServer({ server, maxPayload: 4096 });
wss.on('connection', ws => {
  let client = null;
  ws.on('message', data => {
    let m; try { m = JSON.parse(data); } catch (e) { return; }
    if (!m || typeof m !== 'object') return;
    if (m.t === 'join' && !client) client = SIM.join(ws, String(m.name || ''), String(m.skin || ''), String(m.mode || ''), !!m.blitz, String(m.code || ''));
    else if (client) SIM.input(client, m);
  });
  ws.on('close', () => { if (client) SIM.leave(client); });
});

let last = Date.now(), ticks = 0;
setInterval(() => {
  const now = Date.now(), dt = Math.min(.05, (now - last) / 1000); last = now;
  SIM.tick(dt);
  if (++ticks % 3 === 0) SIM.broadcast(); // 20 snapshots a second
}, 1000 / 60);

server.listen(PORT, () => {
  console.log(`Ringfall server running.\n  This computer:  http://localhost:${PORT}`);
  for (const list of Object.values(os.networkInterfaces())) for (const a of list || [])
    if (a.family === 'IPv4' && !a.internal) console.log(`  Same network:   http://${a.address}:${PORT}`);
});
