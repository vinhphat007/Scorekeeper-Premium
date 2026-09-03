/**
 * TIẾN LÊN SCOREKEEPER PREMIUM - CORE JAVASCRIPT LOGIC
 */

// ==========================================================================
// STATE MANAGEMENT & CONSTANTS
// ==========================================================================
const DEFAULT_STATE = {
  players: [
    { id: 1, name: "Người chơi 1", score: 0 },
    { id: 2, name: "Người chơi 2", score: 0 },
    { id: 3, name: "Người chơi 3", score: 0 },
    { id: 4, name: "Người chơi 4", score: 0 }
  ],
  history: [],
  currentScreen: 'welcome',
  scoreMode: '2/4'
};

let state = { ...DEFAULT_STATE };

// Pool of cool/fun Vietnamese names for random generation
// const RANDOM_NAMES = [
//   "Nam", "Bình", "Sơn", "Kiên", "Hùng", "Đạt", "Linh", "Thảo",
//   "Hải", "Tuấn", "Hoàng", "Minh", "Phong", "Tiến", "Duy", "Khánh",
//   "Lan", "Vy", "Hà", "Trang", "Hương", "Anh", "Long", "Quân"
// ];

const RANDOM_NAMES = [
  "Hùng", "Phát", "Vương", "Tuấn", "Ngân"
];

// Active state variables for bottom sheets
const ROUND_SCORE_BASE = { first: 4, second: 2, third: -2, fourth: -4 };
const ROUND_SCORE_MULTIPLIERS = {
  '1/2': 0.5,
  '2/4': 1,
  '5/10': 2.5
};

let roundSelectionState = {
  step: 1, // 1: Nhất, 2: Nhì, 3: Ba, 4: Summary
  ranks: [null, null, null, null], // Array of player IDs for Rank 1, 2, 3, 4
  scoreMode: '2/4'
};

let chopSelectionState = {
  step: 1, // 1: Loser, 2: Winner, 3: Type, 4: Summary
  loserId: null,
  winnerId: null,
  points: 0,
  typeName: "",
  quantity: 1 // Số lượng là 1
};

const KILL_PENALTIES = [
  { key: 'blackPig', label: 'Heo đen', points: 2 },
  { key: 'redPig', label: 'Heo đỏ', points: 4 },
  { key: 'threePairs', label: 'Ba đôi thông', points: 6 },
  { key: 'quad', label: 'Tứ quý', points: 8 }
];

let killSelectionState = {
  step: 1,
  killerId: null,
  victimId: null,
  penalties: {
    blackPig: false,
    redPig: false,
    threePairs: false,
    quad: false
  },
  totalPoints: 8
};

// State for Tới Trắng rule
let toitrangSelectionState = {
  winnerId: null
};

// ==========================================================================
// INITIALIZATION
// ==========================================================================
document.addEventListener("DOMContentLoaded", () => {
  initApp();
});

function initApp() {
  loadState();
  setupEventListeners();
  registerServiceWorker();
  renderRoundScoreModeOptions();
  renderScreen();
  if (state.currentScreen === 'dashboard') {
    renderScoreboard();
    renderHistory();
  }
}

// Register the PWA service worker (no-op on browsers/contexts that don't support it,
// e.g. when opened directly via file:// instead of served over http(s)).
function registerServiceWorker() {
  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("./sw.js").catch((err) => {
      console.error("Service worker registration failed:", err);
    });
  }
}

// Load state from LocalStorage
function loadState() {
  const savedData = localStorage.getItem("tienlen_scorekeeper_data");
  if (savedData) {
    try {
      state = JSON.parse(savedData);
      // Fallback in case of missing keys
      if (!state.players || state.players.length !== 4) {
        state = { ...DEFAULT_STATE };
      }
      if (!state.history) state.history = [];
      if (!state.currentScreen) state.currentScreen = 'welcome';
      if (!state.scoreMode) state.scoreMode = DEFAULT_STATE.scoreMode;
    } catch (e) {
      console.error("Error parsing saved state:", e);
      state = { ...DEFAULT_STATE };
    }
  } else {
    state = { ...DEFAULT_STATE };
  }
}

// Save state to LocalStorage
function saveState() {
  localStorage.setItem("tienlen_scorekeeper_data", JSON.stringify(state));
}

// Screen controller
function showScreen(screenId) {
  state.currentScreen = screenId;
  saveState();
  renderScreen();
}

function renderScreen() {
  document.querySelectorAll(".screen").forEach(screen => {
    screen.classList.remove("active");
  });

  const activeScreen = document.getElementById(`${state.currentScreen}-screen`);
  if (activeScreen) {
    activeScreen.classList.add("active");
  }
}

