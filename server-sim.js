// Runs inside the game's own script context (see server.js): every function and variable from
// index.html is in scope here. This file turns the single-player simulation into a shared match.
'use strict';

const TOTAL_PLAYERS = 25, JOIN_WINDOW = 40, RESTART_DELAY = 8, ZST = ['wait', 'shrink', 'done'];
const ACTS = new Set(['slot', 'last', 'reload', 'heal', 'grab', 'cycle', 'thr', 'scope']);

// No screen on the server.
pushFeed = pushNote = killMsg = flashMsg = showOver = () => {};
// Sound functions already do nothing here: audio is never initialised on the server.

// `me` is the local player in single-player; on the server it is a placeholder that is never in a match.
const NOBODY = makePlayer('server', -9999, -9999, false, '#000');
NOBODY.alive = false; NOBODY.hitMarkT = -9;

let events = [], lootDirty = true, rosterDirty = true, running = false, overAt = -1; // overAt: match time when one player was left
const clients = new Set();

emit = (...e) => { events.push(e); };
const addLoot0 = addLoot, removeLoot0 = removeLoot, pickup0 = pickup;
addLoot = (...a) => { lootDirty = true; return addLoot0(...a); };
removeLoot = it => { lootDirty = true; return removeLoot0(it); };
pickup = (p, it) => { lootDirty = true; return pickup0(p, it); };

function freeSpot(avoid, inZone) {
  let x = MAP / 2, y = MAP / 2;
  for (let k = 0; k < 120; k++) {
    if (inZone) { const a = rand(0, TAU), r = Math.sqrt(Math.random()) * zone.r * .8; x = clamp(zone.cx + Math.cos(a) * r, 220, MAP - 220); y = clamp(zone.cy + Math.sin(a) * r, 220, MAP - 220); }
    else { x = rand(220, MAP - 220); y = rand(220, MAP - 220); }
    if (isFree(x, y, 30) && !buildingAt(x, y) && avoid.every(s => d2(s[0], s[1], x, y) > 380 * 380)) break;
  }
  return freeSpotNear(x, y, 26);
}

function startMatch() {
  genWorld(); resetSim(); me = NOBODY;
  zone = { cx: MAP / 2, cy: MAP / 2, r: MAP * .72, phase: 0, state: 'wait', timer: 0, tx: 0, ty: 0, tr: 0 };
  beginWait();
  const humans = [...clients], bots = Math.max(0, TOTAL_PLAYERS - humans.length), spots = spawnSpots(humans.length + bots);
  const names = NAMES.slice().sort(() => Math.random() - .5);
  humans.forEach((c, i) => {
    const s = spots[i];
    c.player = makePlayer(c.name, s[0], s[1], false, c.skin || OUTFITS[(i * 5) % OUTFITS.length]); c.player.hitMarkT = -9;
    players.push(c.player);
  });
  for (let i = 0; i < bots; i++) {
    const s = spots[humans.length + i];
    players.push(makePlayer(names[i % names.length], s[0], s[1], true, OUTFITS[(i + 1) % OUTFITS.length]));
  }
  time = 0; state = 'play'; running = true; overAt = -1; events = []; lootDirty = rosterDirty = true;
  for (const c of clients) welcome(c);
  console.log(`Match started: ${humans.length} player(s), ${bots} bot(s).`);
}

function welcome(c) {
  const r1 = v => Math.round(v * 10) / 10;
  const world = {
    obs: obstacles.map(o => ({ id: o.id, kind: o.kind, shape: o.shape, x: r1(o.x), y: r1(o.y), r: o.r, cr: o.cr, w: o.w, h: o.h,
      hp: o.hp === Infinity ? null : o.hp, maxHp: o.maxHp === Infinity ? null : o.maxHp, solid: o.solid, blocks: o.blocks, ctype: o.ctype, ftype: o.ftype, style: o.style, col: o.col, lobes: o.lobes, seed: o.seed })),
    buildings: buildings.map(b => ({ kind: b.kind, x: b.x, y: b.y, w: b.w, h: b.h, roof: b.roof, doors: b.doors, vault: b.vault })),
    river, bridges, ponds,
  };
  lootDirty = true;
  send(c, JSON.stringify({ t: 'welcome', id: c.player ? c.player.id : -1, roster: roster(), world }));
}
const roster = () => players.map(p => [p.id, p.name, p.skin, p.bot ? 1 : 0]);
function send(c, str) { if (c.ws.readyState === 1) c.ws.send(str); }

function join(ws, rawName, rawSkin) {
  const name = rawName.replace(/[\u0000-\u001f<>]/g, '').trim().slice(0, 16) || 'Player';
  const skin = SKIN_BY_ID[rawSkin] ? rawSkin : null; // unknown skins fall back to one picked for them
  const c = { ws, name, skin, player: null, lastIn: Date.now() };
  clients.add(c);
  if (!running) startMatch();
  else if (overAt < 0 && time < JOIN_WINDOW) { // late joiners drop in while the match is young
    const s = freeSpot(players.filter(p => p.alive).map(p => [p.x, p.y]), true);
    c.player = makePlayer(name, s[0], s[1], false, c.skin || OUTFITS[(clients.size * 5) % OUTFITS.length]); c.player.hitMarkT = -9;
    players.push(c.player); rosterDirty = true;
    welcome(c);
  } else welcome(c); // spectate until the next match
  console.log(`${name} joined (${clients.size} online).`);
  return c;
}

