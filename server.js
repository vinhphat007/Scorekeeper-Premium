const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

function createRoomServer({ dataDir = process.env.DATA_DIR || path.join(__dirname, 'data'), frontendOrigin = process.env.FRONTEND_ORIGIN } = {}) {
  fs.mkdirSync(dataDir, { recursive: true });
  const file = path.join(dataDir, 'room.json');
  let room = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : { revision: 0, state: null };
  const sessions = new Map();
  const attempts = new Map();
  const clients = new Set();
  const snapshot = () => JSON.stringify(room);
  const broadcast = () => { for (const res of clients) res.write(`data: ${snapshot()}\n\n`); };
  function validState(s) {
    return s && ['welcome', 'dashboard'].includes(s.currentScreen) &&
      ['1/2', '2/4', '5/10'].includes(s.scoreMode) && Array.isArray(s.players) && s.players.length === 4 &&
      s.players.every((p, i) => p.id === i + 1 && typeof p.name === 'string' && p.name.trim().length > 0 && p.name.length <= 15 && Number.isSafeInteger(p.score)) &&
      Array.isArray(s.history) && s.history.every(h => h && typeof h.id === 'string' && typeof h.details === 'string' &&
        Number.isFinite(h.timestamp) && ['round','chop','kill','toitrang','manual'].includes(h.type) &&
        h.deltas && [1,2,3,4].every(id => Number.isSafeInteger(h.deltas[id])));
  }
  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://localhost');
    if (frontendOrigin && req.headers.origin === frontendOrigin) {
      res.setHeader('Access-Control-Allow-Origin', frontendOrigin);
      res.setHeader('Vary', 'Origin');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    }
    if (req.method === 'OPTIONS') { res.writeHead(204); return res.end(); }
    const json = (status, value) => { res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(value)); };
    const readBody = async () => {
      let body = ''; for await (const chunk of req) { body += chunk; if (Buffer.byteLength(body) > 2_000_000) throw Error('Dữ liệu quá lớn.'); }
      return JSON.parse(body);
    };
    const token = req.headers.authorization?.replace(/^Bearer /, '') || (req.headers.cookie || '').split(';').map(s => s.trim()).find(s => s.startsWith('room_session='))?.slice(13);
    const authenticated = (sessions.get(token) || 0) > Date.now();
    try {
      if (url.pathname === '/api/room' && req.method === 'GET') return json(200, room);
      if (url.pathname === '/api/session' && req.method === 'GET') return json(200, { host: authenticated });
      if (url.pathname === '/api/events' && req.method === 'GET') {
        res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache, no-transform', 'Connection': 'keep-alive', 'X-Accel-Buffering': 'no' });
        res.write(`data: ${snapshot()}\n\n`); clients.add(res);
        const heartbeat = setInterval(() => res.write(': ping\n\n'), 20000);
        req.on('close', () => { clients.delete(res); clearInterval(heartbeat); }); return;
      }
      if (url.pathname.startsWith('/api/')) {
        if (!['POST', 'PUT', 'DELETE'].includes(req.method)) return json(405, { error: 'Phương thức không hỗ trợ.' });
        // Reject cross-site writes, including login requests.
        if (req.headers.origin && req.headers.origin !== frontendOrigin && req.headers.origin !== `${req.headers['x-forwarded-proto'] === 'https' || req.socket.encrypted ? 'https' : 'http'}://${req.headers.host}`) return json(403, { error: 'Nguồn yêu cầu không hợp lệ.' });
        if (!req.headers['content-type']?.startsWith('application/json')) return json(415, { error: 'Cần dữ liệu JSON.' });
        if (url.pathname === '/api/login' && req.method === 'POST') {
          const ip = req.socket.remoteAddress;
          let rate = attempts.get(ip);
          if (!rate || rate.until < Date.now()) { rate = { count: 0, until: Date.now() + 60000 }; attempts.set(ip, rate); }
          if (++rate.count > 5) return json(429, { error: 'Nhập sai quá nhiều lần. Thử lại sau một phút.' });
          const body = await readBody();
          if (body.pin !== '030102') return json(401, { error: 'Mã PIN không đúng.' });
          const session = crypto.randomBytes(32).toString('hex');
          sessions.set(session, Date.now() + 12 * 60 * 60 * 1000);
          res.setHeader('Set-Cookie', `room_session=${session}; HttpOnly; SameSite=Strict; Path=/; Max-Age=43200${req.socket.encrypted || req.headers['x-forwarded-proto'] === 'https' ? '; Secure' : ''}`);
          return json(200, { host: true, token: session });
        }
        if (url.pathname === '/api/room' && req.method === 'DELETE') {
          if (!authenticated) return json(403, { error: 'Chỉ chủ phòng được xóa phòng.' });
          const body = await readBody();
          if (body.revision !== room.revision) return json(409, { error: 'Phòng vừa thay đổi. Kiểm tra lại trước khi xóa.' });
          fs.rmSync(file, { force: true });
          room = { revision: 0, state: null }; sessions.clear(); broadcast();
          res.setHeader('Set-Cookie', 'room_session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0');
          return json(200, room);
        }
        if (url.pathname === '/api/room' && req.method === 'PUT') {
          if (!authenticated) return json(403, { error: 'Chỉ chủ phòng được ghi điểm. Vui lòng nhập lại PIN.' });
          const body = await readBody();
          if (body.revision !== room.revision) return json(409, { error: 'Phòng vừa thay đổi ở thiết bị khác. Đã tải lại điểm mới nhất.' });
          if (!validState(body.state)) return json(400, { error: 'Dữ liệu điểm không hợp lệ.' });
          const next = { revision: room.revision + 1, state: body.state };
          fs.writeFileSync(file + '.tmp', JSON.stringify(next)); fs.renameSync(file + '.tmp', file);
          room = next; broadcast(); return json(200, room);
        }
        return json(404, { error: 'Không tìm thấy.' });
      }
      if (!['GET', 'HEAD'].includes(req.method)) { res.writeHead(405); return res.end(); }
      const relative = decodeURIComponent(url.pathname).replace(/^\/+/, '') || 'index.html';
      // Serve only public app assets; never expose server code, stored room data, or dotfiles.
      if (!['index.html','app.js','room.js','room-config.js','firebase-room.js','style.css','cafe-scene.js','sw.js','manifest.json'].includes(relative) && !/^(assets|icons|vendor)\/[\w./-]+$/.test(relative)) { res.writeHead(404); return res.end(); }
      const target = path.resolve(__dirname, relative);
      if (!target.startsWith(__dirname + path.sep) || !fs.existsSync(target) || !fs.statSync(target).isFile()) { res.writeHead(404); return res.end(); }
      const mime = { '.html':'text/html; charset=utf-8', '.js':'text/javascript; charset=utf-8', '.css':'text/css; charset=utf-8', '.json':'application/json', '.png':'image/png', '.glb':'model/gltf-binary' };
      res.writeHead(200, { 'Content-Type': mime[path.extname(target)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
      if (req.method === 'HEAD') return res.end();
      fs.createReadStream(target).pipe(res);
    } catch (error) { console.error(error); if (!res.headersSent) json(400, { error: 'Không thể xử lý hoặc lưu dữ liệu phòng.' }); else res.end(); }
  });
  server.on('close', () => { for (const res of clients) res.end(); });
  return server;
}
if (require.main === module) createRoomServer().listen(Number(process.env.PORT || 3000), '0.0.0.0', () => console.log(`Ghi điểm: http://localhost:${process.env.PORT || 3000}`));
module.exports = { createRoomServer };