// ==========================================================================
// EVENT LISTENERS SETUP
// ==========================================================================
function setupEventListeners() {
  // --- Screen 1: Welcome/Setup Screen ---
  const setupForm = document.getElementById("setup-form");
  if (setupForm) {
    setupForm.addEventListener("submit", handleStartGame);
  }

  // Randomize names buttons
  document.querySelectorAll(".btn-random").forEach(btn => {
    btn.addEventListener("click", (e) => {
      const targetId = e.currentTarget.getAttribute("data-target");
      randomizePlayerName(targetId);
    });
  });

  // --- Screen 2: Dashboard Screen ---
  // Header Actions
  document.getElementById("btn-history-trigger").addEventListener("click", () => openSheet("history"));
  document.getElementById("btn-reset-trigger").addEventListener("click", () => openModal("reset-confirm"));

  // Edit-name button inside each score card (delegated: cards are re-rendered dynamically)
  document.getElementById("scoreboard-grid").addEventListener("click", (e) => {
    const btn = e.target.closest(".btn-edit-inline");
    if (!btn) return;
    const card = btn.closest(".player-score-card");
    if (!card) return;
    const playerId = parseInt(card.getAttribute("data-player-id"), 10);
    const player = state.players.find(p => p.id === playerId);
    if (player) openEditNameModal(player.id, player.name);
  });

  // Bottom Actions
  document.getElementById("btn-record-round").addEventListener("click", initRoundFlow);
  document.getElementById("btn-record-kill").addEventListener("click", initKillFlow);
  document.getElementById("btn-record-chop").addEventListener("click", initChopFlow);
  document.getElementById("btn-record-toitrang").addEventListener("click", initToitrangFlow);

  // --- Bottom Sheet Closes ---
  document.querySelectorAll(".btn-close-sheet, .bottom-sheet-overlay").forEach(element => {
    element.addEventListener("click", (e) => {
      // If clicking overlay, ensure it's not a click bubbles up from the sheet
      if (e.target.classList.contains("bottom-sheet-overlay") || e.target.classList.contains("btn-close-sheet")) {
        closeAllSheets();
      }
    });
  });

  // --- Modal Closes ---
  document.querySelectorAll(".btn-close-modal, .modal-overlay").forEach(element => {
    element.addEventListener("click", (e) => {
      if (e.target.classList.contains("modal-overlay") || e.target.classList.contains("btn-close-modal")) {
        closeAllModals();
      }
    });
  });

  // --- Edit Name Form Submit ---
  document.getElementById("edit-name-form").addEventListener("submit", handleEditNameSubmit);
  document.getElementById("edit-player-name-input").addEventListener("input", updateEditNameCharCount);

  // --- Reset Confirmation ---
  document.getElementById("btn-confirm-reset").addEventListener("click", handleResetAll);

  // --- Generic Confirm Modal ---
  document.getElementById("btn-confirm-generic").addEventListener("click", () => {
    const action = pendingConfirmAction;
    pendingConfirmAction = null;
    closeAllModals();
    if (action) action();
  });

  // --- Round Flow Event Handlers ---
  document.getElementById("btn-restart-round").addEventListener("click", () => startRoundStep(1));
  document.getElementById("btn-confirm-round").addEventListener("click", handleSaveRound);

  // --- Setup Score Mode Selection ---
  document.querySelectorAll(".btn-score-mode").forEach(btn => {
    btn.addEventListener("click", (e) => {
      const selectedMode = e.currentTarget.getAttribute("data-mode");
      if (selectedMode) {
        state.scoreMode = selectedMode;
        document.getElementById("setup-score-mode").value = selectedMode;
        document.querySelectorAll(".btn-score-mode").forEach(item => {
          item.classList.toggle("active", item.getAttribute("data-mode") === selectedMode);
        });
      }
    });
  });

  // --- Chop Flow Event Handlers ---
  document.getElementById("btn-restart-chop").addEventListener("click", () => startChopStep(1));
  document.getElementById("btn-confirm-chop").addEventListener("click", handleSaveChop);

  // --- Kill Flow Event Handlers ---
  document.getElementById("btn-restart-kill").addEventListener("click", () => startKillStep(1));
  document.getElementById("btn-confirm-kill").addEventListener("click", handleSaveKill);

  // --- Chop Quantity Actions ---
  document.getElementById("btn-chop-qty-minus").addEventListener("click", () => {
    if (chopSelectionState.quantity > 1) {
      chopSelectionState.quantity--;
      updateChopSummaryUI();
    }
  });

  document.getElementById("btn-chop-qty-plus").addEventListener("click", () => {
    if (chopSelectionState.quantity < 10) { // Giới hạn tối đa 10 con
      chopSelectionState.quantity++;
      updateChopSummaryUI();
    }
  });

  // --- Tới Trắng Flow Event Handlers ---
  document.getElementById("btn-restart-toitrang").addEventListener("click", initToitrangFlow);
  document.getElementById("btn-confirm-toitrang").addEventListener("click", handleSaveToitrang);

  // --- Undo Button ---
  document.getElementById("btn-undo").addEventListener("click", confirmUndo);
}

// ==========================================================================
// SCREEN 1: WELCOME SCREEN LOGIC
// ==========================================================================
function randomizePlayerName(inputId) {
  const input = document.getElementById(inputId);
  if (!input) return;

  // Get list of current names in other inputs to avoid duplicates
  const currentNames = [];
  for (let i = 1; i <= 4; i++) {
    const otherId = `player-${i}-input`;
    if (otherId !== inputId) {
      const otherVal = document.getElementById(otherId).value.trim();
      if (otherVal) currentNames.push(otherVal);
    }
  }

  // Filter out names currently in use
  const availableNames = RANDOM_NAMES.filter(name => !currentNames.includes(name));

  if (availableNames.length > 0) {
    const randomIndex = Math.floor(Math.random() * availableNames.length);
    input.value = availableNames[randomIndex];

    // Tiny bounce animation for the input
    input.style.transform = 'scale(1.02)';
    setTimeout(() => input.style.transform = 'scale(1)', 150);
  }
}

function handleStartGame(e) {
  e.preventDefault();

  const p1 = document.getElementById("player-1-input").value.trim();
  const p2 = document.getElementById("player-2-input").value.trim();
  const p3 = document.getElementById("player-3-input").value.trim();
  const p4 = document.getElementById("player-4-input").value.trim();

  // Simple validation
  if (!p1 || !p2 || !p3 || !p4) {
    showNotice("Vui lòng điền đầy đủ tên cho 4 người chơi!");
    return;
  }

  const names = [p1, p2, p3, p4];
  const uniqueNames = new Set(names);
  if (uniqueNames.size !== 4) {
    showNotice("Tên người chơi không được trùng nhau!");
    return;
  }

  const selectedMode = document.getElementById("setup-score-mode").value || '2/4';

  // Setup state
  state.players = [
    { id: 1, name: p1, score: 0 },
    { id: 2, name: p2, score: 0 },
    { id: 3, name: p3, score: 0 },
    { id: 4, name: p4, score: 0 }
  ];
  state.history = [];
  state.scoreMode = selectedMode;

  saveState();
  renderScoreboard();
  renderHistory();
  showScreen("dashboard");
}

