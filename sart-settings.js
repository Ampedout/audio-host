(function () {
  // Bind once
  if (window.SART_UI_Begin) return;

  const $ = (id) => document.getElementById(id);
  const sleep = (ms) => new Promise(r => setTimeout(r, ms));

  const IS_IOS = /iPad|iPhone|iPod/.test(navigator.userAgent) && !window.MSStream;
  const HAS_WEBAUDIO = !!(window.AudioContext || window.webkitAudioContext);

  // =========================
  // ZAPIER (ONE CALL AT END)
  // =========================
  const ZAPIER_URL = "https://hooks.zapier.com/hooks/catch/25979880/uwv4hdq/";
  const SEND_GUARD_PREFIX = "SART_SENT_";

  function makeSessionId() {
    return "sart_" + Date.now() + "_" + Math.random().toString(16).slice(2);
  }

  function sendToZapierOnce(fields) {
    try {
      const sid = String(fields.session_id || "");
      if (!sid) return;

      const key = SEND_GUARD_PREFIX + sid;

      // prevent duplicates if user refreshes / double-triggers
      try {
        if (localStorage.getItem(key)) return;
      } catch (e) {}

      const body = new URLSearchParams();
      for (const k in fields) body.set(k, String(fields[k] ?? ""));

      const blob = new Blob([body.toString()], {
        type: "application/x-www-form-urlencoded;charset=utf-8"
      });

      const ok = navigator.sendBeacon(ZAPIER_URL, blob);
      if (ok) {
        try { localStorage.setItem(key, "1"); } catch (e) {}
      } else {
        console.warn("sendBeacon returned false");
      }
    } catch (e) {
      console.warn("Zapier send failed:", e);
    }
  }

  // =========================
  // UX: buffer after countdown
  // =========================
  const PRE_TEST_DELAY_MS = 1200; // set to 1500 if you want 1.5s

  function computeSummary(trials, responses, stimMs, blankMs) {
    const trialMs = stimMs + blankMs;

    const respondedByTrial = new Map();
    for (let i = 0; i < responses.length; i++) {
      const r = responses[i];
      if (!respondedByTrial.has(r.trialIndex)) respondedByTrial.set(r.trialIndex, r);
    }

    let hits = 0, misses = 0, falseAlarms = 0;
    let rtSum = 0, rtN = 0;

    for (let i = 0; i < trials.length; i++) {
      const v = trials[i];
      const isNoGo = (v === 3);
      const r = respondedByTrial.get(i);
      const responded = !!r;

      if (!isNoGo && responded) hits++;
      if (!isNoGo && !responded) misses++;
      if (isNoGo && responded) falseAlarms++;

      if (!isNoGo && responded) {
        const trialStart = i * trialMs;
        const rt = r.t_ms - trialStart;
        if (rt >= 0 && rt <= trialMs) {
          rtSum += rt;
          rtN += 1;
        }
      }
    }

    return {
      hits,
      misses,
      falseAlarms,
      avg_rt_ms: rtN ? Math.round(rtSum / rtN) : ""
    };
  }

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

  const messageWrap = $("sart_messageWrap");
  const messageTitle = $("sart_messageTitle");
  const messageBody = $("sart_messageBody");
  const nextBtn = $("sart_nextBtn");

  // Safety check
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
    session_id: makeSessionId(),

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

    allTrials: [null, null, null, null],
    allResponses: [null, null, null, null]
  };

  function randInt(min, max) {
    return Math.floor(Math.random() * (max - min + 1)) + min;
  }

  function pickNon3Digit() {
    const non3 = [1,2,4,5,6,7,8,9];
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

  function attachSpaceCapture() {
    function onKeyDown(e) {
      if (e.code !== "Space") return;

      const el = e.target;
      const isTyping = el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.isContentEditable);
      if (!isTyping) e.preventDefault();

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

    window.addEventListener("keydown", onKeyDown, { passive: false });
    state.keyHandler = onKeyDown;
  }

  function detachSpaceCapture() {
    if (state.keyHandler) {
      window.removeEventListener("keydown", state.keyHandler, { passive: false });
      state.keyHandler = null;
    }
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

  // ---------- Desktop / non-iOS: HTMLAudio ----------
  let audioToken = 0;
  const players = new Map();

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
    for (const [, a] of players.entries()) {
      const cur = a.volume || 0;
      if (a.paused || cur <= 0.001) {
        try { a.pause(); } catch {}
        try { a.currentTime = 0; } catch {}
        a.volume = 0;
        continue;
      }
      rampVolume(a, cur, 0, FADE_OUT_MS, () => {
        try { a.pause(); } catch {}
        try { a.currentTime = 0; } catch {}
        a.volume = 0;
      });
    }
  }

  function desktopStartSilent(key, url) {
    const a = getPlayer(key);
    if (a.src !== url) {
      try { a.pause(); } catch {}
      try { a.currentTime = 0; } catch {}
      a.src = url;
      try { a.load(); } catch {}
    }
    a.volume = 0;
    a.muted = false;
    try {
      const p = a.play();
      if (p && typeof p.catch === "function") p.catch(() => {});
    } catch {}
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
      } catch {}

      const cur = a.volume || 0;
      rampVolume(a, cur, targetVol, FADE_IN_MS);
    }, delayMs);
  }

  // ---------- iPhone: WebAudio buffer engine ----------
  const IOS = {
    ctx: null,
    master: null,
    buffers: new Map(),
    active: new Map()
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
    } catch {
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

    for (const [, obj] of IOS.active.entries()) {
      try {
        const t0 = IOS.ctx.currentTime;
        const t1 = t0 + (FADE_OUT_MS / 1000);

        obj.gain.gain.cancelScheduledValues(t0);
        obj.gain.gain.setValueAtTime(obj.gain.gain.value, t0);
        obj.gain.gain.linearRampToValueAtTime(0, t1);
      } catch {}

      setTimeout(() => {
        try { obj.src.stop(0); } catch {}
        try { obj.src.disconnect(); } catch {}
        try { obj.gain.disconnect(); } catch {}
      }, FADE_OUT_MS + 80);
    }
    IOS.active.clear();
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
      try { existing.src.stop(0); } catch {}
      try { existing.src.disconnect(); } catch {}
      try { existing.gain.disconnect(); } catch {}
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
      try { src.start(0); } catch {}
      try {
        const t0 = IOS.ctx.currentTime;
        gain.gain.setValueAtTime(0, t0);
        gain.gain.linearRampToValueAtTime(targetVol, t0 + (FADE_IN_MS / 1000));
      } catch {}
    }
  }

  async function startAudioForCurrentTest() {
    const testNum = state.testIndex + 1;
    const baseUrl = TEST_AUDIO_MAP[testNum];

    // Stop previous test audio (fade out)
    if (IS_IOS && HAS_WEBAUDIO && IOS.ctx) {
      iosFadeOutAndStopAll();
    } else {
      desktopStopAll();
    }

    if (!baseUrl) return;

    const baseDelay = (BASE_DELAY_BY_TEST[testNum] != null)
      ? BASE_DELAY_BY_TEST[testNum]
      : DEFAULT_BASE_DELAY_MS;

    // iPhone: WebAudio scheduling
    if (IS_IOS && HAS_WEBAUDIO && ensureIOSCtx_SYNC()) {
      iosStartTrack("base", baseUrl, baseDelay, BASE_VOL);

      if (testNum === 4) {
        for (const layer of TEST4_LAYERS) {
          iosStartTrack(layer.key, layer.url, layer.delayMs, layer.vol);
        }
      }
      return;
    }

    // Desktop behavior
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

    // ✅ NEW: give the participant a beat before the first number appears
    await sleep(PRE_TEST_DELAY_MS);

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
    display.style.display = "none";
    state.isRunning = false;
    showRunning(false);

    // Fade out test audio when finished
    if (IS_IOS && HAS_WEBAUDIO && IOS.ctx) {
      iosFadeOutAndStopAll();
    } else {
      desktopStopAll();
    }

    // store this test’s raw
    state.allTrials[state.testIndex] = state.trials.slice();
    state.allResponses[state.testIndex] = state.responses.slice();

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
      // FINAL: compute + send ONE Zap
      const timestamp = new Date().toISOString();

      const s1 = computeSummary(state.allTrials[0] || [], state.allResponses[0] || [], STIM_MS, BLANK_MS);
      const s2 = computeSummary(state.allTrials[1] || [], state.allResponses[1] || [], STIM_MS, BLANK_MS);
      const s3 = computeSummary(state.allTrials[2] || [], state.allResponses[2] || [], STIM_MS, BLANK_MS);
      const s4 = computeSummary(state.allTrials[3] || [], state.allResponses[3] || [], STIM_MS, BLANK_MS);

      const rawObj = {
        timestamp: timestamp,
        subject_name: state.subject,
        session_id: state.session_id,
        tests: [
          { testIndex: 1, trials: state.allTrials[0] || [], responses: state.allResponses[0] || [] },
          { testIndex: 2, trials: state.allTrials[1] || [], responses: state.allResponses[1] || [] },
          { testIndex: 3, trials: state.allTrials[2] || [], responses: state.allResponses[2] || [] },
          { testIndex: 4, trials: state.allTrials[3] || [], responses: state.allResponses[3] || [] }
        ]
      };

      sendToZapierOnce({
        timestamp: timestamp,
        subject_name: state.subject,
        session_id: state.session_id,

        t1_hits: s1.hits,
        t1_misses: s1.misses,
        t1_false_alarms: s1.falseAlarms,
        t1_avg_rt_ms: s1.avg_rt_ms,

        t2_hits: s2.hits,
        t2_misses: s2.misses,
        t2_false_alarms: s2.falseAlarms,
        t2_avg_rt_ms: s2.avg_rt_ms,

        t3_hits: s3.hits,
        t3_misses: s3.misses,
        t3_false_alarms: s3.falseAlarms,
        t3_avg_rt_ms: s3.avg_rt_ms,

        t4_hits: s4.hits,
        t4_misses: s4.misses,
        t4_false_alarms: s4.falseAlarms,
        t4_avg_rt_ms: s4.avg_rt_ms,

        raw_json: JSON.stringify(rawObj)
      });

      messageTitle.textContent = "";
      messageBody.textContent =
        "Congratulations! You have completed all the tests!\n\nThank you for your participation";
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

    // new session per successful Begin
    state.session_id = makeSessionId();
    state.testIndex = 0;
    state.allTrials = [null, null, null, null];
    state.allResponses = [null, null, null, null];

    nameBlock.style.display = "none";
    instructionsBlock.style.display = "block";

    countdownWrap.style.display = "none";
    display.style.display = "none";
    messageWrap.style.display = "none";
    showRunning(false);
  };

  window.SART_UI_StartTest1 = async function () {
    if (state.isRunning) return;

    // Fade out welcome audio when starting Test 1 (your existing welcome script)
    window.SART_FadeOutWelcome && window.SART_FadeOutWelcome(4000);

    // Start test audio (this is where iPhone WebAudio is resumed via user gesture)
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
