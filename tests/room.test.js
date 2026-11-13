const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { once } = require('node:events');
const { createRoomServer } = require('../server');
const vm = require('node:vm');

test('client PIN flow saves dashboard once; viewer blocks score mutations', async () => {
  async function client(viewer) {
    const elements = new Map(); const handlers = [];
    const element = id => {
      if (!elements.has(id)) elements.set(id, { value: id === 'setup-score-mode' ? '2/4' : id.startsWith('player-') ? id : '', textContent:'', classList:{ toggle(){}, add(){}, remove(){} }, addEventListener(type, fn){ this[type] = fn; }, focus(){}, select(){} });
      return elements.get(id);
    };
    const writes = [];
    let snapshot = { revision:0, state:null };
    const redirects = []; const notices = []; const timers = [];
    const context = { console, URLSearchParams, URL, setTimeout:fn=>timers.push(fn), location:{ search:viewer ? '?room=1' : '', href:viewer ? 'http://localhost/?room=1' : 'http://localhost/', replace:url=>redirects.push(url) },
      sessionStorage:{ getItem(){ return ''; }, setItem(){}, removeItem(){} },
      localStorage:{ removeItem(){} },
      document:{ addEventListener(type, fn){ handlers.push(fn); }, getElementById:element, body:{ classList:{ toggle(){} } } },
      window:{}, EventSource:class {},
      fetch: async (url, options) => {
        let data = url === '/api/session' ? { host:false } : url === '/api/login' ? { token:'test-token' } : snapshot;
        if (options.method === 'PUT') { const body = JSON.parse(options.body); writes.push(body); snapshot = { revision:1, state:body.state }; data = snapshot; }
        return { ok:true, json:async()=>data };
      }
    };
    context.window.RoomStore = {
      request: async (route, options = {}) => (await context.fetch(route, options)).json(),
      subscribe: () => ({})
    };
    vm.createContext(context);
    vm.runInContext(fs.readFileSync(path.join(__dirname, '../app.js'),'utf8'), context);
    vm.runInContext(`renderScreen = renderScoreboard = renderHistory = renderRoundScoreModeOptions = closeAllModals = closeAllSheets = triggerFloatingPoints = showNotice = () => {}; openModal = id => { window.lastModal = id; };`, context);
    context.showNotice = (...args) => notices.push(args);
    vm.runInContext(fs.readFileSync(path.join(__dirname, '../room.js'),'utf8'), context);
    await handlers[1]();
    return { context, element, writes, redirects, notices, timers };
  }
  const host = await client(false);
  vm.runInContext('handleStartGame({preventDefault(){}})', host.context);
  assert.equal(host.context.window.lastModal, 'room-pin'); assert.equal(host.writes.length, 0);
  host.element('room-pin').value = '030102';
  await host.element('room-pin-form').submit({ preventDefault(){} });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(host.writes.length, 1);
  assert.equal(host.writes[0].state.currentScreen, 'dashboard');
  const guest = await client(true);
  assert.match(guest.notices[0][0], /không còn tồn tại/);
  assert.equal(guest.timers.length, 1);
  guest.timers[0]();
  assert.equal(guest.redirects[0], 'http://localhost/');
  vm.runInContext('adjustScoreQuick(1, 4); handleSaveRound(); handleResetAll();', guest.context);
  assert.equal(guest.writes.length, 0);
  assert.equal(vm.runInContext('state.players[0].score', guest.context), 0);
});

test('one room: PIN, read-only guests, live updates, conflicts and persistence', async () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'scorekeeper-test-'));
  const origin = 'https://example.github.io';
  let server = createRoomServer({ dataDir, frontendOrigin: origin });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  let base = `http://127.0.0.1:${server.address().port}`;
  const call = (route, method = 'GET', body, token) => fetch(base + route, { method, headers: { 'Content-Type':'application/json', Origin: origin, ...(token ? { Authorization: `Bearer ${token}` } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });
  let reader;
  try {
    assert.deepEqual(await (await call('/api/room')).json(), { revision: 0, state: null });
    assert.equal((await call('/api/login', 'POST', { pin:'000000' })).status, 401);
    const login = await call('/api/login', 'POST', { pin:'030102' });
    assert.equal(login.headers.get('access-control-allow-origin'), origin);
    const { token } = await login.json(); assert.ok(token);
    assert.equal((await (await call('/api/session', 'GET', null, token)).json()).host, true);
    const state = { players: [1,2,3,4].map(id => ({ id, name:`P${id}`, score:0 })), history:[], currentScreen:'dashboard', scoreMode:'2/4' };
    assert.equal((await call('/api/room', 'PUT', { revision:0, state })).status, 403);
    const events = await fetch(base + '/api/events'); reader = events.body.getReader();
    assert.match(new TextDecoder().decode((await reader.read()).value), /"revision":0/);
    let result = await call('/api/room', 'PUT', { revision:0, state }, token);
    assert.equal(result.status, 200);
    assert.match(new TextDecoder().decode((await reader.read()).value), /"revision":1/);
    assert.equal((await call('/api/room', 'PUT', { revision:0, state }, token)).status, 409);
    state.players[0].score = '4';
    assert.equal((await call('/api/room', 'PUT', { revision:1, state }, token)).status, 400);
    state.players[0].score = 4;
    result = await call('/api/room', 'PUT', { revision:1, state }, token);
    assert.equal((await result.json()).state.players[0].score, 4);
    for (const route of ['/server.js','/data/room.json','/.git/config']) assert.equal((await fetch(base + route)).status, 404);
    await reader.cancel(); reader = null;
    server.closeAllConnections(); await new Promise(resolve => server.close(resolve));
    server = createRoomServer({ dataDir }); server.listen(0, '127.0.0.1'); await once(server, 'listening');
    base = `http://127.0.0.1:${server.address().port}`;
    const restored = await (await call('/api/room')).json();
    assert.equal(restored.revision, 2); assert.equal(restored.state.players[0].score, 4);
  } finally {
    if (reader) await reader.cancel();
    server.closeAllConnections(); await new Promise(resolve => server.close(resolve));
    fs.rmSync(dataDir, { recursive:true, force:true });
  }
});
