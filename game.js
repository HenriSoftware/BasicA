(() => {
  "use strict";

  // ==============
  //  WORD LIST
  //  - Alle Wörter: 5 Buchstaben, A-Z, ohne Umlaute (äöü->ae/oe/ue) für einfache Engine
  //  - Du kannst die Liste beliebig erweitern/ersetzen
  // ==============
  const WORDS = [
    "abend","apfel","arena","audio","banal","brett","clown","dinge","drama","eigen",
    "fabel","farbe","fisch","flink","frage","geist","glanz","gruen","heute","ideal",
    "joker","juwel","kabel","kanal","kiste","klang","knapp","kugel","laden","laser",
    "licht","linie","lobby","lunge","markt","mauer","metal","modus","nacht","nebel",
    "oasen","piano","pixel","punkt","quark","radio","route","sache","saldo","sauber",
    "schub","seide","serie","sonne","stahl","start","taste","tempo","tiger","total",
    "union","vital","wache","walze","wiese","wolke","zebra","zonen"
  ].map(w => w.toUpperCase());

  // ==============
  //  CONFIG
  // ==============
  const COLS = 5;
  const ROWS = 6;

  // Key priorities for keyboard coloring
  const KEY_RANK = { "": 0, absent: 1, present: 2, correct: 3 };

  // Storage keys
  const LS_PREFIX = "neonword_v1";
  const LS_SETTINGS = `${LS_PREFIX}_settings`;
  const LS_STATS = `${LS_PREFIX}_stats`;
  const LS_DAILY_STATE = `${LS_PREFIX}_daily_state`; // per date
  const LS_RANDOM_STATE = `${LS_PREFIX}_random_state`; // current random session

  // ==============
  //  DOM
  // ==============
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

  // ==============
  //  SETTINGS + STATS
  // ==============
  const defaultSettings = {
    contrast: false,
    reduceMotion: false,
    hardMode: false,
    mode: "daily" // "daily" or "random"
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

  // ==============
  //  GAME STATE
  // ==============
  let settings = loadSettings();
  let stats = loadStats();

  // state object is swapped depending on daily/random
  let state = null;

  function todayKey() {
    // YYYY-MM-DD
    const d = new Date();
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    return `${y}-${m}-${day}`;
  }

  function mulberry32(seed) {
    // deterministic RNG
    return function() {
      let t = (seed += 0x6D2B79F5);
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function hashStringToSeed(str) {
    // stable seed from string
    let h = 2166136261;
    for (let i = 0; i < str.length; i++) {
      h ^= str.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return h >>> 0;
  }

  function pickDailyAnswer() {
    const key = todayKey();
    const rng = mulberry32(hashStringToSeed(key));
    const idx = Math.floor(rng() * WORDS.length);
    return WORDS[idx];
  }

  function pickRandomAnswer() {
    const idx = Math.floor(Math.random() * WORDS.length);
    return WORDS[idx];
  }

  function freshState(answer, modeKey) {
    return {
      modeKey,            // "daily:YYYY-MM-DD" or "random:timestamp"
      answer,             // string, uppercase
      grid: Array.from({ length: ROWS }, () => Array(COLS).fill("")),
      evaluations: Array.from({ length: ROWS }, () => Array(COLS).fill("")),
      row: 0,
      col: 0,
      status: "playing",  // playing | won | lost
      keyboard: {},       // letter => absent/present/correct
      usedHints: {
        // for hard mode: must reuse known hints
        // correctPos: Map(index->letter), presentLetters: Set(letter)
        correctPos: {},
        presentLetters: []
      }
    };
  }

  function loadGameState(mode) {
    if (mode === "daily") {
      const key = `daily:${todayKey()}`;
      try {
        const raw = localStorage.getItem(LS_DAILY_STATE);
        if (!raw) return null;
        const obj = JSON.parse(raw);
        if (obj?.modeKey !== key) return null;
        return obj;
      } catch {
        return null;
      }
    } else {
      try {
        const raw = localStorage.getItem(LS_RANDOM_STATE);
        if (!raw) return null;
        const obj = JSON.parse(raw);
        return obj;
      } catch {
        return null;
      }
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

  // ==============
  //  UI BUILD
  // ==============
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

  // ==============
  //  RENDER
  // ==============
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

    // Mode badge
    if (state.modeKey.startsWith("daily:")) {
      dayBadge.textContent = "Daily";
      dayBadge.title = "Tägliches Wort";
    } else {
      dayBadge.textContent = "Random";
      dayBadge.title = "Zufälliges Wort";
    }
  }

  function animateRowShake(r) {
    const rowEl = gridEl.querySelector(`.row[data-row="${r}"]`);
    if (!rowEl) return;
    if (settings.reduceMotion) return;
    rowEl.classList.remove("shake");
    void rowEl.offsetWidth;
    rowEl.classList.add("shake");
  }

  function animateTilePop(r, c) {
    const t = tileEl(r, c);
    if (!t) return;
    if (settings.reduceMotion) return;
    t.classList.remove("pop");
    void t.offsetWidth;
    t.classList.add("pop");
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

  function wait(ms) {
    return new Promise(res => setTimeout(res, ms));
  }

  // ==============
  //  WORDLE EVALUATION (with duplicates handled)
  // ==============
  function evaluateGuess(guess, answer) {
    // guess/answer uppercase
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
        if (!used[j] && a[j] === ch) {
          found = j;
          break;
        }
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
      if (KEY_RANK[ev] > KEY_RANK[prev]) {
        state.keyboard[ch] = ev;
      }
    }
  }

  // ==============
  //  HARD MODE (simple but correct)
  // ==============
  function deriveHintsFromRow(guess, evals) {
    // correct positions
    for (let i = 0; i < COLS; i++) {
      if (evals[i] === "correct") state.usedHints.correctPos[i] = guess[i];
    }
    // present letters
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
        return `Hard Mode: Position ${idx + 1} muss "${cp[idx]}" sein.`;
      }
    }
    // Must include all known present letters at least once
    for (const ch of state.usedHints.presentLetters) {
      if (!nextGuess.includes(ch)) {
        return `Hard Mode: Nutze den Hinweis "${ch}".`;
      }
    }
    return "";
  }

  // ==============
  //  INPUT / GAMEPLAY
  // ==============
  function currentGuess() {
    return state.grid[state.row].join("");
  }

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

  function isValidWord(w) {
    // Engine: only accept from WORDS list to keep it Wordle-like
    return WORDS.includes(w);
  }

  async function submit() {
    if (state.status !== "playing") return;

    const rowArr = state.grid[state.row];
const guess = rowArr.join("");

if (rowArr.includes("") || guess.length !== COLS) {
  showToast("5 Buchstaben eingeben");
  animateRowShake(state.row);
  return;
}
  

    if (!isValidWord(guess)) {
      showToast("Wort nicht in Liste");
      animateRowShake(state.row);
      return;
    }

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
      showToast("Gewonnen!");
      return;
    }

    if (state.row === ROWS - 1) {
      state.status = "lost";
      saveGameState();
      renderAll();
      onGameEnd(false, 0);
      showToast(`Verloren — ${state.answer}`);
      return;
    }

    // next row
    state.row++;
    state.col = 0;
    saveGameState();
    renderAll();
  }

  function handleKey(k) {
    if (!state) return;

    if (k === "ENTER") return submit();
    if (k === "⌫" || k === "BACKSPACE") return backspace();

    // Only A-Z
    const ch = k.length === 1 ? k.toUpperCase() : "";
    if (!/^[A-Z]$/.test(ch)) return;
    setLetter(ch);
  }

  function bindPhysicalKeyboard() {
    window.addEventListener("keydown", (e) => {
      if (helpModal.open || statsModal.open || settingsModal.open) {
        if (e.key === "Escape") closeAllModals();
        return;
      }

      const key = e.key;
      if (key === "Enter") { e.preventDefault(); handleKey("ENTER"); return; }
      if (key === "Backspace") { e.preventDefault(); handleKey("BACKSPACE"); return; }

      const ch = key.toUpperCase();
      if (/^[A-ZÄÖÜ]$/.test(ch)) {
        // simple umlaut mapping to keep engine consistent
        const mapped = ch === "Ä" ? "A" : ch === "Ö" ? "O" : ch === "Ü" ? "U" : ch;
        handleKey(mapped);
      }
    });
  }

  // ==============
  //  MODALS
  // ==============
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

    // click outside to close
    [helpModal, statsModal, settingsModal].forEach(m => {
      m.addEventListener("click", (e) => {
        const r = m.getBoundingClientRect();
        const inside = e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom;
        if (!inside) m.close();
      });
    });
  }

  // ==============
  //  STATS + SHARE
  // ==============
  function onGameEnd(won, attempt) {
    // Daily streak logic: increase only if daily and won today, reset if daily lost
    stats.played++;

    if (won) {
      stats.won++;
      stats.streak++;
      stats.bestStreak = Math.max(stats.bestStreak, stats.streak);
      if (attempt >= 1 && attempt <= 6) stats.dist[attempt - 1]++;

      saveStats(stats);
      return;
    }

    // loss
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
      const pct = Math.round((stats.dist[i] / max) * 100);
      fill.style.width = `${pct}%`;
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
      showToast("In Zwischenablage kopiert");
    } catch {
      showToast("Kopieren nicht möglich");
    }
  }

  // ==============
  //  NEW GAME / MODE
  // ==============
  function newDailyGameIfNeeded() {
    const key = `daily:${todayKey()}`;
    const loaded = loadGameState("daily");
    if (loaded) {
      state = loaded;
      return;
    }
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

  function startGame() {
    // daily by default
    newDailyGameIfNeeded();
    renderAll();
  }

  // ==============
  //  SETTINGS BINDINGS
  // ==============
  function bindSettings() {
    tgContrast.addEventListener("change", () => {
      settings.contrast = tgContrast.checked;
      setContrastUI(settings.contrast);
      saveSettings(settings);
    });

    tgReduceMotion.addEventListener("change", () => {
      settings.reduceMotion = tgReduceMotion.checked;
      saveSettings(settings);
      showToast(settings.reduceMotion ? "Reduce Motion: an" : "Reduce Motion: aus");
    });

    tgHardMode.addEventListener("change", () => {
      settings.hardMode = tgHardMode.checked;
      saveSettings(settings);
      showToast(settings.hardMode ? "Hard Mode: an" : "Hard Mode: aus");
    });

    btnResetStats.addEventListener("click", () => {
      stats = { played: 0, won: 0, streak: 0, bestStreak: 0, dist: [0,0,0,0,0,0] };
      saveStats(stats);
      renderStats();
      showToast("Stats gelöscht");
    });
  }

  // ==============
  //  INIT
  // ==============
  function init() {
    syncSettingsUI();
    buildGrid();
    buildKeyboard();
    bindPhysicalKeyboard();
    bindModals();
    bindSettings();

    btnNew.addEventListener("click", () => {
      // new random game (doesn't affect daily)
      newRandomGame();
      renderAll();
      showToast("Random Spiel gestartet");
    });

    btnShare.addEventListener("click", () => {
      if (state.status === "playing") {
        showToast("Erst Spiel beenden");
        animateRowShake(state.row);
        return;
      }
      shareResult();
    });

    // Load stats
    renderStats();

    // Start daily (load saved daily if exists)
    startGame();

    // If daily is already finished, reflect that and let user share
    if (state.status !== "playing") {
      const msg = state.status === "won" ? "Heute gelöst ✅" : "Heute verloren";
      showToast(msg, 1200);
    }
  }

  init();
})();