// ==========================================================================
// SCREEN 2: SCOREBOARD DRAWING & ACTIONS
// ==========================================================================
function renderScoreboard() {
  const container = document.getElementById("scoreboard-grid");
  if (!container) return;

  // Clear existing
  container.innerHTML = "";

  // Compute rankings
  const sortedPlayers = [...state.players].sort((a, b) => b.score - a.score);
  const ranksMap = {};
  let currentRank = 1;
  for (let i = 0; i < sortedPlayers.length; i++) {
    if (i > 0 && sortedPlayers[i].score < sortedPlayers[i - 1].score) {
      currentRank = i + 1;
    }
    ranksMap[sortedPlayers[i].id] = currentRank;
  }

  // Render cards in the default layout order (IDs 1, 2, 3, 4) so players don't jump around physically,
  // but they display their dynamic Rank, Badge color, and Leader styling.
  state.players.forEach(player => {
    const rank = ranksMap[player.id];
    let rankText = `Hạng ${rank}`;
    if (rank === 1) rankText = "👑 Nhất";
    else if (rank === 2) rankText = "⭐ Nhì";
    else if (rank === 3) rankText = "Ba";
    else if (rank === 4) rankText = "Bét";

    const isLeader = rank === 1;
    const cardClass = `player-score-card rank-${rank} ${isLeader ? 'leader' : ''}`;

    let scoreClass = 'score-neutral';
    if (player.score > 0) scoreClass = 'score-positive';
    else if (player.score < 0) scoreClass = 'score-negative';

    // Compute quick-adjust amount scaled by score mode (base 2)
    const multiplier = ROUND_SCORE_MULTIPLIERS[state.scoreMode] ?? 1;
    const quickAmt = Math.round(2 * multiplier);
    const cardHTML = `
      <div class="${cardClass}" data-player-id="${player.id}">
        <!-- Left Part: Rank & Player Info -->
        <div class="card-left">
          <div class="player-rank-badge">
            ${rank === 1 ? '👑' : rank}
          </div>
          <div class="player-info">
            <div class="player-name-wrapper">
              <span class="player-name-text">${escapeHTML(player.name)}</span>
              <button class="btn-edit-inline" title="Sửa tên">
                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"></path><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"></path></svg>
              </button>
            </div>
            <span class="player-rank-label">${rankText}</span>
          </div>
        </div>

        <!-- Center/Right Part: Score display with quick adjusters -->
        <div class="card-center">
          <button class="btn-adjust btn-adjust-minus" onclick="adjustScoreQuick(${player.id}, -${quickAmt})">-${quickAmt}</button>

          <div class="score-display-wrapper">
            <span class="player-total-score ${scoreClass}">${player.score}</span>
          </div>

          <button class="btn-adjust btn-adjust-plus" onclick="adjustScoreQuick(${player.id}, ${quickAmt})">+${quickAmt}</button>
        </div>
      </div>
    `;
    container.insertAdjacentHTML("beforeend", cardHTML);
  });
}

// Adjust Score Quick (+1 / -1)
function adjustScoreQuick(playerId, amount) {
  const player = state.players.find(p => p.id === playerId);
  if (!player) return;

  player.score += amount;

  // Log history
  const historyItem = {
    id: "manual_" + Date.now() + "_" + Math.random().toString(36).substr(2, 4),
    timestamp: Date.now(),
    type: 'manual',
    details: `Chỉnh tay: ${player.name} ${amount > 0 ? '+' : ''}${amount}`,
    deltas: {
      1: playerId === 1 ? amount : 0,
      2: playerId === 2 ? amount : 0,
      3: playerId === 3 ? amount : 0,
      4: playerId === 4 ? amount : 0
    }
  };
  state.history.push(historyItem);

  saveState();
  renderScoreboard();
  renderHistory();

  // Animation effect
  triggerFloatingPoints(playerId, amount);
}

// Floating points trigger
function triggerFloatingPoints(playerId, delta) {
  const card = document.querySelector(`.player-score-card[data-player-id="${playerId}"]`);
  if (!card) return;

  const wrapper = card.querySelector(".score-display-wrapper");
  if (!wrapper) return;

  // Remove any stale effects first
  const existing = wrapper.querySelector(".floating-score-effect");
  if (existing) existing.remove();

  const effectClass = delta > 0 ? 'positive' : 'negative';
  const displayVal = delta > 0 ? `+${delta}` : `${delta}`;

  const bubble = document.createElement("div");
  bubble.className = `floating-score-effect ${effectClass}`;
  bubble.textContent = displayVal;

  wrapper.appendChild(bubble);

  // Remove after animation completes
  setTimeout(() => {
    bubble.remove();
  }, 800);
}

// ==========================================================================
// GAME ROUND RECORDING FLOW (Bottom Sheet)
// ==========================================================================
function initRoundFlow() {
  roundSelectionState = {
    step: 1,
    ranks: [null, null, null, null]
  };
  openSheet("record-round");
  updateRoundSummaryScoreLabels();
  startRoundStep(1);
}

function getRoundScoreValues(mode) {
  const multiplier = ROUND_SCORE_MULTIPLIERS[mode] ?? ROUND_SCORE_MULTIPLIERS['2/4'];
  return {
    first: Math.round(ROUND_SCORE_BASE.first * multiplier),
    second: Math.round(ROUND_SCORE_BASE.second * multiplier),
    third: Math.round(ROUND_SCORE_BASE.third * multiplier),
    fourth: Math.round(ROUND_SCORE_BASE.fourth * multiplier)
  };
}

function renderRoundScoreModeOptions() {
  document.querySelectorAll('.btn-score-mode').forEach(btn => {
    const mode = btn.getAttribute('data-mode');
    btn.classList.toggle('active', mode === state.scoreMode);
  });
  const scoreModeInput = document.getElementById('setup-score-mode');
  if (scoreModeInput) {
    scoreModeInput.value = state.scoreMode;
  }
}

function updateRoundSummaryScoreLabels() {
  const values = getRoundScoreValues(state.scoreMode);
  document.getElementById('summary-rank-1-delta').textContent = `+${values.first} điểm`;
  document.getElementById('summary-rank-2-delta').textContent = `+${values.second} điểm`;
  document.getElementById('summary-rank-3-delta').textContent = `${values.third} điểm`;
  document.getElementById('summary-rank-4-delta').textContent = `${values.fourth} điểm`;
}

