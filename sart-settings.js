(function () {
  if (window.SART_UI_Begin) return;

  const $ = (id) => document.getElementById(id);
  const sleep = (ms) => new Promise(r => setTimeout(r, ms));

  // ------------------
  // CONFIG
  // ------------------
  const PRE_TEST_DELAY_MS = 1200; // ← NEW buffer before first stimulus

  const STIM_MS = 300;
  const BLANK_MS = 1000;
  const DURATION_MS = 60_000;
  const COUNTDOWN_SEC = 5;

  const TARGET_MIN = 4;
  const TARGET_MAX = 7;

  // ------------------
  // ZAPIER
  // ------------------
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
      try { if (localStorage.getItem(key)) return; } catch {}

      const body = new URLSearchParams();
      for (const k in fields) body.set(k, String(fields[k] ?? ""));

      const blob = new Blob([body.toString()], {
        type: "application/x-www-form-urlencoded;charset=utf-8"
      });

      if (navigator.sendBeacon(ZAPIER_URL, blob)) {
        try { localStorage.setItem(key, "1"); } catch {}
      }
    } catch (e) {
      console.warn("Zapier send failed:", e);
    }
  }

  // ------------------
  // ELEMENTS
  // ------------------
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

  const required = [
    nameBlock, nameInput, warn,
    instructionsBlock,
    countdownWrap, countdownText, barInner,
    display, stimEl,
    messageWrap, messageTitle, messageBody, nextBtn
  ];
  if (required.some(x => !x)) return;

  function showRunning(on) {
    if (runningEl) runningEl.style.display = on ? "block" : "none";
  }

  // ------------------
  // STATE
  // ------------------
  const state = {
    subject: "",
    session_id: makeSessionId(),
    testIndex: 0,
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
    return [1,2,4,5,6,7,8,9][Math.floor(Math.random() * 8)];
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
      if (!trials.some((v, i) => v === 3 && trials[i - 1] === 3)) return trials;
    }
    return trials;
  }

  function attachSpaceCapture() {
    function onKeyDown(e) {
      if (e.code !== "Space") return;
      const el = e.target;
      if (!(el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA"))) e.preventDefault();

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
      countdownText.textContent = `Starting in.. ${Math.max(1, Math.ceil(remaining / 1000))}`;
      barInner.style.width = (100 * remaining / total).toFixed(2) + "%";
      if (remaining <= 0) break;
      await sleep(50);
    }

    countdownWrap.style.display = "none";
  }

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

    // ✅ NEW: short buffer before first number
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

    state.allTrials[state.testIndex] = state.trials.slice();
    state.allResponses[state.testIndex] = state.responses.slice();
    showCompletion();
  }

  function showCompletion() {
    messageWrap.style.display = "block";
    const isLast = state.testIndex === 3;

    if (!isLast) {
      messageTitle.textContent = `Test ${state.testIndex + 1} Completed!`;
      nextBtn.textContent = `Begin Test ${state.testIndex + 2}`;
      nextBtn.style.display = "inline-flex";
    } else {
      const timestamp = new Date().toISOString();
      sendToZapierOnce({
        timestamp,
        subject_name: state.subject,
        session_id: state.session_id,
        raw_json: JSON.stringify({
          timestamp,
          subject: state.subject,
          tests: state.allResponses
        })
      });

      messageBody.textContent =
        "Congratulations! You have completed all the tests!\n\nThank you for your participation";
      nextBtn.style.display = "none";
    }
  }

  window.SART_UI_Begin = function () {
    warn.textContent = "";
    const name = nameInput.value.trim();
    if (!name) {
      warn.textContent = "Please enter your name to continue.";
      return;
    }

    state.subject = name;
    state.session_id = makeSessionId();
    state.testIndex = 0;
    state.allTrials = [null, null, null, null];
    state.allResponses = [null, null, null, null];

    nameBlock.style.display = "none";
    instructionsBlock.style.display = "block";
  };

  window.SART_UI_StartTest1 = async function () {
    window.SART_FadeOutWelcome && window.SART_FadeOutWelcome(4000);
    instructionsBlock.style.display = "none";
    await runCountdown();
    await runTest();
  };

  window.SART_UI_Next = async function () {
    state.testIndex++;
    await runCountdown();
    await runTest();
  };
})();
