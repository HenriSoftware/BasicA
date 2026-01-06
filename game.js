(() => {
  const $ = (id) => document.getElementById(id);

  const canvas = $("gameCanvas");
  const ctx = canvas.getContext("2d");

  const scoreText = $("scoreText");
  const hsText = $("hsText");
  const highscoreText = $("highscoreText");
  const speedText = $("speedText");
  const statusText = $("statusText");

  const btnStart = $("btnStart");
  const btnPause = $("btnPause");
  const btnReset = $("btnReset");
  const btnScrollGame = $("btnScrollGame");
  const btnToggleReduceMotion = $("btnToggleReduceMotion");

  $("year").textContent = new Date().getFullYear();

  // Preferences
  const PREF_KEY = "neon_dodger_pref_reduce_motion";
  let reduceMotion = localStorage.getItem(PREF_KEY) === "1";

  function setReduceMotion(v){
    reduceMotion = v;
    localStorage.setItem(PREF_KEY, v ? "1" : "0");
    statusText.textContent = reduceMotion ? "Ready (reduce motion)" : "Ready";
  }

  btnToggleReduceMotion.addEventListener("click", () => setReduceMotion(!reduceMotion));
  setReduceMotion(reduceMotion);

  btnScrollGame.addEventListener("click", () => {
    $("game").scrollIntoView({ behavior: reduceMotion ? "auto" : "smooth" });
  });

  // Highscore
  const HS_KEY = "neon_dodger_highscore";
  let highscore = Number(localStorage.getItem(HS_KEY) || "0");
  hsText.textContent = String(highscore);
  highscoreText.textContent = String(highscore);

  // Game state
  const state = {
    running: false,
    paused: false,
    over: false,
    t: 0,
    score: 0,
    speed: 1.0,
    lastTs: 0,
  };

  const player = {
    w: 44,
    h: 14,
    x: 0,
    y: 0,
    vx: 0,
    maxV: 540, // px/s
  };

  const blocks = [];
  const rng = (min, max) => Math.random() * (max - min) + min;

  function resizeCanvasForHiDPI() {
    const cssW = canvas.clientWidth;
    const cssH = canvas.clientHeight;

    // Keep aspect ratio similar to initial 720x420
    const targetH = Math.min(cssH || 420, 420);
    const targetW = cssW || 720;

    const dpr = Math.max(1, Math.min(2, window.devicePixelRatio || 1));
    canvas.width = Math.floor(targetW * dpr);
    canvas.height = Math.floor(targetH * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    // logical size
    canvas._w = targetW;
    canvas._h = targetH;

    player.y = canvas._h - 34;
    player.x = canvas._w / 2 - player.w / 2;
  }

  window.addEventListener("resize", () => {
    resizeCanvasForHiDPI();
    draw();
  });

  resizeCanvasForHiDPI();

  function reset() {
    state.running = false;
    state.paused = false;
    state.over = false;
    state.t = 0;
    state.score = 0;
    state.speed = 1.0;
    state.lastTs = 0;
    blocks.length = 0;

    player.vx = 0;
    player.y = canvas._h - 34;
    player.x = canvas._w / 2 - player.w / 2;

    scoreText.textContent = "0";
    speedText.textContent = "1.0×";
    statusText.textContent = reduceMotion ? "Ready (reduce motion)" : "Ready";
    draw();
  }

  function start() {
    if (state.running && state.over) reset();
    state.running = true;
    state.paused = false;
    state.over = false;
    statusText.textContent = "Running";
    requestAnimationFrame(loop);
  }

  function pauseToggle() {
    if (!state.running) return;
    state.paused = !state.paused;
    statusText.textContent = state.paused ? "Paused" : "Running";
    if (!state.paused) requestAnimationFrame(loop);
  }

  function gameOver() {
    state.over = true;
    state.running = true; // still running, but ended
    statusText.textContent = "Game Over — Start to retry";

    if (state.score > highscore) {
      highscore = state.score;
      localStorage.setItem(HS_KEY, String(highscore));
      hsText.textContent = String(highscore);
      highscoreText.textContent = String(highscore);
    }
    draw();
  }

  // Controls (keyboard)
  const keys = new Set();
  window.addEventListener("keydown", (e) => {
    const k = e.key.toLowerCase();
    if (["arrowleft","arrowright","a","d"," "].includes(k)) e.preventDefault();
    keys.add(k);

    if (k === " ") pauseToggle();
  });
  window.addEventListener("keyup", (e) => keys.delete(e.key.toLowerCase()));

  // Touch controls (tap left/right or drag)
  let touchActive = false;
  let touchLastX = 0;

  canvas.addEventListener("pointerdown", (e) => {
    canvas.setPointerCapture(e.pointerId);
    touchActive = true;
    touchLastX = e.offsetX;
    // Tap left/right
    if (e.pointerType !== "mouse") {
      const mid = canvas.clientWidth / 2;
      const dir = e.offsetX < mid ? -1 : 1;
      player.vx = dir * player.maxV;
    }
  });

  canvas.addEventListener("pointermove", (e) => {
    if (!touchActive) return;
    const dx = e.offsetX - touchLastX;
    touchLastX = e.offsetX;
    // convert small drags to velocity
    player.vx = Math.max(-player.maxV, Math.min(player.maxV, dx * 40));
  });

  canvas.addEventListener("pointerup", () => {
    touchActive = false;
    player.vx = 0;
  });

  function spawnBlock() {
    const w = rng(18, 60);
    const h = rng(14, 28);
    blocks.push({
      x: rng(0, canvas._w - w),
      y: -h - 5,
      w, h,
      vy: rng(140, 260) * state.speed
    });
  }

  function update(dt) {
    state.t += dt;

    // Difficulty over time
    state.speed = 1 + Math.min(2.5, state.t / 28);
    speedText.textContent = state.speed.toFixed(1) + "×";

    // Score
    state.score += Math.floor(dt * 100);
    scoreText.textContent = String(state.score);

    // Input → velocity
    const left = keys.has("arrowleft") || keys.has("a");
    const right = keys.has("arrowright") || keys.has("d");
    if (!touchActive) {
      if (left && !right) player.vx = -player.maxV;
      else if (right && !left) player.vx = player.maxV;
      else player.vx = 0;
    }

    // Move player
    player.x += player.vx * dt;
    player.x = Math.max(6, Math.min(canvas._w - player.w - 6, player.x));

    // Spawn rate
    const spawnChance = dt * (1.2 + state.speed * 0.9);
    if (Math.random() < spawnChance) spawnBlock();

    // Move blocks
    for (let i = blocks.length - 1; i >= 0; i--) {
      const b = blocks[i];
      b.vy = (b.vy * 0.985) + (180 * state.speed * 0.015); // smooth increase
      b.y += b.vy * dt;
      if (b.y > canvas._h + 60) blocks.splice(i, 1);
    }

    // Collision
    const px = player.x, py = player.y, pw = player.w, ph = player.h;
    for (const b of blocks) {
      if (px < b.x + b.w && px + pw > b.x && py < b.y + b.h && py + ph > b.y) {
        gameOver();
        break;
      }
    }
  }

  function drawBackground() {
    const w = canvas._w, h = canvas._h;

    // base
    ctx.clearRect(0, 0, w, h);

    // subtle grid
    ctx.globalAlpha = 0.10;
    ctx.lineWidth = 1;
    ctx.beginPath();
    const step = 28;
    for (let x = 0; x <= w; x += step) {
      ctx.moveTo(x, 0);
      ctx.lineTo(x, h);
    }
    for (let y = 0; y <= h; y += step) {
      ctx.moveTo(0, y);
      ctx.lineTo(w, y);
    }
    ctx.strokeStyle = "#e7eefc";
    ctx.stroke();
    ctx.globalAlpha = 1;

    // vignette
    const g = ctx.createRadialGradient(w * 0.5, h * 0.6, 50, w * 0.5, h * 0.6, Math.max(w,h));
    g.addColorStop(0, "rgba(0,0,0,0)");
    g.addColorStop(1, "rgba(0,0,0,0.55)");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
  }

  function drawPlayer() {
    // neon glow
    ctx.save();
    ctx.shadowBlur = 18;
    ctx.shadowColor = "rgba(124,247,212,0.85)";
    ctx.fillStyle = "rgba(124,247,212,0.95)";
    ctx.fillRect(player.x, player.y, player.w, player.h);

    // inner highlight
    ctx.shadowBlur = 0;
    ctx.fillStyle = "rgba(255,255,255,0.15)";
    ctx.fillRect(player.x + 4, player.y + 3, player.w - 8, 3);
    ctx.restore();
  }

  function drawBlocks() {
    for (const b of blocks) {
      ctx.save();
      ctx.shadowBlur = 16;
      ctx.shadowColor = "rgba(110,168,254,0.75)";
      ctx.fillStyle = "rgba(110,168,254,0.9)";
      ctx.fillRect(b.x, b.y, b.w, b.h);

      ctx.shadowBlur = 0;
      ctx.fillStyle = "rgba(0,0,0,0.18)";
      ctx.fillRect(b.x, b.y + b.h - 4, b.w, 4);
      ctx.restore();
    }
  }

  function drawOverlayText() {
    if (!state.running) {
      drawCenterText("Start drücken", "oder Enter im Kopf: einfach klicken");
      return;
    }
    if (state.paused) {
      drawCenterText("PAUSE", "Leertaste oder Pause-Button");
      return;
    }
    if (state.over) {
      drawCenterText("GAME OVER", "Start = Retry • Reset = Neustart");
      return;
    }
  }

  function drawCenterText(head, sub) {
    const w = canvas._w, h = canvas._h;
    ctx.save();
    ctx.fillStyle = "rgba(0,0,0,0.55)";
    ctx.fillRect(0, 0, w, h);

    ctx.textAlign = "center";
    ctx.fillStyle = "rgba(231,238,252,0.95)";
    ctx.font = "700 28px system-ui, -apple-system, Segoe UI, Roboto, Arial";
    ctx.fillText(head, w / 2, h / 2 - 8);

    ctx.fillStyle = "rgba(169,182,211,0.95)";
    ctx.font = "500 14px system-ui, -apple-system, Segoe UI, Roboto, Arial";
    ctx.fillText(sub, w / 2, h / 2 + 18);
    ctx.restore();
  }

  function draw() {
    drawBackground();
    drawBlocks();
    drawPlayer();
    drawOverlayText();
  }

  function loop(ts) {
    if (!state.running || state.paused) return;

    if (!state.lastTs) state.lastTs = ts;
    const rawDt = (ts - state.lastTs) / 1000;
    state.lastTs = ts;

    // clamp dt
    const dt = Math.max(0, Math.min(0.033, rawDt));

    if (!state.over) update(dt);
    draw();

    if (!state.over) requestAnimationFrame(loop);
  }

  // Buttons
  btnStart.addEventListener("click", () => start());
  btnPause.addEventListener("click", () => pauseToggle());
  btnReset.addEventListener("click", () => reset());

  // Start with a clean frame
  reset();
})();