function startRoundStep(step) {
  roundSelectionState.step = step;

  const stepContainer = document.getElementById("round-step-container");
  const summaryContainer = document.getElementById("round-summary-container");

  if (step <= 3) {
    stepContainer.classList.remove("hidden");
    summaryContainer.classList.add("hidden");

    const values = getRoundScoreValues(state.scoreMode);
    // Update labels based on rank selection
    const title = document.getElementById("round-step-title");
    let rankName = "";
    if (step === 1) rankName = `NHẤT (+${values.first})`;
    else if (step === 2) rankName = `NHÌ (+${values.second})`;
    else if (step === 3) rankName = `BA (${values.third})`;

    title.textContent = `Chọn người chơi về ${rankName}`;

    // Draw remaining selectable players
    const listContainer = document.getElementById("round-step-players");
    listContainer.innerHTML = "";

    state.players.forEach(p => {
      // Check if player is already ranked in previous steps
      if (!roundSelectionState.ranks.slice(0, step - 1).includes(p.id)) {
        const btn = document.createElement("button");
        btn.className = "btn-select-player";
        btn.innerHTML = `<span>${escapeHTML(p.name)}</span>`;
        btn.addEventListener("click", () => handleSelectRoundPlayer(p.id));
        listContainer.appendChild(btn);
      }
    });
  } else {
    // Step 4: Summary & Confirm
    stepContainer.classList.add("hidden");
    summaryContainer.classList.remove("hidden");

    const values = getRoundScoreValues(state.scoreMode);

    // Identify 4th place (the player that wasn't chosen)
    const allIds = [1, 2, 3, 4];
    const chosenIds = roundSelectionState.ranks.slice(0, 3);
    const fourthId = allIds.find(id => !chosenIds.includes(id));
    roundSelectionState.ranks[3] = fourthId;

    // Fill names in summary
    for (let r = 1; r <= 4; r++) {
      const pId = roundSelectionState.ranks[r - 1];
      const p = state.players.find(player => player.id === pId);
      document.getElementById(`summary-rank-${r}-name`).textContent = p ? p.name : "-";
    }

    updateRoundSummaryScoreLabels();
  }
}

function handleSelectRoundPlayer(playerId) {
  const currentStep = roundSelectionState.step;
  roundSelectionState.ranks[currentStep - 1] = playerId;
  startRoundStep(currentStep + 1);
}

function handleSaveRound() {
  const ranks = roundSelectionState.ranks;
  const values = getRoundScoreValues(state.scoreMode);

  // Ranks indexes: 0: Nhất, 1: Nhì, 2: Ba, 3: Tư
  const deltas = { 1: 0, 2: 0, 3: 0, 4: 0 };
  deltas[ranks[0]] = values.first;
  deltas[ranks[1]] = values.second;
  deltas[ranks[2]] = values.third;
  deltas[ranks[3]] = values.fourth;

  // Update state scores
  state.players.forEach(p => {
    p.score += deltas[p.id];
  });

  // Details string for history
  const name1 = state.players.find(p => p.id === ranks[0]).name;
  const name2 = state.players.find(p => p.id === ranks[1]).name;
  const name3 = state.players.find(p => p.id === ranks[2]).name;
  const name4 = state.players.find(p => p.id === ranks[3]).name;

  const roundNum = state.history.filter(h => h.type === 'round').length + 1;
  const details = `Ván #${roundNum} (${state.scoreMode}): ${name1} Nhất, ${name2} Nhì, ${name3} Ba, ${name4} Tư`;

  // Save history item
  const historyItem = {
    id: "round_" + Date.now(),
    timestamp: Date.now(),
    type: 'round',
    details: details,
    deltas: deltas
  };

  state.history.push(historyItem);
  saveState();

  // Close and render
  closeAllSheets();
  renderScoreboard();
  renderHistory();

  // Floating score updates
  const floatValues = [values.first, values.second, values.third, values.fourth];
  ranks.forEach((pId, idx) => {
    triggerFloatingPoints(pId, floatValues[idx]);
  });
}

// ==========================================================================
// CHOP / PENALTY RECORDING FLOW (Bottom Sheet)
// ==========================================================================
function initChopFlow() {
  chopSelectionState = {
    step: 1,
    loserId: null,
    winnerId: null,
    points: 0,
    typeName: "",
    quantity: 1
  };
  openSheet("record-chop");
  startChopStep(1);
}

function startChopStep(step) {
  chopSelectionState.step = step;

  const step1 = document.getElementById("chop-step-loser-container");
  const step2 = document.getElementById("chop-step-winner-container");
  const step3 = document.getElementById("chop-step-type-container");
  const step4 = document.getElementById("chop-step-summary-container");

  // Reset visibilities
  step1.classList.add("hidden");
  step2.classList.add("hidden");
  step3.classList.add("hidden");
  step4.classList.add("hidden");

  if (step === 1) {
    step1.classList.remove("hidden");
    const list = document.getElementById("chop-loser-list");
    list.innerHTML = "";

    state.players.forEach(p => {
      const btn = document.createElement("button");
      btn.className = "btn-select-player";
      btn.innerHTML = `<span>${escapeHTML(p.name)}</span>`;
      btn.addEventListener("click", () => {
        chopSelectionState.winnerId = p.id;
        startChopStep(2);
      });
      list.appendChild(btn);
    });
  }
  else if (step === 2) {
    step2.classList.remove("hidden");
    const list = document.getElementById("chop-winner-list");
    list.innerHTML = "";

    state.players.forEach(p => {
      // Cannot chop yourself
      if (p.id !== chopSelectionState.winnerId) {
        const btn = document.createElement("button");
        btn.className = "btn-select-player";
        btn.innerHTML = `<span>${escapeHTML(p.name)}</span>`;
        btn.addEventListener("click", () => {
          chopSelectionState.loserId = p.id;
          startChopStep(3);
        });
        list.appendChild(btn);
      }
    });
  }
  else if (step === 3) {
    step3.classList.remove("hidden");
    const grid = document.querySelector(".chop-type-grid");

    // Set click handlers for chop types and update visible pts based on score mode
    const multiplier = ROUND_SCORE_MULTIPLIERS[state.scoreMode] ?? 1;
    const buttons = grid.querySelectorAll(".btn-chop-type");
    buttons.forEach(btn => {
      // Re-create node to strip old event listeners easily
      const newBtn = btn.cloneNode(true);
      btn.parentNode.replaceChild(newBtn, btn);

      // Update displayed points inside the button (if element exists)
      const basePts = parseInt(newBtn.getAttribute("data-points"), 10) || 0;
      const scaled = Math.round(basePts * multiplier);
      const ptsEl = newBtn.querySelector('.chop-pts');
      if (ptsEl) ptsEl.textContent = `+${scaled} / -${scaled}`;

      newBtn.addEventListener("click", () => {
        chopSelectionState.points = basePts; // store base, scale when applying
        chopSelectionState.typeName = newBtn.getAttribute("data-name");
        startChopStep(4);
      });
    });
  }
  else if (step === 4) {
    step4.classList.remove("hidden");
    chopSelectionState.quantity = 1; // Mặc định số lượng là 1
    updateChopSummaryUI();
  }
}

