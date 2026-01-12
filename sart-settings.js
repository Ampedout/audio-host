<script>
(function () {
  // Bind once
  if (window.SART_UI_Begin) return;

  const $ = (id) => document.getElementById(id);
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  const IS_IOS = /iPad|iPhone|iPod/.test(navigator.userAgent) && !window.MSStream;
  const HAS_WEBAUDIO = !!(window.AudioContext || window.webkitAudioContext);

  // Elements
  const nameBlock = $("sart_nameBlock");
  const nameInput = $("sart_nameInput");
  const warn = $("sart_warn");

  const instructionsBlock = $("sart_instructionsBlock");
  const runningEl = $("sart_running");

  const countdownWrap = $("sart_countdownWrap");
  const countdownText = $("sart_countdownText");
  const barInner = $("sart_barInner");

  const display = $("sart_display");
  const stimEl = $("sart_stim");

  // Optional stage element (if you have it in your test block)
  const stageEl = $("sart_stage");

  const messageWrap = $("sart_messageWrap");
  const messageTitle = $("sart_messageTitle");
  const messageBody = $("sart_messageBody");
  const nextBtn = $("sart_nextBtn");

  // Safety check (stageEl is OPTIONAL)
  const required = [
    nameBlock, nameInput, warn,
    instructionsBlock,
    countdownWrap, countdownText, barInner,
    display, stimEl,
    messageWrap, messageTitle, messageBody, nextBtn
  ];
  if (required.some(x => !x)) {
    console.warn("SART: Missing required elements. Check IDs in your 'SART Test Block' embed.");
    return;
  }

  function showRunning(on) {
    if (!runningEl) return;
    runningEl.style.display = on ? "block" : "none";
  }

  // ===== Timing =====
  const STIM_MS = 300;
  const BLANK_MS = 1000;
  const DURATION_MS = 60_000;
  const COUNTDOWN_SEC = 5;

  const TARGET_MIN = 4;
  const TARGET_MAX = 7;

  const state = {
    subject: "",
    testIndex: 0, // 0..3
    isRunning: false,

    trialActive: false,
    respondedThisTrial: false,
    trialIndex: -1,
    currentValue: null,

    testStartPerf: 0,
    responses: [],
    trials: [],

    keyHandler: null,
    tapHandler: null
  };

  function randInt(min, max) {
    return Math.floor(Math.random() * (max - min + 1)) + min;
  }

  function pickNon3Digit() {
    const non3 = [1, 2, 4, 5, 6, 7, 8, 9];
    return non3[Math.floor(Math.random() * non3.length)];
  }

  function shuffleInPlace(a) {
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }

  function buildTrials(totalTrials, targetCount) {
    const trials = [];
    for (let i = 0; i < targetCount; i++) trials.push(3);
    for (let i = targetCount; i < totalTrials; i++) trials.push(pickNon3Digit());

    for (let attempt = 0; attempt < 200; attempt++) {
      shuffleInPlace(trials);
      let ok = true;
      for (let i = 1; i < trials.length; i++) {
        if (trials[i] === 3 && trials[i - 1] === 3) { ok = false; break; }
      }
      if (ok) return trials;
    }
    return trials;
  }

  // Single place to record a response (SPACE + TAP both call this)
  function registerResponse() {
    if (state.isRunning && state.trialActive && !state.respondedThisTrial) {
      state.respondedThisTrial = true;
      state.responses.push({
        t_ms: Math.round(performance.now() - state.testStartPerf),
        testIndex: state.testIndex + 1,
        trialIndex: state.trialIndex,
        value: state.currentValue
      });
    }
  }

  // -------- SPACE (keyboard) --------
  function attachSpaceCapture() {
    function onKeyDown(e) {
      if (e.code !== "Space") return;

      const el = e.target;
      const isTyping = el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.isContentEditable);
      if (!isTyping) e.preventDefault();

      registerResponse();
    }

    window.addEventListener("keydown", onKeyDown, { passive: false });
    state.keyHandler = onKeyDown;
  }

  function detachSpaceCapture() {
    if (state.keyHandler) {
      window.removeEventListener("keydown", state.keyHandler, { passive: false });
      state.keyHandler = null;
    }
  }

  // -------- TAP (touch/mouse) --------
  // We attach to stageEl if present, otherwise display, and also a document-level fallback.
  // Only active while test is running, so it won't break buttons/screens.
  function attachTapCapture() {
    const targetEl = stageEl || display;

    // Make taps feel responsive on mobile
    try {
      targetEl.style.touchAction = "manipulation";
      targetEl.style.userSelect = "none";
      targetEl.style.webkitUserSelect = "none";
    } catch (e) {}

    function onPointerDown(e) {
      // Only capture during active test
      if (!state.isRunning) return;

      // If tap happened inside the test area, record it.
      // This avoids catching taps on other page UI if any.
      const inTestArea =
        (targetEl && targetEl.contains(e.target)) ||
        (display && display.contains(e.target)) ||
        (stageEl && stageEl.contains(e.target));

      if (!inTestArea) return;

      // Prevent iOS double-tap zoom / text selection while test is active
      e.preventDefault();

      registerResponse();
    }

    // Attach to primary target
    targetEl.addEventListener("pointerdown", onPointerDown, { passive: false });

    // Document fallback (some Carrd layers/overlays can intercept taps)
    // Capture phase helps if overlays sit above the test element.
    document.addEventListener("pointerdown", onPointerDown, { passive: false, capture: true });

    state.tapHandler = onPointerDown;
  }

  function detachTapCapture() {
    if (!state.tapHandler) return;

    const targetEl = stageEl || display;
    try { targetEl.removeEventListener("pointerdown", state.tapHandler, { passive: false }); } catch (e) {}
    try { document.removeEventListener("pointerdown", state.tapHandler, { passive: false, capture: true }); } catch (e) {}

    state.tapHandler = null;
  }

  async function runCountdown() {
    messageWrap.style.display = "none";
    display.style.display = "none";
    showRunning(false);

    countdownWrap.style.display = "block";

    const total = COUNTDOWN_SEC * 1000;
    const start = performance.now();

    while (true) {
      const remaining = Math.max(0, total - (performance.now() - start));
      const secsLeft = Math.max(1, Math.ceil(remaining / 1000));
      countdownText.textContent = `Starting in.. ${secsLeft}`;
      barInner.style.width = (100 * (remaining / total)).toFixed(2) + "%";
      if (remaining <= 0) break;
      await sleep(50);
    }

    countdownWrap.style.display = "none";
  }

  // ======================================================
  // ✅ TEST AUDIO (PC: HTMLAudio, iPhone: WebAudio buffers)
  // ======================================================

  const TEST_AUDIO_MAP = {
    1: null,
    2: "https://ampedout.github.io/audio-host/Brown.mp3",
    3: "https://ampedout.github.io/audio-host/Classical.mp3",
    4: "https://ampedout.github.io/audio-host/Metal2.mp3"
  };

  const DEFAULT_BASE_DELAY_MS = 4000;
  const BASE_DELAY_BY_TEST = { 3: 3000 };

  const FADE_IN_MS = 5000;
  const FADE_OUT_MS = 800;

  const BASE_VOL = 0.22;

  const TEST4_LAYERS = [
    { key: "construction", url: "https://ampedout.github.io/audio-host/Construction.mp3", delayMs: 8000, vol: 0.34 },
    { key: "crying", url: "https://ampedout.github.io/audio-host/Crying.mp3", delayMs: 10000, vol: 0.30 }
  ];

  let audioToken = 0;
  const players = new Map(); // key -> HTMLAudioElement

  function getPlayer(key) {
    let a = players.get(key);
    if (a) return a;

    a = new Audio();
    a.loop = true;
    a.preload = "auto";
    a.playsInline = true;
    a.muted = false;
    a.volume = 0;

    players.set(key, a);
    return a;
  }

  function rampVolume(a, from, to, ms, onDone) {
    const start = performance.now();
    function step() {
      const p = Math.min(1, (performance.now() - start) / ms);
      a.volume = from + (to - from) * p;
      if (p < 1) requestAnimationFrame(step);
      else {
        a.volume = to;
        onDone && onDone();
      }
    }
    requestAnimationFrame(step);
  }

  function desktopStopAll() {
    audioToken++;
    for (const [key, a] of players.entries()) {
      const cur = a.volume || 0;
      if (a.paused || cur <= 0.001) {
        try { a.pause(); } catch (e) {}
        try { a.currentTime = 0; } catch (e) {}
        a.volume = 0;
        continue;
      }
      rampVolume(a, cur, 0, FADE_OUT_MS, () => {
        try { a.pause(); } catch (e) {}
        try { a.currentTime = 0; } catch (e) {}
        a.volume = 0;
      });
    }
  }

  function desktopStartSilent(key, url) {
    const a = getPlayer(key);
    if (a.src !== url) {
      try { a.pause(); } catch (e) {}
      try { a.currentTime = 0; } catch (e) {}
      a.src = url;
      try { a.load(); } catch (e) {}
    }
    a.volume = 0;
    a.muted = false;
    try {
      const p = a.play();
      if (p && typeof p.catch === "function") p.catch(() => {});
    } catch (e) {}
    return a;
  }

  function desktopScheduleFadeIn(key, delayMs, targetVol) {
    const myToken = audioToken;
    const a = getPlayer(key);

    setTimeout(() => {
      if (myToken !== audioToken) return;
      try {
        if (a.paused) {
          const p = a.play();
          if (p && typeof p.catch === "function") p.catch(() => {});
        }
      } catch (e) {}

      const cur = a.volume || 0;
      rampVolume(a, cur, targetVol, FADE_IN_MS);
    }, delayMs);
  }

  const IOS = {
    ctx: null,
    master: null,
    buffers: new Map(), // url -> AudioBuffer
    active: new Map() // key -> { src, gain }
  };

  function ensureIOSCtx_SYNC() {
    if (!IS_IOS || !HAS_WEBAUDIO) return false;
    try {
      if (!IOS.ctx) {
        const AC = window.AudioContext || window.webkitAudioContext;
        IOS.ctx = new AC();
      }
      if (IOS.ctx.state === "suspended") {
        IOS.ctx.resume().catch(() => {});
      }
      if (!IOS.master) {
        IOS.master = IOS.ctx.createGain();
        IOS.master.gain.value = 1;
        IOS.master.connect(IOS.ctx.destination);
      }
      return true;
    } catch (e) {
      return false;
    }
  }

  async function loadIOSBuffer(url) {
    if (IOS.buffers.has(url)) return IOS.buffers.get(url);

    const res = await fetch(url, { cache: "force-cache" });
    if (!res.ok) throw new Error("fetch failed: " + res.status);

    const arr = await res.arrayBuffer();
    const buf = await new Promise((resolve, reject) => {
      try {
        const p = IOS.ctx.decodeAudioData(arr, resolve, reject);
        if (p && typeof p.then === "function") p.then(resolve).catch(reject);
      } catch (e) { reject(e); }
    });

    IOS.buffers.set(url, buf);
    return buf;
  }

  function iosFadeOutAndStopAll() {
    audioToken++;
    if (!IOS.ctx) return;

    for (const [key, obj] of IOS.active.entries()) {
      try {
        const t0 = IOS.ctx.currentTime;
        const t1 = t0 + (FADE_OUT_MS / 1000);

        obj.gain.gain.cancelScheduledValues(t0);
        obj.gain.gain.setValueAtTime(obj.gain.gain.value, t0);
        obj.gain.gain.linearRampToValueAtTime(0, t1);
      } catch (e) {}

      setTimeout(() => {
        try { obj.src.stop(0); } catch (e) {}
        try { obj.src.disconnect(); } catch (e) {}
        try { obj.gain.disconnect(); } catch (e) {}
        IOS.active.delete(key);
      }, FADE_OUT_MS + 80);
    }
  }

  async function iosStartTrack(key, url, delayMs, targetVol) {
    const myToken = audioToken;

    let buf;
    try {
      buf = await loadIOSBuffer(url);
    } catch (e) {
      console.warn("iOS decode failed for:", url, e);
      return;
    }
    if (myToken !== audioToken) return;

    const existing = IOS.active.get(key);
    if (existing) {
      try { existing.src.stop(0); } catch (e) {}
      try { existing.src.disconnect(); } catch (e) {}
      try { existing.gain.disconnect(); } catch (e) {}
      IOS.active.delete(key);
    }

    const gain = IOS.ctx.createGain();
    gain.gain.value = 0;
    gain.connect(IOS.master);

    const src = IOS.ctx.createBufferSource();
    src.buffer = buf;
    src.loop = true;
    src.connect(gain);

    IOS.active.set(key, { src, gain });

    const startAt = IOS.ctx.currentTime + (delayMs / 1000);
    const fadeEnd = startAt + (FADE_IN_MS / 1000);

    try {
      gain.gain.setValueAtTime(0, startAt);
      gain.gain.linearRampToValueAtTime(targetVol, fadeEnd);
      src.start(startAt);
    } catch (e) {
      try { src.start(0); } catch (_) {}
      try {
        const t0 = IOS.ctx.currentTime;
        gain.gain.setValueAtTime(0, t0);
        gain.gain.linearRampToValueAtTime(targetVol, t0 + (FADE_IN_MS / 1000));
      } catch (_) {}
    }
  }

  async function startAudioForCurrentTest() {
    const testNum = state.testIndex + 1;
    const baseUrl = TEST_AUDIO_MAP[testNum];

    if (IS_IOS && HAS_WEBAUDIO && IOS.ctx) {
      iosFadeOutAndStopAll();
    } else {
      desktopStopAll();
    }

    if (!baseUrl) return;

    const baseDelay = (BASE_DELAY_BY_TEST[testNum] != null)
      ? BASE_DELAY_BY_TEST[testNum]
      : DEFAULT_BASE_DELAY_MS;

    if (IS_IOS && HAS_WEBAUDIO && ensureIOSCtx_SYNC()) {
      iosStartTrack("base", baseUrl, baseDelay, BASE_VOL);
      if (testNum === 4) {
        for (const layer of TEST4_LAYERS) {
          iosStartTrack(layer.key, layer.url, layer.delayMs, layer.vol);
        }
      }
      return;
    }

    desktopStartSilent("base", baseUrl);
    desktopScheduleFadeIn("base", baseDelay, BASE_VOL);

    if (testNum === 4) {
      for (const layer of TEST4_LAYERS) {
        desktopStartSilent(layer.key, layer.url);
        desktopScheduleFadeIn(layer.key, layer.delayMs, layer.vol);
      }
    }
  }

  // ======================================================

  async function runTest() {
    state.isRunning = true;
    showRunning(true);

    state.responses = [];
    state.trialIndex = -1;

    const totalTrials = Math.floor(DURATION_MS / (STIM_MS + BLANK_MS));
    const targetCount = randInt(TARGET_MIN, TARGET_MAX);
    state.trials = buildTrials(totalTrials, targetCount);

    display.style.display = "block";
    attachSpaceCapture();
    attachTapCapture(); // ✅ TAP enabled
    state.testStartPerf = performance.now();

    for (let i = 0; i < state.trials.length; i++) {
      state.trialIndex = i;
      state.currentValue = state.trials[i];

      state.trialActive = true;
      state.respondedThisTrial = false;

      stimEl.textContent = String(state.currentValue);
      stimEl.style.display = "block";
      await sleep(STIM_MS);

      stimEl.style.display = "none";
      await sleep(BLANK_MS);

      state.trialActive = false;
    }

    detachSpaceCapture();
    detachTapCapture(); // ✅ TAP cleanup
    display.style.display = "none";
    state.isRunning = false;
    showRunning(false);

    if (IS_IOS && HAS_WEBAUDIO && IOS.ctx) {
      iosFadeOutAndStopAll();
    } else {
      desktopStopAll();
    }

    showCompletion();
  }

  function showCompletion() {
    messageWrap.style.display = "block";

    const isLast = (state.testIndex === 3);

    if (!isLast) {
      messageTitle.textContent = `Test ${state.testIndex + 1} Completed!`;
      messageBody.textContent = "";
      nextBtn.textContent = `Begin Test ${state.testIndex + 2}`;
      nextBtn.style.display = "inline-flex";
    } else {
      messageTitle.textContent = "";
      messageBody.textContent = "Congratulations! You have completed all the tests!\n\nThank you for your participation";
      nextBtn.style.display = "none";
    }
  }

  // ===== UI ACTIONS =====

  window.SART_UI_Begin = function () {
    warn.textContent = "";
    const name = (nameInput.value || "").trim();
    if (!name) {
      warn.textContent = "Please enter your name to continue.";
      nameInput.focus();
      return;
    }
    state.subject = name;

    nameBlock.style.display = "none";
    instructionsBlock.style.display = "block";

    countdownWrap.style.display = "none";
    display.style.display = "none";
    messageWrap.style.display = "none";
    showRunning(false);
  };

  window.SART_UI_StartTest1 = async function () {
    if (state.isRunning) return;

    // Fade out welcome audio when starting Test 1
    window.SART_FadeOutWelcome && window.SART_FadeOutWelcome(4000);

    startAudioForCurrentTest();

    instructionsBlock.style.display = "none";
    nextBtn.style.display = "none";

    await runCountdown();
    await runTest();
  };

  window.SART_UI_Next = async function () {
    if (state.isRunning) return;

    state.testIndex += 1;
    nextBtn.style.display = "none";

    startAudioForCurrentTest();

    await runCountdown();
    await runTest();
  };
})();
</script>