function input(c, m) {
  const p = c.player; if (!p || !p.alive || !players.includes(p)) return;
  const num = (v, lo, hi) => { v = +v; return Number.isFinite(v) ? clamp(v, lo, hi) : 0; };
  if (m.t === 'in') {
    c.lastIn = Date.now();
    p.input.mx = num(m.mx, -1, 1); p.input.my = num(m.my, -1, 1); p.input.angle = num(m.a, -10, 10);
    p.input.fire = !!m.f; p.aimDist = num(m.d, 0, 3000);
    if (Number.isFinite(+m.p)) p.input.press = Math.max(p.input.press, Math.floor(+m.p)); // click counter for semi-auto guns
  } else if (m.t === 'act' && ACTS.has(m.a)) applyAct(p, m.a, typeof m.v === 'string' || typeof m.v === 'number' ? m.v : undefined);
}

function leave(c) {
  clients.delete(c);
  if (c.player && c.player.alive && players.includes(c.player)) kill(c.player, null, 'quit');
  console.log(`${c.name} left (${clients.size} online).`);
  if (!clients.size) { running = false; console.log('Everyone left; waiting for players.'); }
}

function tick(dt) {
  if (!running) return;
  const now = Date.now();
  for (const c of clients) if (c.player && now - c.lastIn > 1000) { const i = c.player.input; i.mx = i.my = 0; i.fire = false; }
  update(dt);
  particles.length = 0; decals.length = 0;
  if (overAt < 0 && players.filter(p => p.alive).length <= 1) overAt = time;
  if (overAt >= 0 && time - overAt > RESTART_DELAY) startMatch();
}

function broadcast() {
  if (!running || !clients.size) return;
  const r = Math.round, f2 = v => Math.round(v * 100) / 100, f3 = v => Math.round(v * 1000) / 1000;
  const c = {
    P: players.map(p => [p.id, r(p.x), r(p.y), f2(p.angle), Math.ceil(Math.max(0, p.hp)), p.alive ? 1 : 0, p.cur,
      p.slots[0] ? p.slots[0].id : '', p.slots[1] ? p.slots[1].id : '', p.helmet, p.vest, p.bag, p.cooking ? 1 : 0, f2(p.cookT || 0),
      p.thrSel, p.thr[p.thrSel] > 0 ? 1 : 0, p.healT > 0 ? [f2(p.healT), p.healMax, p.healType] : 0, p.kills]),
    B: bullets.map(b => [r(b.x), r(b.y), f3(b.dx), f3(b.dy), r(b.speed), r(b.trav), r(b.range), b.w, b.shrap ? 1 : 0, b.owner ? b.owner.id : -1, b.dmg, b.wid]),
    G: grenades.map(g => [r(g.x), r(g.y), r(g.z), g.type, f2(g.rot), r(g.vx), r(g.vy), r(g.vz), f2(g.fuse)]),
    Z: [r(zone.cx), r(zone.cy), r(zone.r), r(zone.tx || 0), r(zone.ty || 0), r(zone.tr || 0), ZST.indexOf(zone.state), f2(zone.timer), zone.phase],
    C: clouds.map(k => [r(k.x), r(k.y), f2(k.t), k.life, k.puffs.map(p => [f2(p.ox), f2(p.oy), f2(p.r), f2(p.ph)])]),
    S: strobes.map(k => [r(k.x), r(k.y), f2(k.t)]), K: strikes.map(k => [r(k.x), r(k.y), f2(k.t)]), L: planes.map(k => [r(k.x), r(k.y), f2(k.a), f2(k.t)]),
    D: drops.map(q => [r(q.x), r(q.y), f2(q.t)]),
    T: tanks.map(t => [t.id, r(t.x), r(t.y), f2(t.a), f2(t.ta), Math.ceil(t.hp), t.driver ? t.driver.id : -1, f2(t.cd), r(t.v)]),
    E: events,
  };
  if (rosterDirty) { c.R = roster(); rosterDirty = false; }
  if (lootDirty || loot.some(it => it.vx || it.vy)) { c.Lt = loot.map(it => [it.id, it.kind, it.type, it.amt, r(it.x), r(it.y), it.mag || 0]); lootDirty = false; }
  events = [];
  const common = JSON.stringify(c);
  for (const cl of clients) {
    const p = cl.player && players.includes(cl.player) ? cl.player : null;
    const priv = p ? JSON.stringify({ am: [p.ammo.a9, p.ammo.a12, p.ammo.a762, p.ammo.a556, p.ammo.a50, p.ammo.a308, p.ammo.rkt], inv: [p.inv.bandage, p.inv.medkit, p.inv.soda, p.inv.pills],
      thr: THROW_ORDER.map(t => p.thr[t]), sc: [2, 4, 8].map(z => p.scopes[z] ? 1 : 0), scope: p.scope,
      mg: [p.slots[0] ? p.slots[0].mag : 0, p.slots[1] ? p.slots[1].mag : 0], rl: [f2(p.reloadT), p.reloadMax], boost: r(p.boost), dmg: r(p.dmg), last: p.lastSlot }) : 'null';
    send(cl, '{"t":"s","c":' + common + ',"p":' + priv + '}');
  }
}

const status = () => ({ online: clients.size, running, alive: running ? players.filter(p => p.alive).length : 0, matchTime: Math.round(time) });

globalThis.SIM = { join, input, leave, tick, broadcast, status };