// Cập nhật giao diện tóm tắt phạt/chặt theo số lượng chọn
function updateChopSummaryUI() {
  const loser = state.players.find(p => p.id === chopSelectionState.loserId);
  const winner = state.players.find(p => p.id === chopSelectionState.winnerId);
  const typeName = chopSelectionState.typeName;
  const multiplier = ROUND_SCORE_MULTIPLIERS[state.scoreMode] ?? 1;
  const basePts = Math.round(chopSelectionState.points * multiplier);
  const qty = chopSelectionState.quantity;
  const totalPts = basePts * qty;

  document.getElementById("chop-quantity-val").textContent = qty;

  document.getElementById("chop-summary-loser").textContent = loser.name;
  document.getElementById("chop-summary-loser-points").textContent = `-${totalPts}`;

  document.getElementById("chop-summary-type").textContent = qty > 1 ? `${typeName} x${qty}` : typeName;

  document.getElementById("chop-summary-winner").textContent = winner.name;
  document.getElementById("chop-summary-winner-points").textContent = `+${totalPts}`;
}

function handleSaveChop() {
  const winnerId = chopSelectionState.winnerId;
  const loserId = chopSelectionState.loserId;
  const qty = chopSelectionState.quantity;
  const multiplier = ROUND_SCORE_MULTIPLIERS[state.scoreMode] ?? 1;
  const basePts = Math.round(chopSelectionState.points * multiplier);
  const totalPts = basePts * qty;
  const typeName = chopSelectionState.typeName;

  const deltas = { 1: 0, 2: 0, 3: 0, 4: 0 };
  deltas[winnerId] = totalPts;
  deltas[loserId] = -totalPts;

  // Apply to state
  state.players.forEach(p => {
    p.score += deltas[p.id];
  });

  const winner = state.players.find(p => p.id === winnerId);
  const loser = state.players.find(p => p.id === loserId);
  const labelWithQty = qty > 1 ? `${typeName} x${qty}` : typeName;
  const details = `${winner.name} chặt ${loser.name} (${labelWithQty})`;

  const historyItem = {
    id: "chop_" + Date.now(),
    timestamp: Date.now(),
    type: 'chop',
    details: details,
    deltas: deltas
  };
  state.history.push(historyItem);
  saveState();

  closeAllSheets();
  renderScoreboard();
  renderHistory();

  // Floating updates
  triggerFloatingPoints(winnerId, totalPts);
  triggerFloatingPoints(loserId, -totalPts);
}


// ===============================
// KILL / ĐÁNH BẠI RULE IMPLEMENTATION
// ===============================
function initKillFlow() {
  killSelectionState = {
    step: 1,
    killerId: null,
    victimId: null,
    penalties: {
      blackPig: false,
      redPig: false,
      threePairs: false,
      quad: false
    },
    totalPoints: 8
  };
  openSheet("record-kill");
  startKillStep(1);
}

function startKillStep(step) {
  killSelectionState.step = step;

  // Ensure headers show scaled base values according to selected score mode
  const killMultiplier = ROUND_SCORE_MULTIPLIERS[state.scoreMode] ?? 1;
  const killBase = Math.round(8 * killMultiplier);

  const step1 = document.getElementById("kill-step-killer-container");
  const step2 = document.getElementById("kill-step-victim-container");
  const step3 = document.getElementById("kill-step-penalties-container");
  const step4 = document.getElementById("kill-step-summary-container");

  [step1, step2, step3, step4].forEach(el => el.classList.add("hidden"));

  if (step === 1) {
    step1.classList.remove("hidden");
    const titleEl1 = step1.querySelector('.step-title');
    if (titleEl1) titleEl1.textContent = `1. Ai là người giết? (+${killBase} điểm)`;
    const list = document.getElementById("kill-killer-list");
    list.innerHTML = "";
    state.players.forEach(p => {
      const btn = document.createElement("button");
      btn.className = "btn-select-player";
      btn.innerHTML = `<span>${escapeHTML(p.name)}</span>`;
      btn.addEventListener("click", () => {
        killSelectionState.killerId = p.id;
        startKillStep(2);
      });
      list.appendChild(btn);
    });
  } else if (step === 2) {
    step2.classList.remove("hidden");
    const titleEl2 = step2.querySelector('.step-title');
    if (titleEl2) titleEl2.textContent = `2. Ai bị giết? (-${killBase} điểm)`;
    const list = document.getElementById("kill-victim-list");
    list.innerHTML = "";
    state.players.forEach(p => {
      if (p.id !== killSelectionState.killerId) {
        const btn = document.createElement("button");
        btn.className = "btn-select-player";
        btn.innerHTML = `<span>${escapeHTML(p.name)}</span>`;
        btn.addEventListener("click", () => {
          killSelectionState.victimId = p.id;
          startKillStep(3);
        });
        list.appendChild(btn);
      }
    });
  } else if (step === 3) {
    step3.classList.remove("hidden");
    const titleEl3 = step3.querySelector('.step-title');
    if (titleEl3) titleEl3.textContent = `3. Chọn bộ đặc biệt còn trên tay người bị giết`;
    const container = document.getElementById("kill-penalties-grid");
    container.innerHTML = "";
    const multiplier = ROUND_SCORE_MULTIPLIERS[state.scoreMode] ?? 1;
    KILL_PENALTIES.forEach(penalty => {
      const scaled = Math.round(penalty.points * multiplier);
      const label = document.createElement("label");
      label.className = "kill-penalty-card";
      label.innerHTML = `
        <input type="checkbox" data-key="${penalty.key}" />
        <div>
          <strong>${penalty.label}</strong>
          <span>-${scaled}</span>
        </div>
      `;
      const checkbox = label.querySelector("input");
      checkbox.addEventListener("change", () => {
        killSelectionState.penalties[penalty.key] = checkbox.checked;
        updateKillSummaryUI();
      });
      container.appendChild(label);
    });
    updateKillSummaryUI();
  } else if (step === 4) {
    step4.classList.remove("hidden");
    updateKillSummaryUI();
  }
}

