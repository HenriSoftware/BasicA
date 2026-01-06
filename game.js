(() => {
  "use strict";

  // ============================================================
  //  NO DICTIONARY / NO WORD LIST
  //  - Any 5-letter guess is allowed.
  //  - The "answer" is a 5-letter CODE generated from A–Z.
  //
  //  Daily mode:
  //    The code is generated deterministically from today's date (YYYY-MM-DD).
  //    That means: same device + same day => same daily code.
  //
  //  Random mode:
  //    A fresh random code is generated.
  // ============================================================

  const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";

  const COLS = 5;
  const ROWS = 6;

  // Key priorities for keyboard coloring
  const KEY_RANK = { "": 0, absent: 1, present: 2, correct: 3 };

  // Storage keys
  const LS_PREFIX = "neonword_v2";
  const LS_SETTINGS = `${LS_PREFIX}_settings`;
  const LS_STATS = `${LS_PREFIX}_stats`;
  const LS_DAILY_STATE = `${LS_PREFIX}_daily_state`;   // saved per date
  const LS_RANDOM_STATE = `${LS_PREFIX}_random_state`; // saved current random session

  // DOM
  const $ = (id) => document.getElementById(id);

  const gridEl = $("grid");
  const keyboardEl = $("keyboard");
  const toastEl = $("toast");

  const dayBadge = $("dayBadge");
  const btnHelp = $("btnHelp");
  const btnStats = $("btnStats");
  const btnSettings = $("btnSettings");

  const helpModal = $("helpModal");
  const statsModal = $("statsModal");
  const settingsModal = $("settingsModal");

  const tgContrast = $("tgContrast");
  const tgReduceMotion = $("tgReduceMotion");
  const tgHardMode = $("tgHardMode");

  const btnNew = $("btnNew");
  const btnShare = $("btnShare");
  const btnResetStats = $("btnResetStats");

  const stPlayed = $("stPlayed");
  const stWon = $("stWon");
  const stStreak = $("stStreak");
  const stBest = $("stBest");
  const distBars = $("distBars");

  // Settings + Stats
  const defaultSettings = {
    contrast: false,
    reduceMotion: false,
    hardMode: false
  };

  function loadSettings() {
    try {
      const raw = localStorage.getItem(LS_SETTINGS);
      return raw ? { ...defaultSettings, ...JSON.parse(raw) } : { ...defaultSettings };
    } catch {
      return { ...defaultSettings };
    }
  }

  function saveSettings(s) {
    localStorage.setItem(LS_SETTINGS, JSON.stringify(s));
  }

  const defaultStats = {
    played: 0,
    won: 0,
    streak: 0,
    bestStreak: 0,
    dist: [0, 0, 0, 0, 0, 0] // wins in 1..6
  };

  function loadStats() {
    try {
      const raw = localStorage.getItem(LS_STATS);
      return raw ? { ...defaultStats, ...JSON.parse(raw) } : { ...defaultStats };
    } catch {
      return { ...defaultStats };
    }
  }

  function saveStats(s) {
    localStorage.setItem(LS_STATS, JSON.stringify(s));
  }

  let settings = loadSettings();
  let stats = loadStats();
  let state = null;

  // ------------------------------------------------------------
  //  Deterministic daily RNG helpers
  // ------------------------------------------------------------
  function todayKey() {
    const d = new Date();
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    return `${y}-${m}-${day}`; // YYYY-MM-DD
  }

  function hashStringToSeed(str) {
    // Simple stable hash -> 32-bit unsigned seed
    let h = 2166136261;
    for (let i = 0; i < str.length; i++) {
      h ^= str.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return h >>> 0;
  }

  function mulberry32(seed) {
    // Deterministic PRNG from a seed
    return function () {
      let t = (seed += 0x6D2B79F5);
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function generateCode(rng) {
    // returns 5 letters, allows duplicates (like Wordle answers can repeat letters)
    let out = "";
    for (let i = 0; i < COLS; i++) {
      const idx = Math.floor(rng() * ALPHABET.length);
      out += ALPHABET[idx];
    }
    return out;
  }

  function pickDailyAnswer() {
    const key = todayKey();
    const rng = mulberry32(hashStringToSeed(key));
    return generateCode(rng);
  }

  function pickRandomAnswer() {
    // Non-deterministic random
    const rng = Math.random;
    return generateCode(rng);
  }

  // ------------------------------------------------------------
  //  State + Persistence
  // ------------------------------------------------------------
  function freshState(answer, modeKey) {
    return {
      modeKey,            // "daily:YYYY-MM-DD" or "random:timestamp"
      answer,             // string, uppercase, length 5
      grid: Array.from({ length: ROWS }, () => Array(COLS).fill("")),
      evaluations: Array.from({ length: ROWS }, () => Array(COLS).fill("")),
      row: 0,
      col: 0,
      status: "playing",  // playing | won | lost
      keyboard: {},       // letter => absent/present/correct

      // For hard mode validation:
      usedHints: {
        correctPos: {},       // { index: letter }
        presentLetters: []    // ["A","B",...]
      }
    };
  }

  function loadGameState(mode) {
    try {
      if (mode === "daily") {
        const expectedKey = `daily:${todayKey()}`;
        const raw = localStorage.getItem(LS_DAILY_STATE);
        if (!raw) return null;
        const obj = JSON.parse(raw);
        if (obj?.modeKey !== expectedKey) return null;
        return obj;
      }

      const raw = localStorage.getItem(LS_RANDOM_STATE);
      return raw ? JSON.parse(raw) : null;
    } catch {
      return null;
    }
  }

  function saveGameState() {
    if (!state) return;
    if (state.modeKey.startsWith("daily:")) {
      localStorage.setItem(LS_DAILY_STATE, JSON.stringify(state));
    } else {
      localStorage.setItem(LS_RANDOM_STATE, JSON.stringify(state));
    }
  }

  // ------------------------------------------------------------
  //  UI Build
  // ------------------------------------------------------------
  function buildGrid() {
    gridEl.innerHTML = "";
    for (let r = 0; r < ROWS; r++) {
      const rowEl = document.createElement("div");
      rowEl.className = "row";
      rowEl.dataset.row = String(r);

      for (let c = 0; c < COLS; c++) {
        const tile = document.createElement("div");
        tile.className = "tile";
        tile.dataset.row = String(r);
        tile.dataset.col = String(c);
        tile.textContent = "";
        rowEl.appendChild(tile);
      }
      gridEl.appendChild(rowEl);
    }
  }

  const KEYBOARD_ROWS = [
    ["Q","W","E","R","T","Y","U","I","O","P"],
    ["A","S","D","F","G","H","J","K","L"],
    ["ENTER","Z","X","C","V","B","N","M","⌫"]
  ];

  function buildKeyboard() {
    keyboardEl.innerHTML = "";
    for (const row of KEYBOARD_ROWS) {
      const r = document.createElement("div");
      r.className = "krow";

      for (const k of row) {
        const btn = document.createElement("button");
        btn.className = "key" + (k === "ENTER" || k === "⌫" ? " wide" : "");
        btn.type = "button";
        btn.dataset.key = k;
        btn.textContent = k === "⌫" ? "⌫" : k;
        btn.addEventListener("click", () => handleKey(k));
        r.appendChild(btn);
      }
      keyboardEl.appendChild(r);
    }
  }

  // ------------------------------------------------------------
  //  Render helpers
  // ------------------------------------------------------------
  function tileEl(r, c) {
    return gridEl.querySelector(`.tile[data-row="${r}"][data-col="${c}"]`);
  }

  function showToast(msg, ms = 1100) {
    toastEl.textContent = msg;
    toastEl.classList.add("show");
    window.clearTimeout(showToast._t);
    showToast._t = window.setTimeout(() => toastEl.classList.remove("show"), ms);
  }

  function setContrastUI(on) {
    document.documentElement.setAttribute("data-contrast", on ? "1" : "0");
  }

  function syncSettingsUI() {
    tgContrast.checked = !!settings.contrast;
    tgReduceMotion.checked = !!settings.reduceMotion;
    tgHardMode.checked = !!settings.hardMode;
    setContrastUI(!!settings.contrast);
  }

  function renderAll() {
    // Grid
    for (let r = 0; r < ROWS; r++) {
      for (let c = 0; c < COLS; c++) {
        const t = tileEl(r, c);
        const ch = state.grid[r][c];
        const ev = state.evaluations[r][c];

        t.textContent = ch || "";
        t.classList.toggle("filled", !!ch);

        t.classList.remove("correct","present","absent");
        if (ev) t.classList.add(ev);
      }
    }

    // Keyboard coloring
    const buttons = keyboardEl.querySelectorAll(".key");
    buttons.forEach(b => {
      const k = b.dataset.key;
      if (!k || k === "ENTER" || k === "⌫") return;
      b.classList.remove("correct","present","absent");
      const v = state.keyboard[k] || "";
      if (v) b.classList.add(v);
    });

    // Badge
    if (state.modeKey.startsWith("daily:")) {
      dayBadge.textContent = "Daily";
      dayBadge.title = "Daily code (local)";
    } else {
      dayBadge.textContent = "Random";
      dayBadge.title = "Random code";
    }
  }

  function animateRowShake(r) {
    const rowEl = gridEl.querySelector(`.row[data-row="${r}"]`);
    if (!rowEl || settings.reduceMotion) return;
    rowEl.classList.remove("shake");
    void rowEl.offsetWidth;
    rowEl.classList.add("shake");
  }

  function animateTilePop(r, c) {
    const t = tileEl(r, c);
    if (!t || settings.reduceMotion) return;
    t.classList.remove("pop");
    void t.offsetWidth;
    t.classList.add("pop");
  }

  function wait(ms) {
    return new Promise(res => setTimeout(res, ms));
  }

  async function revealRow(r, evals) {
    for (let c = 0; c < COLS; c++) {
      const t = tileEl(r, c);
      if (!t) continue;

      const ev = evals[c];
      state.evaluations[r][c] = ev;

      if (!settings.reduceMotion) {
        t.classList.remove("reveal");
        void t.offsetWidth;
        t.classList.add("reveal");
        await wait(70);
      }

      t.classList.remove("correct","present","absent");
      if (ev) t.classList.add(ev);
    }
  }

  // ------------------------------------------------------------
  //  Wordle evaluation (handles duplicates)
  // ------------------------------------------------------------
  function evaluateGuess(guess, answer) {
    const g = guess.split("");
    const a = answer.split("");

    const res = Array(COLS).fill("absent");
    const used = Array(COLS).fill(false);

    // pass 1: correct
    for (let i = 0; i < COLS; i++) {
      if (g[i] === a[i]) {
        res[i] = "correct";
        used[i] = true;
      }
    }

    // pass 2: present
    for (let i = 0; i < COLS; i++) {
      if (res[i] === "correct") continue;
      const ch = g[i];
      let found = -1;
      for (let j = 0; j < COLS; j++) {
        if (!used[j] && a[j] === ch) { found = j; break; }
      }
      if (found !== -1) {
        res[i] = "present";
        used[found] = true;
      }
    }

    return res;
  }

  function updateKeyboardFromEval(guess, evals) {
    for (let i = 0; i < COLS; i++) {
      const ch = guess[i];
      const ev = evals[i];
      const prev = state.keyboard[ch] || "";
      if (KEY_RANK[ev] > KEY_RANK[prev]) state.keyboard[ch] = ev;
    }
  }

  // ------------------------------------------------------------
  //  Hard mode: must reuse revealed hints
  // ------------------------------------------------------------
  function deriveHintsFromRow(guess, evals) {
    for (let i = 0; i < COLS; i++) {
      if (evals[i] === "correct") state.usedHints.correctPos[i] = guess[i];
    }
    const presents = new Set(state.usedHints.presentLetters);
    for (let i = 0; i < COLS; i++) {
      if (evals[i] === "present" || evals[i] === "correct") presents.add(guess[i]);
    }
    state.usedHints.presentLetters = Array.from(presents);
  }

  function validateHardMode(nextGuess) {
    const cp = state.usedHints.correctPos;
    for (const idxStr of Object.keys(cp)) {
      const idx = Number(idxStr);
      if (nextGuess[idx] !== cp[idx]) {
        return `Hard Mode: position ${idx + 1} must be "${cp[idx]}".`;
      }
    }
    for (const ch of state.usedHints.presentLetters) {
      if (!nextGuess.includes(ch)) return `Hard Mode: use "${ch}".`;
    }
    return "";
  }

  // ------------------------------------------------------------
  //  Input / Gameplay
  // ------------------------------------------------------------
  function setLetter(ch) {
    if (state.status !== "playing") return;
    if (state.col >= COLS) return;

    state.grid[state.row][state.col] = ch;
    animateTilePop(state.row, state.col);
    state.col++;
    saveGameState();
    renderAll();
  }

  function backspace() {
    if (state.status !== "playing") return;
    if (state.col <= 0) return;

    state.col--;
    state.grid[state.row][state.col] = "";
    saveGameState();
    renderAll();
  }

  async function submit() {
    if (state.status !== "playing") return;

    const rowArr = state.grid[state.row];
    const filled = rowArr.every(ch => typeof ch === "string" && ch.length === 1);
    if (!filled) {
      showToast("Enter 5 letters");
      animateRowShake(state.row);
      return;
    }

    const guess = rowArr.join("");
    if (settings.hardMode) {
      const msg = validateHardMode(guess);
      if (msg) {
        showToast(msg, 1400);
        animateRowShake(state.row);
        return;
      }
    }

    const evals = evaluateGuess(guess, state.answer);
    await revealRow(state.row, evals);

    updateKeyboardFromEval(guess, evals);
    deriveHintsFromRow(guess, evals);

    const won = evals.every(e => e === "correct");
    if (won) {
      state.status = "won";
      saveGameState();
      renderAll();
      onGameEnd(true, state.row + 1);
      showToast("You win!");
      return;
    }

    if (state.row === ROWS - 1) {
      state.status = "lost";
      saveGameState();
      renderAll();
      onGameEnd(false, 0);
      showToast(`You lose — ${state.answer}`);
      return;
    }

    state.row++;
    state.col = 0;
    saveGameState();
    renderAll();
  }

  function handleKey(k) {
    if (!state) return;

    if (k === "ENTER") return submit();
    if (k === "⌫" || k === "BACKSPACE") return backspace();

    const ch = (k.length === 1 ? k.toUpperCase() : "");
    if (!/^[A-Z]$/.test(ch)) return;
    setLetter(ch);
  }

  function bindPhysicalKeyboard() {
    window.addEventListener("keydown", (e) => {
      if (helpModal.open || statsModal.open || settingsModal.open) {
        if (e.key === "Escape") closeAllModals();
        return;
      }

      if (e.key === "Enter") { e.preventDefault(); handleKey("ENTER"); return; }
      if (e.key === "Backspace") { e.preventDefault(); handleKey("BACKSPACE"); return; }

      const ch = e.key.toUpperCase();
      if (/^[A-Z]$/.test(ch)) handleKey(ch);
    });
  }

  // ------------------------------------------------------------
  //  Modals
  // ------------------------------------------------------------
  function closeAllModals() {
    [helpModal, statsModal, settingsModal].forEach(m => { if (m.open) m.close(); });
  }

  function bindModals() {
    btnHelp.addEventListener("click", () => helpModal.showModal());
    btnStats.addEventListener("click", () => { renderStats(); statsModal.showModal(); });
    btnSettings.addEventListener("click", () => settingsModal.showModal());

    document.querySelectorAll("[data-close]").forEach(b => {
      b.addEventListener("click", () => closeAllModals());
    });

    [helpModal, statsModal, settingsModal].forEach(m => {
      m.addEventListener("click", (e) => {
        const r = m.getBoundingClientRect();
        const inside =
          e.clientX >= r.left && e.clientX <= r.right &&
          e.clientY >= r.top && e.clientY <= r.bottom;
        if (!inside) m.close();
      });
    });
  }

  // ------------------------------------------------------------
  //  Stats + Share
  // ------------------------------------------------------------
  function onGameEnd(won, attempt) {
    stats.played++;

    if (won) {
      stats.won++;
      stats.streak++;
      stats.bestStreak = Math.max(stats.bestStreak, stats.streak);
      if (attempt >= 1 && attempt <= 6) stats.dist[attempt - 1]++;
      saveStats(stats);
      return;
    }

    stats.streak = 0;
    saveStats(stats);
  }

  function renderStats() {
    stPlayed.textContent = String(stats.played);
    stWon.textContent = String(stats.won);
    stStreak.textContent = String(stats.streak);
    stBest.textContent = String(stats.bestStreak);

    distBars.innerHTML = "";
    const max = Math.max(1, ...stats.dist);

    for (let i = 0; i < 6; i++) {
      const row = document.createElement("div");
      row.className = "barRow";

      const label = document.createElement("div");
      label.className = "barLabel";
      label.textContent = String(i + 1);

      const bar = document.createElement("div");
      bar.className = "bar";
      const fill = document.createElement("span");
      fill.style.width = `${Math.round((stats.dist[i] / max) * 100)}%`;
      bar.appendChild(fill);

      const val = document.createElement("div");
      val.className = "barValue";
      val.textContent = String(stats.dist[i]);

      row.appendChild(label);
      row.appendChild(bar);
      row.appendChild(val);
      distBars.appendChild(row);
    }
  }

  function evalToEmoji(e) {
    if (e === "correct") return "🟩";
    if (e === "present") return "🟨";
    return "⬛";
  }

  async function shareResult() {
    const rows = [];
    for (let r = 0; r < ROWS; r++) {
      const ev = state.evaluations[r];
      if (!ev || !ev[0]) break;
      rows.push(ev.map(evalToEmoji).join(""));
    }

    const solved = state.status === "won";
    const modeLabel = state.modeKey.startsWith("daily:") ? todayKey() : "Random";
    const attempts = solved ? rows.length : "X";
    const header = `NeonWord ${modeLabel} ${attempts}/6`;
    const text = `${header}\n${rows.join("\n")}`;

    try {
      await navigator.clipboard.writeText(text);
      showToast("Copied to clipboard");
    } catch {
      showToast("Copy failed");
    }
  }

  // ------------------------------------------------------------
  //  New game / mode
  // ------------------------------------------------------------
  function newDailyGameIfNeeded() {
    const loaded = loadGameState("daily");
    if (loaded) {
      state = loaded;
      return;
    }
    const key = `daily:${todayKey()}`;
    const answer = pickDailyAnswer();
    state = freshState(answer, key);
    saveGameState();
  }

  function newRandomGame() {
    const key = `random:${Date.now()}`;
    const answer = pickRandomAnswer();
    state = freshState(answer, key);
    saveGameState();
  }

  // ------------------------------------------------------------
  //  Settings bindings
  // ------------------------------------------------------------
  function bindSettings() {
    tgContrast.addEventListener("change", () => {
      settings.contrast = tgContrast.checked;
      setContrastUI(settings.contrast);
      saveSettings(settings);
    });

    tgReduceMotion.addEventListener("change", () => {
      settings.reduceMotion = tgReduceMotion.checked;
      saveSettings(settings);
      showToast(settings.reduceMotion ? "Reduce motion: on" : "Reduce motion: off");
    });

    tgHardMode.addEventListener("change", () => {
      settings.hardMode = tgHardMode.checked;
      saveSettings(settings);
      showToast(settings.hardMode ? "Hard mode: on" : "Hard mode: off");
    });

    btnResetStats.addEventListener("click", () => {
      stats = { played: 0, won: 0, streak: 0, bestStreak: 0, dist: [0,0,0,0,0,0] };
      saveStats(stats);
      renderStats();
      showToast("Stats reset");
    });
  }

  // ------------------------------------------------------------
  //  Init
  // ------------------------------------------------------------
  function init() {
    syncSettingsUI();
    buildGrid();
    buildKeyboard();
    bindPhysicalKeyboard();
    bindModals();
    bindSettings();

    btnNew.addEventListener("click", () => {
      newRandomGame();
      renderAll();
      showToast("Random game started");
    });

    btnShare.addEventListener("click", () => {
      if (state.status === "playing") {
        showToast("Finish the game first");
        animateRowShake(state.row);
        return;
      }
      shareResult();
    });

    renderStats();

    // default: daily
    newDailyGameIfNeeded();
    renderAll();

    if (state.status !== "playing") {
      showToast(state.status === "won" ? "Solved today ✅" : "Lost today", 1200);
    }
  }

  init();
})();
