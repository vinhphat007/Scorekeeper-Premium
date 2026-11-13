const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');

test('Firebase: local PIN, empty history, conditional writes and stream', async () => {
  let saved = null; let revision = 0; const writes = []; const storage = new Map(); const session = new Map();
  const context = {
    window: { FIREBASE_DATABASE_URL:'https://test-default-rtdb.firebaseio.com' },
    localStorage: { getItem:k=>storage.get(k), setItem:(k,v)=>storage.set(k,v) },
    sessionStorage: { getItem:k=>session.get(k), setItem:(k,v)=>session.set(k,v), removeItem:k=>session.delete(k) },
    EventSource: class { constructor(url){ this.url=url; this.handlers={}; } addEventListener(k, fn){ this.handlers[k]=fn; } close(){} },
    fetch: async (url, options) => {
      assert.equal(url, 'https://test-default-rtdb.firebaseio.com/rooms/main.json');
      if (options.method === 'PUT') {
        writes.push(options); assert.equal(options.headers['if-match'], `"${revision}"`);
        saved = JSON.parse(options.body); revision++;
      }
      const snapshot = saved && JSON.parse(JSON.stringify(saved));
      return { ok:true, headers:{ get:()=>`"${revision}"` }, json:async()=>snapshot };
    }
  };
  vm.createContext(context); vm.runInContext(fs.readFileSync(path.join(__dirname,'../firebase-room.js'),'utf8'), context);
  const store = context.window.RoomStore;
  await assert.rejects(store.request('/api/login',{body:JSON.stringify({pin:'000000'})}), /PIN/);
  assert.equal((await store.request('/api/session')).host, false);
  await store.request('/api/login',{body:JSON.stringify({pin:'030102'})});
  assert.equal((await store.request('/api/session')).host, true);
  session.clear();
  vm.runInContext(fs.readFileSync(path.join(__dirname,'../firebase-room.js'),'utf8'), context);
  assert.equal((await context.window.RoomStore.request('/api/session')).host, true, 'Host survives a cold PWA restart');
  storage.clear();
  assert.equal((await context.window.RoomStore.request('/api/session')).host, false, 'Deleting remembered host requires PIN again');
  session.set('scorekeeper_pin_host', 'yes');
  assert.equal((await store.request('/api/session')).host, true, 'Existing session migrates');
  assert.equal(session.has('scorekeeper_pin_host'), false);
  assert.equal((await store.request('/api/room')).revision, 0);
  await store.request('/api/room', { method:'PUT', body:JSON.stringify({ revision:0, state:{ players:[], currentScreen:'dashboard', scoreMode:'2/4' } }) });
  assert.equal((await store.request('/api/room')).state.history.length, 0);
  await assert.rejects(store.request('/api/room', {method:'PUT',body:JSON.stringify({revision:0,state:{}})}), /thiết bị khác/);
  assert.equal(writes.length, 1);
  let received;
  const stream = store.subscribe(data=>{received=data;}, ()=>{}, ()=>{});
  await stream.handlers.put({ data:JSON.stringify({path:'/', data:{revision:2,state:{players:[]}}}) });
  assert.equal(received.revision, 2); assert.equal(received.state.history.length, 0);
  const deleted = await store.request('/api/room', { method:'DELETE', body:JSON.stringify({revision:1}) });
  assert.equal(saved, null);
  assert.equal(deleted.state, null);
  assert.equal(deleted.revision, 0);
  context.window.FIREBASE_DATABASE_URL = '';
  await assert.rejects(store.request('/api/room'), /room-config/);
});