function calculateKillPenaltyPoints() {
  const multiplier = ROUND_SCORE_MULTIPLIERS[state.scoreMode] ?? 1;
  return KILL_PENALTIES.reduce((sum, penalty) => {
    return sum + (killSelectionState.penalties[penalty.key] ? Math.round(penalty.points * multiplier) : 0);
  }, 0);
}

function updateKillSummaryUI() {
  const killer = state.players.find(p => p.id === killSelectionState.killerId);
  const victim = state.players.find(p => p.id === killSelectionState.victimId);
  const multiplier = ROUND_SCORE_MULTIPLIERS[state.scoreMode] ?? 1;
  const bonus = calculateKillPenaltyPoints();
  const base = Math.round(8 * multiplier);
  const total = base + bonus;

  document.getElementById("kill-summary-killer").textContent = killer ? killer.name : "-";
  document.getElementById("kill-summary-victim").textContent = victim ? victim.name : "-";
  document.getElementById("kill-summary-base").textContent = `+${base}`;
  document.getElementById("kill-summary-penalties").textContent = `-${bonus}`;
  document.getElementById("kill-summary-total").textContent = `${total > 0 ? '+' : ''}${total}`;

  const items = KILL_PENALTIES.filter(p => killSelectionState.penalties[p.key]);
  const detailsEl = document.getElementById("kill-summary-penalty-items");
  if (items.length === 0) {
    detailsEl.textContent = "Không có bộ đặc biệt";
  } else {
    detailsEl.textContent = items.map(p => `${p.label} (-${Math.round(p.points * multiplier)})`).join(', ');
  }
}

function handleSaveKill() {
  const killerId = killSelectionState.killerId;
  const victimId = killSelectionState.victimId;
  if (!killerId || !victimId) return;

  const multiplier = ROUND_SCORE_MULTIPLIERS[state.scoreMode] ?? 1;
  const penaltyPoints = calculateKillPenaltyPoints();
  const totalPoints = Math.round(8 * multiplier) + penaltyPoints;

  const deltas = { 1: 0, 2: 0, 3: 0, 4: 0 };
  deltas[killerId] = totalPoints;
  deltas[victimId] = -totalPoints;

  state.players.forEach(p => {
    p.score += deltas[p.id];
  });

  const killer = state.players.find(p => p.id === killerId);
  const victim = state.players.find(p => p.id === victimId);
  const penalties = KILL_PENALTIES.filter(p => killSelectionState.penalties[p.key]);
  const penaltyDetails = penalties.length > 0 ? `, ${penalties.map(p => p.label).join(', ')}` : '';
  const details = `${killer.name} giết ${victim.name}${penaltyDetails}`;

  const historyItem = {
    id: "kill_" + Date.now(),
    timestamp: Date.now(),
    type: 'kill',
    details: details,
    deltas: deltas
  };
  state.history.push(historyItem);
  saveState();

  closeAllSheets();
  renderScoreboard();
  renderHistory();

  triggerFloatingPoints(killerId, totalPoints);
  triggerFloatingPoints(victimId, -totalPoints);
}


// ===============================
// TỚI TRẮNG RULE IMPLEMENTATION
// ===============================

function initToitrangFlow() {
  toitrangSelectionState = { winnerId: null };
  openSheet("record-toitrang");
  startToitrangStep(1);
}

function startToitrangStep(step) {
  // step 1: select winner
  const winnerContainer = document.getElementById("toitrang-step-winner-container");
  const summaryContainer = document.getElementById("toitrang-step-summary-container");
  // hide both initially
  winnerContainer.classList.add("hidden");
  summaryContainer.classList.add("hidden");

  if (step === 1) {
    winnerContainer.classList.remove("hidden");
    const list = document.getElementById("toitrang-winner-list");
    list.innerHTML = "";
    state.players.forEach(p => {
      const btn = document.createElement("button");
      btn.className = "btn-select-player";
      btn.innerHTML = `<span>${escapeHTML(p.name)}</span>`;
      btn.addEventListener("click", () => {
        toitrangSelectionState.winnerId = p.id;
        startToitrangStep(2);
      });
      list.appendChild(btn);
    });
    // Update header to show scaled winner points
    const headerEl = document.querySelector('#toitrang-step-winner-container .step-title');
    const multiplier = ROUND_SCORE_MULTIPLIERS[state.scoreMode] ?? 1;
    const winnerPts = Math.round(12 * multiplier);
    if (headerEl) headerEl.textContent = `Ai là người tới trắng? (+${winnerPts} điểm)`;
  } else if (step === 2) {
    // Show summary
    summaryContainer.classList.remove("hidden");
    const winnerNameEl = document.getElementById("toitrang-summary-winner");
    const winnerDeltaEl = document.getElementById("toitrang-summary-winner-delta");
    const othersDeltaEl = document.getElementById("toitrang-summary-others-delta");
    const winner = state.players.find(p => p.id === toitrangSelectionState.winnerId);
    winnerNameEl.textContent = winner ? winner.name : "-";

    // Update deltas according to selected score mode
    const multiplier = ROUND_SCORE_MULTIPLIERS[state.scoreMode] ?? 1;
    const winnerPts = Math.round(12 * multiplier);
    const othersPts = Math.round(4 * multiplier);
    if (winnerDeltaEl) winnerDeltaEl.textContent = `+${winnerPts} điểm`;
    if (othersDeltaEl) othersDeltaEl.textContent = `-${othersPts} điểm / người`;
  }
}

