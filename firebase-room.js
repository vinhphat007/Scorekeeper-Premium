// Public Realtime Database room; PIN gates the UI only, as intended for this group.
(() => {
  const endpoint = () => {
    const base = (window.FIREBASE_DATABASE_URL || '').trim().replace(/\/$/, '');
    if (!/^https:\/\/[a-z0-9.-]+\.(firebasedatabase\.app|firebaseio\.com)$/.test(base)) {
      throw new Error('Hãy điền URL Realtime Database vào room-config.js.');
    }
    return `${base}/rooms/main.json`;
  };
  const normalize = data => {
    if (!data) return { revision: 0, state: null };
    if (data.state) {
      data.state.history = data.state.history || [];
      if (!Array.isArray(data.state.history)) data.state.history = Object.values(data.state.history);
    }
    return data;
  };
  async function requestDatabase(options = {}) {
    const response = await fetch(endpoint(), { ...options, cache: 'no-store' });
    const data = await response.json();
    if (!response.ok) {
      const error = new Error(response.status === 412 ? 'Phòng vừa thay đổi ở thiết bị khác. Đã tải lại điểm mới nhất.' : response.status === 401 || response.status === 403 ? 'Firebase chưa cho phép truy cập phòng. Kiểm tra Database Rules.' : 'Không kết nối được Firebase.');
      error.status = response.status; throw error;
    }
    return { data: normalize(data), etag: response.headers.get('ETag') };
  }
  window.RoomStore = {
    async request(route, options = {}) {
      if (route === '/api/session') return { host: sessionStorage.getItem('scorekeeper_pin_host') === 'yes' };
      if (route === '/api/login') {
        if (JSON.parse(options.body).pin !== '030102') throw new Error('Mã PIN không đúng.');
        sessionStorage.setItem('scorekeeper_pin_host', 'yes');
        return { token: '' };
      }
      if (!['PUT', 'DELETE'].includes(options.method)) return (await requestDatabase()).data;
      const body = JSON.parse(options.body);
      const current = await requestDatabase({ headers: { 'X-Firebase-ETag': 'true' } });
      if (current.data.revision !== body.revision) throw new Error('Phòng vừa thay đổi ở thiết bị khác. Đã tải lại điểm mới nhất.');
      if (!current.etag) throw new Error('Không lấy được phiên bản dữ liệu Firebase. Chưa lưu lượt này.');
      return (await requestDatabase({ method: 'PUT', headers: { 'Content-Type': 'application/json', 'if-match': current.etag },
        body: options.method === 'DELETE' ? 'null' : JSON.stringify({ revision: body.revision + 1, state: body.state }) })).data;
    },
    subscribe(onData, onOpen, onError) {
      const source = new EventSource(endpoint());
      let sequence = 0;
      source.onopen = onOpen;
      source.onerror = onError;
      source.addEventListener('put', async event => {
        const ticket = ++sequence;
        try {
          const change = JSON.parse(event.data);
          const data = change.path === '/' ? normalize(change.data) : (await requestDatabase()).data;
          if (ticket === sequence) onData(data);
        } catch (_) { onError(); }
      });
      source.addEventListener('patch', async () => {
        const ticket = ++sequence;
        try { const { data } = await requestDatabase(); if (ticket === sequence) onData(data); }
        catch (_) { onError(); }
      });
      source.addEventListener('cancel', () => { source.close(); onError(); });
      source.addEventListener('auth_revoked', () => { source.close(); onError(); });
      return source;
    }
  };
})();
