// One shared room. Firebase mode uses a local PIN gate without Authentication.
(() => {
  const viewerLink = new URLSearchParams(location.search).get('room') === '1';
  let token = sessionStorage.getItem('scorekeeper_host_token') || '';
  let host = false;
  let connected = false;
  let saving = false;
  let revision = 0;
  let confirmed = null;
  let pendingStart = null;
  let stream;
  let leavingRoom = false;
  const clone = value => JSON.parse(JSON.stringify(value));
  const status = message => { document.getElementById('room-status').textContent = message; };
  function permissions() {
    document.body.classList.toggle('room-viewer', !host);
    document.body.classList.toggle('room-saving', saving || !connected);
  }
  async function api(url, options = {}) {
    if (!window.RoomStore) throw new Error('Chưa tải được firebase-room.js. Hãy tải lại trang để cập nhật ứng dụng.');
    return window.RoomStore.request(url, options);
  }
  function forgetHost() {
    host = false;
    token = '';
    pendingStart = null;
    sessionStorage.removeItem('scorekeeper_pin_host');
    sessionStorage.removeItem('scorekeeper_host_token');
    document.getElementById('room-pin').value = '';
  }
  function apply(data) {
    if (viewerLink && !data.state) {
      if (leavingRoom) return;
      leavingRoom = true;
      connected = false;
      stream?.close();
      forgetHost(); closeAllSheets(); closeAllModals();
      state = clone(DEFAULT_STATE);
      state.currentScreen = 'dashboard';
      renderScreen(); renderScoreboard(); renderHistory(); permissions();
      status('Phòng không còn tồn tại');
      showNotice('Phòng đã bị chủ phòng xóa hoặc không còn tồn tại. Bạn sẽ được đưa về trang chính.', 'Phòng đã đóng');
      setTimeout(() => {
        const home = new URL(location.href);
        home.searchParams.delete('room');
        home.hash = '';
        location.replace(home.href);
      }, 2200);
      return;
    }
    if (!data.state && confirmed) {
      forgetHost(); closeAllSheets(); closeAllModals();
      for (const id of [1, 2, 3, 4]) document.getElementById(`player-${id}-input`).value = '';
    }
    revision = data.revision;
    confirmed = clone(data.state);
    if (data.state) {
      state = clone(data.state);
      if (!host || state.currentScreen === 'dashboard') state.currentScreen = 'dashboard';
    } else {
      state = clone(DEFAULT_STATE);
      if (viewerLink) state.currentScreen = 'dashboard';
    }
    renderScreen(); renderScoreboard(); renderHistory(); renderRoundScoreModeOptions(); permissions();
    status(!data.state || data.state.currentScreen === 'welcome' ? 'Đang chờ chủ phòng bắt đầu ván mới' : host ? 'Phòng duy nhất · Bạn là chủ phòng' : 'Phòng duy nhất · Chỉ xem · Đang trực tiếp');
  }
  loadState = () => { state = clone(DEFAULT_STATE); };
  saveState = () => {
    if (!host || !connected || saving) return;
    if (JSON.stringify(state) === JSON.stringify(confirmed)) return;
    saving = true; permissions(); status('Đang lưu điểm…');
    Promise.resolve().then(() => api('/api/room', { method: 'PUT', body: JSON.stringify({ revision, state }) }))
      .then(data => { saving = false; apply(data); })
      .catch(async error => {
        saving = false;
        if (error.status === 403) host = false;
        try { apply(await api('/api/room')); } catch (_) {
          connected = false;
          if (confirmed) { state = clone(confirmed); renderScreen(); renderScoreboard(); renderHistory(); }
        }
        permissions(); status('Chưa lưu được lượt vừa nhập');
        showNotice(error.message + ' Lượt vừa nhập chưa được xác nhận; hãy kiểm tra điểm trước khi ghi lại.');
      });
  };

  // Gate every mutation before it changes local scores, including inline handlers.
  const guard = fn => function (...args) {
    if (!host || !connected || saving) return;
    return fn.apply(this, args);
  };
  adjustScoreQuick = guard(adjustScoreQuick);
  window.adjustScoreQuick = adjustScoreQuick;
  handleSaveRound = guard(handleSaveRound);
  handleSaveChop = guard(handleSaveChop);
  handleSaveKill = guard(handleSaveKill);
  handleSaveToitrang = guard(handleSaveToitrang);
  handleUndo = guard(handleUndo);
  handleEditNameSubmit = guard(handleEditNameSubmit);
  handleResetAll = guard(async () => {
    saving = true; permissions(); status('Đang xóa phòng…');
    try {
      const room = await api('/api/room', { method: 'DELETE', body: JSON.stringify({ revision }) });
      saving = false;
      forgetHost();
      localStorage.removeItem('tienlen_scorekeeper_data');
      for (const id of [1, 2, 3, 4]) document.getElementById(`player-${id}-input`).value = '';
      closeAllSheets(); closeAllModals(); apply(room);
      showNotice('Đã xóa phòng và quên mã PIN. Muốn tạo lại phòng, hãy nhập tên và PIN lại.');
    } catch (error) {
      saving = false;
      try { apply(await api('/api/room')); } catch (_) { connected = false; }
      permissions(); showNotice('Chưa xóa được phòng. ' + error.message);
    }
  });
  window.openEditNameModal = guard(window.openEditNameModal);
  const startGame = handleStartGame;
  handleStartGame = event => {
    event.preventDefault();
    const names = [1,2,3,4].map(id => document.getElementById(`player-${id}-input`).value.trim());
    if (names.some(name => !name) || new Set(names).size !== 4) return showNotice('Vui lòng nhập đủ 4 tên người chơi khác nhau.');
    if (!connected) return showNotice('Chưa kết nối được phòng. Kiểm tra mạng và cấu hình Firebase rồi tải lại trang.');
    if (host) return startGame(event);
    pendingStart = () => startGame({ preventDefault() {} });
    document.getElementById('room-pin-error').textContent = '';
    document.getElementById('room-pin').value = '';
    openModal('room-pin');
    document.getElementById('room-pin').focus();
  };

  document.addEventListener('DOMContentLoaded', async () => {
    permissions();
    document.getElementById('room-pin-form').addEventListener('submit', async event => {
      event.preventDefault();
      const btn = document.getElementById('room-pin-submit'); btn.disabled = true;
      try {
        const login = await api('/api/login', { method: 'POST', body: JSON.stringify({ pin: document.getElementById('room-pin').value }) });
        token = login.token; sessionStorage.setItem('scorekeeper_host_token', token);
        host = true;
        const room = await api('/api/room');
        closeAllModals(); apply(room);
        if (!room.state || room.state.currentScreen === 'welcome') pendingStart?.();
        pendingStart = null;
      } catch (error) { document.getElementById('room-pin-error').textContent = error.message; }
      finally { btn.disabled = false; }
    });
    document.getElementById('btn-share-room').addEventListener('click', async () => {
      const url = new URL(location.href); url.search = '?room=1'; url.hash = '';
      try { await navigator.clipboard.writeText(url.href); showNotice('Đã sao chép link phòng. Người mở link chỉ được xem điểm và lịch sử.'); }
      catch (_) { document.getElementById('room-share-link').value = url.href; openModal('room-share'); document.getElementById('room-share-link').select(); }
    });
    try {
      const session = await api('/api/session'); host = !viewerLink && session.host;
      connected = true;
      const room = await api('/api/room');
      if (viewerLink || host) apply(room); else { revision = room.revision; confirmed = clone(room.state); permissions(); status('Nhập tên và bắt đầu để vào phòng'); }
      if (leavingRoom) return;
      const receive = data => {
        if (leavingRoom) return;
        connected = true;
        if (!saving && (viewerLink || host) && (!data.state || data.revision >= revision)) apply(data);
        permissions();
      };
      const opened = () => { connected = true; permissions(); };
      const disconnected = () => { connected = false; permissions(); status('Mất kết nối · Đang kết nối lại…'); };
      stream = window.RoomStore.subscribe(receive, opened, disconnected);
    } catch (error) { connected = false; permissions(); status(error.message || 'Chưa kết nối được Firebase.'); }
  });
})();