function handleSaveToitrang() {
  const winnerId = toitrangSelectionState.winnerId;
  if (!winnerId) return;

  const multiplier = ROUND_SCORE_MULTIPLIERS[state.scoreMode] ?? 1;
  const winnerPts = Math.round(12 * multiplier);
  const othersPts = Math.round(4 * multiplier);

  const deltas = { 1: 0, 2: 0, 3: 0, 4: 0 };
  deltas[winnerId] = winnerPts;
  // other players negative
  Object.keys(deltas).forEach(id => {
    const pid = Number(id);
    if (pid !== winnerId) deltas[pid] = -othersPts;
  });

  // Apply to state
  state.players.forEach(p => {
    p.score += deltas[p.id];
  });

  const winner = state.players.find(p => p.id === winnerId);
  const details = `Toàn thắng: ${winner ? winner.name : ""} (+${winnerPts}), người khác -${othersPts}`;

  const historyItem = {
    id: "toitrang_" + Date.now(),
    timestamp: Date.now(),
    type: "toitrang",
    details: details,
    deltas: deltas
  };
  state.history.push(historyItem);
  saveState();
  closeAllSheets();
  renderScoreboard();
  renderHistory();

  // Floating animations scaled
  triggerFloatingPoints(winnerId, winnerPts);
  Object.keys(deltas).forEach(id => {
    const pid = Number(id);
    if (pid !== winnerId) {
      triggerFloatingPoints(pid, -othersPts);
    }
  });
}



// ==========================================================================
// HISTORY DISPLAY & UNDO ACTION
// ==========================================================================
function renderHistory() {
  const emptyEl = document.getElementById("history-empty");
  const listEl = document.getElementById("history-items");
  const undoBtn = document.getElementById("btn-undo");

  if (!listEl) return;

  listEl.innerHTML = "";

  if (state.history.length === 0) {
    emptyEl.classList.remove("hidden");
    listEl.classList.add("hidden");
    undoBtn.classList.add("hidden");
    return;
  }

  emptyEl.classList.add("hidden");
  listEl.classList.remove("hidden");
  undoBtn.classList.remove("hidden");

  // Build a history snapshot where each card shows the total score accumulated
  // before that specific action was recorded.
  const historyWithTotals = [];
  let runningTotals = Object.fromEntries(state.players.map(p => [p.id, 0]));

  state.history.forEach(item => {
    historyWithTotals.push({
      ...item,
      totals: { ...runningTotals }
    });

    state.players.forEach(p => {
      runningTotals[p.id] += item.deltas[p.id] || 0;
    });
  });

  // Show list items in reverse chronological order (newest first)
  const historyReversed = [...historyWithTotals].reverse();

  historyReversed.forEach(item => {
    const timeStr = formatTime(item.timestamp);

    // Determine history card icon / accent
    let accentBadge = "⚙️";
    if (item.type === 'round') accentBadge = "🏆";
    else if (item.type === 'chop') accentBadge = "⚡";
    else if (item.type === 'kill') accentBadge = "🔪";
    else if (item.type === 'toitrang') accentBadge = "🌟";

    let scoreGridHTML = "";

    // Sort players in the card by original ID order
    state.players.forEach(p => {
      const val = item.deltas[p.id] || 0;
      const total = item.totals?.[p.id] ?? 0;
      let valClass = "zero";
      let displayVal = `${val}`;
      let totalClass = "zero";
      let displayTotal = `${total}`;

      if (val > 0) {
        valClass = "pos";
        displayVal = `+${val}`;
      } else if (val < 0) {
        valClass = "neg";
      }

      if (total > 0) {
        totalClass = "pos";
        displayTotal = `+${total}`;
      } else if (total < 0) {
        totalClass = "neg";
      }

      scoreGridHTML += `
        <div class="history-player-score">
          <span class="history-pname">${escapeHTML(p.name)}</span>
          <span class="history-pval ${valClass}">${displayVal}</span>
          <span class="history-ptotal ${totalClass}">${displayTotal}</span>
        </div>
      `;
    });

    const cardHTML = `
      <div class="history-item-card">
        <div class="history-item-header">
          <span class="history-title">${accentBadge} ${escapeHTML(item.details)}</span>
          <span class="history-time">${timeStr}</span>
        </div>
        <div class="history-grid-scores">
          ${scoreGridHTML}
        </div>
      </div>
    `;
    listEl.insertAdjacentHTML("beforeend", cardHTML);
  });
}

function confirmUndo() {
  if (state.history.length === 0) return;
  const lastItem = state.history[state.history.length - 1];
  showConfirm(
    `Thu hồi lượt gần nhất: "${lastItem.details}"?`,
    handleUndo,
    { title: "Thu Hồi Lượt", confirmLabel: "Thu hồi" }
  );
}

function handleUndo() {
  if (state.history.length === 0) return;

  const itemToUndo = state.history.pop();

  // Subtract deltas from players
  state.players.forEach(p => {
    const delta = itemToUndo.deltas[p.id] || 0;
    p.score -= delta;
  });

  saveState();

  // Alert visual and render
  renderScoreboard();
  renderHistory();

  // Tiny notice on top of dashboard or history
  showNotice(`Đã thu hồi lượt: "${itemToUndo.details}"`, "Hoàn tác thành công");

  // Close sheet if history is now empty
  if (state.history.length === 0) {
    closeAllSheets();
  }
}

// Helper: Format timestamp to hh:mm
function formatTime(timestamp) {
  const date = new Date(timestamp);
  const hours = String(date.getHours()).padStart(2, '0');
  const minutes = String(date.getMinutes()).padStart(2, '0');
  return `${hours}:${minutes}`;
}

// ==========================================================================
// EDIT NAME MODAL LOGIC
// ==========================================================================
function updateEditNameCharCount() {
  const input = document.getElementById("edit-player-name-input");
  const counter = document.getElementById("edit-name-char-count");
  if (input && counter) {
    counter.textContent = `${input.value.length}/${input.maxLength}`;
  }
  hideEditNameError();
}

function showEditNameError(message) {
  const errorEl = document.getElementById("edit-name-error");
  errorEl.textContent = message;
  errorEl.classList.remove("hidden");
}

function hideEditNameError() {
  document.getElementById("edit-name-error").classList.add("hidden");
}

window.openEditNameModal = function (playerId, currentName) {
  const modal = document.getElementById("modal-edit-name");
  const idInput = document.getElementById("edit-player-id");
  const nameInput = document.getElementById("edit-player-name-input");

  idInput.value = playerId;
  nameInput.value = currentName;
  updateEditNameCharCount();
  hideEditNameError();

  openModal("edit-name");

  // Auto-focus input
  setTimeout(() => {
    nameInput.focus();
    nameInput.select();
  }, 100);
};

function handleEditNameSubmit(e) {
  e.preventDefault();

  const id = parseInt(document.getElementById("edit-player-id").value, 10);
  const newName = document.getElementById("edit-player-name-input").value.trim();

  if (!newName) {
    showEditNameError("Tên người chơi không được bỏ trống!");
    return;
  }

  // Validate duplicate
  const exists = state.players.some(p => p.id !== id && p.name.toLowerCase() === newName.toLowerCase());
  if (exists) {
    showEditNameError("Tên này đã được sử dụng bởi người chơi khác!");
    return;
  }

  // Update in state
  const player = state.players.find(p => p.id === id);
  if (player) {
    const oldName = player.name;
    player.name = newName;

    // Update history strings as well if we want names in history to remain matching,
    // though that's optional. Let's do it for consistency!
    state.history.forEach(item => {
      // Replace oldName -> newName, but only whole-name occurrences: without the
      // letter/number boundary check, renaming "An" would also corrupt "Anh".
      const escapedOld = oldName.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&');
      const boundaryRegex = new RegExp(`(?<![\\p{L}\\p{N}])${escapedOld}(?![\\p{L}\\p{N}])`, 'gu');
      item.details = item.details.replace(boundaryRegex, newName);
    });

    saveState();
    closeAllModals();
    renderScoreboard();
    renderHistory();
  }
}

// ==========================================================================
// RESET GAME LOGIC
// ==========================================================================
function handleResetAll() {
  localStorage.removeItem("tienlen_scorekeeper_data");
  state = {
    players: [
      { id: 1, name: "Người chơi 1", score: 0 },
      { id: 2, name: "Người chơi 2", score: 0 },
      { id: 3, name: "Người chơi 3", score: 0 },
      { id: 4, name: "Người chơi 4", score: 0 }
    ],
    history: [],
    currentScreen: 'welcome',
    scoreMode: DEFAULT_STATE.scoreMode
  };

  // Clear setup inputs to defaults
  for (let i = 1; i <= 4; i++) {
    document.getElementById(`player-${i}-input`).value = `Người chơi ${i}`;
  }

  closeAllModals();
  closeAllSheets();
  renderRoundScoreModeOptions();
  saveState();
  showScreen("welcome");
}

// ==========================================================================
// UI HELPERS (Modals & Sheets overlay animations)
// ==========================================================================
function openSheet(sheetId) {
  closeAllSheets();
  const sheet = document.getElementById(`sheet-${sheetId}`);
  if (sheet) {
    sheet.classList.add("active");
  }
}

function closeAllSheets() {
  document.querySelectorAll(".bottom-sheet-overlay").forEach(sheet => {
    sheet.classList.remove("active");
  });
}

function openModal(modalId) {
  const modal = document.getElementById(`modal-${modalId}`);
  if (modal) {
    modal.classList.add("active");
  }
}

function closeAllModals() {
  document.querySelectorAll(".modal-overlay").forEach(modal => {
    modal.classList.remove("active");
  });
}

// In-app replacement for window.alert(): a single-button notice modal
function showNotice(message, title) {
  document.getElementById("notice-modal-title").textContent = title || "Thông báo";
  document.getElementById("notice-modal-message").textContent = message;
  openModal("notice");
}

// In-app replacement for window.confirm(): runs onConfirm only if the user
// picks the confirm button. Cancelling (X, backdrop, or the cancel button)
// just closes the dialog — no callback is called.
let pendingConfirmAction = null;
function showConfirm(message, onConfirm, options = {}) {
  document.getElementById("confirm-modal-title").textContent = options.title || "Xác nhận";
  document.getElementById("confirm-modal-message").textContent = message;
  document.getElementById("confirm-modal-cancel").textContent = options.cancelLabel || "Hủy bỏ";

  const confirmBtn = document.getElementById("btn-confirm-generic");
  confirmBtn.textContent = options.confirmLabel || "Xác nhận";
  confirmBtn.className = "btn " + (options.danger === false ? "btn-primary" : "btn-danger");

  pendingConfirmAction = onConfirm;
  openModal("confirm");
}

// HTML escaping helper to prevent XSS
function escapeHTML(str) {
  return str.replace(/[&<>'"]/g,
    tag => ({
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      "'": '&#39;',
      '"': '&quot;'
    }[tag] || tag)
  );
}

// Expose functions to global scope for inline HTML event handlers
window.adjustScoreQuick = adjustScoreQuick;
