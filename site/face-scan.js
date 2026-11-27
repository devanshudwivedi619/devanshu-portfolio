const VISION_VERSION = "1.2.3";
const VISION_BASE = "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@" + VISION_VERSION;
const FACE_MODEL = "https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task";

export function createFaceScanner({ onSignal = () => {}, onStop = () => {} } = {}) {
  let panel = null;
  let stream = null;
  let landmarker = null;
  let video = null;
  let canvas = null;
  let context = null;
  let frameId = 0;
  let lockSince = 0;
  let locked = false;
  let cancelled = false;
  let sequenceRunning = false;
  let activeStage = "idle";
  let latestPoints = null;
  let scanToken = 0;
  let fingerprintTimer = 0;

  const styles = [
    ".face-scan-holo{position:fixed;inset:0;z-index:100100;display:grid;place-items:center;padding:20px;background:radial-gradient(ellipse at 50% 42%,#073b4bdb,#02070ff5 70%);color:#c9fbff;font:12px/1.5 ui-monospace,SFMono-Regular,Consolas,monospace;letter-spacing:.12em}",
    ".face-scan-card{position:relative;width:min(1040px,96vw);max-height:94vh;overflow:auto;border:1px solid #50eaff8a;background:linear-gradient(145deg,#06141dee,#030811f5);box-shadow:0 0 44px #02d9ff22,inset 0 0 32px #0dd5ff0d;padding:clamp(14px,2.5vw,28px)}",
    ".face-scan-head{display:flex;align-items:center;justify-content:space-between;gap:12px;margin-bottom:16px;color:#8ceeff;font-size:11px}",
    ".face-scan-head b{color:#fff;letter-spacing:.18em}",
    ".face-scan-close{border:1px solid #5de8ff88;background:#071723;color:#b7f6ff;font:inherit;padding:8px 12px;cursor:pointer}",
    ".face-scan-close:hover{background:#0e3443;box-shadow:0 0 18px #11daff55}",
    ".face-scan-layout{display:grid;grid-template-columns:minmax(0,1fr) 220px;gap:16px}",
    ".face-scan-screen{position:relative;overflow:hidden;aspect-ratio:4/3;border:1px solid #44eaff88;background:radial-gradient(ellipse,#0c2233,#03070c);box-shadow:inset 0 0 40px #0bdcff17}",
    ".face-scan-screen video,.face-scan-screen canvas{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;transform:scaleX(-1)}",
    ".face-scan-screen video{filter:saturate(.76) contrast(1.1) brightness(.78)}",
    ".face-scan-screen canvas{pointer-events:none}",
    ".face-scan-screen:after{content:'';position:absolute;inset:0;pointer-events:none;background:repeating-linear-gradient(0deg,transparent 0 3px,#46dfff0b 4px 5px);box-shadow:inset 0 0 55px #00d9ff1d}",
    ".face-scan-screen.is-scanning:before{content:'';position:absolute;z-index:3;left:0;right:0;height:2px;background:#69ffb9;box-shadow:0 0 12px #39ff9a,0 0 28px #24ffc7;animation:faceScanSweep 2.3s linear infinite}",
    ".face-scan-screen.is-locked video{display:none}",
    ".face-scan-screen.is-locked canvas{transform:none;filter:drop-shadow(0 0 5px #34ff9a)}",
    ".face-scan-side{display:flex;flex-direction:column;gap:10px}",
    ".face-scan-stage-list{display:grid;gap:6px;border:1px solid #3ccfe555;padding:10px;background:#04101b99}",
    ".face-scan-step{position:relative;border:1px solid #194352;padding:8px 9px;color:#6e98a2;font-size:9px;letter-spacing:.08em;transition:.25s ease}",
    ".face-scan-step b{float:right;color:#6b8a91;font-size:9px}",
    ".face-scan-step.is-green{border-color:#46ff9a;color:#a2ffd0;background:#0a261a;box-shadow:0 0 15px #32ff952b;text-shadow:0 0 9px #39ff9a66}",
    ".face-scan-step.is-green b{color:#62ff9f}",
    ".face-scan-step.is-scanning{border-color:#5deaff;color:#c5f7ff;background:#082031;box-shadow:0 0 12px #18dfff33}",
    ".face-scan-step.is-scanning b{color:#70eaff}",
    ".face-scan-step.is-scanning .fingerprint-glyph{stroke:#94ffe0;filter:drop-shadow(0 0 7px #52ffba);animation:fingerprintPulse 1.8s ease-in-out infinite alternate}",
    "@keyframes fingerprintPulse{to{transform:scale(1.08);opacity:.75}}",
    ".face-scan-fingerprint{display:flex;align-items:center;gap:8px}",
    ".face-scan-fingerprint-lab{position:relative;min-height:120px;overflow:hidden;border:1px solid #3ccfe555;padding:8px;background:radial-gradient(ellipse,#0a344755,#04101b99 72%);color:#83eaff}",
    ".face-scan-fingerprint-lab header{display:flex;justify-content:space-between;gap:6px;color:#83eaff;font-size:7px;letter-spacing:.1em}",
    ".face-scan-fingerprint-lab header b{color:#6e9aa5;font-weight:400}",
    ".face-scan-fingerprint-art{position:relative;display:grid;place-items:center;height:68px;margin:3px 0;overflow:hidden}",
    ".face-scan-fingerprint-art svg{width:64px;height:64px;fill:none;stroke:#6beaff;stroke-width:1.35;stroke-linecap:round;stroke-dasharray:2 2;filter:drop-shadow(0 0 4px #2bdfff66);transition:stroke .3s,filter .3s}",
    ".fingerprint-sweep{display:none;position:absolute;left:18%;right:18%;top:0;height:1px;background:#6effb1;box-shadow:0 0 9px #45ff9f;}",
    ".face-scan-fingerprint-lab.is-scanning .fingerprint-sweep{display:block;animation:fingerprintSweep 3.4s linear infinite}",
    ".face-scan-fingerprint-lab.is-scanning svg{stroke:#9affd0;filter:drop-shadow(0 0 8px #42ffb077)}",
    ".face-scan-fingerprint-lab.is-green{border-color:#46ff9a99;box-shadow:0 0 18px #28ff9a22}",
    ".face-scan-fingerprint-lab.is-green svg{stroke:#62ff9f;filter:drop-shadow(0 0 7px #62ff9f)}",
    ".fingerprint-metrics{display:flex;justify-content:space-between;gap:3px;color:#66818a;font-size:6px;letter-spacing:.06em}",
    ".fingerprint-metrics b{display:block;margin-top:2px;color:#c6f5ff;font-size:8px;font-weight:500}",
    ".face-scan-fingerprint-lab.is-green .fingerprint-metrics b{color:#62ff9f}",
    "@keyframes fingerprintSweep{from{top:5px}to{top:63px}}
    ".face-scan-fingerprint small{display:block;color:#66818a;font-size:8px;letter-spacing:.04em}",
    ".fingerprint-glyph{width:35px;height:35px;flex:none;fill:none;stroke:#6b9ca8;stroke-width:1.5;stroke-linecap:round}",
    ".face-scan-step.is-green .fingerprint-glyph{stroke:#62ff9f;filter:drop-shadow(0 0 5px #62ff9f)}",
    ".face-scan-readout{border:1px solid #3ccfe555;padding:11px;background:#05101b99;color:#6a9ba7;font-size:10px}",
    ".face-scan-readout b{display:block;margin-top:4px;color:#d6fbff;font-size:12px;letter-spacing:.08em}",
    ".face-scan-readout.is-green{border-color:#40ff9a99;color:#70ffba;box-shadow:0 0 18px #28ff9a22}",
    ".face-scan-hint{margin:13px 0 0;color:#6e9eab;font-size:10px;letter-spacing:.06em}",
    ".face-scan-error{color:#ff8a9b!important}",
    "@keyframes faceScanSweep{from{top:0}to{top:100%}}",
    "@media(max-width:740px){.face-scan-holo{padding:8px}.face-scan-layout{grid-template-columns:1fr}.face-scan-side{display:grid;grid-template-columns:1fr 1fr}.face-scan-head{font-size:9px}.face-scan-readout{padding:8px}.face-scan-fingerprint-lab{grid-column:1/-1}}",
    "@media(prefers-reduced-motion:reduce){.face-scan-screen.is-scanning:before{animation:none;top:50%}}",
  ].join("");

  function setStatus(message, signal = false, error = false) {
    if (!panel) return;
    const status = panel.querySelector("[data-face-status]");
    const signalBox = panel.querySelector("[data-face-signal]");
    if (status) {
      status.textContent = message;
      status.classList.toggle("face-scan-error", error);
    }
    if (signalBox && signal) {
      signalBox.classList.add("is-green");
      signalBox.querySelector("b").textContent = "✓ GREEN / FACE LOCKED";
    }
  }

  function buildPanel() {
    if (panel) return;
    if (!document.querySelector("#face-scan-holo-styles")) {
      const style = document.createElement("style");
      style.id = "face-scan-holo-styles";
      style.textContent = styles;
      document.head.append(style);
    }
    panel = document.createElement("section");
    panel.className = "face-scan-holo";
    panel.setAttribute("role", "dialog");
    panel.setAttribute("aria-modal", "true");
    panel.setAttribute("aria-label", "Live local face landmark scan");
    panel.innerHTML = '<div class="face-scan-card"><header class="face-scan-head"><b>JARVIS // HOLOGRAPHIC FACE SCAN</b><button class="face-scan-close" type="button" aria-label="Close face scan">CLOSE ×</button></header><div class="face-scan-layout"><div class="face-scan-screen is-scanning"><video autoplay muted playsinline></video><canvas></canvas></div><aside class="face-scan-side"><div class="face-scan-readout">SCAN STATUS<b data-face-status>REQUESTING CAMERA ACCESS</b></div><div class="face-scan-readout" data-face-signal>TRACK SIGNAL<b>WAITING FOR FACE</b></div><div class="face-scan-stage-list" aria-label="Scan sequence"><div class="face-scan-step" data-scan-stage="left-eye">01 / LEFT EYE<b>WAITING</b></div><div class="face-scan-step" data-scan-stage="right-eye">02 / RIGHT EYE<b>WAITING</b></div><div class="face-scan-step face-scan-fingerprint" data-scan-stage="fingerprint"><svg class="fingerprint-glyph" viewBox="0 0 40 40" aria-hidden="true"><path d="M20 5c-7 0-12 5-12 12m24 0c0-7-5-12-12-12M12 19c0-5 3-8 8-8s8 3 8 8m-20 4c0 9-2 12-4 15m8-16c0 8-1 13-3 17m7-18c0 10-1 15-2 18m7-18c0 8 1 13 3 17m4-16c0 9 2 12 4 15M15 19c0-3 2-5 5-5s5 2 5 5v3"/></svg><span>03 / FINGERPRINT<small>VISUAL SIMULATION ONLY</small></span><b>WAITING</b></div><div class="face-scan-step" data-scan-stage="nose">04 / NOSE<b>WAITING</b></div><div class="face-scan-step" data-scan-stage="lips">05 / LIPS<b>WAITING</b></div></div><div class="face-scan-fingerprint-lab" data-fingerprint-lab><header><span>FINGERPRINT RIDGE MAP</span><b>VISUAL DEMO</b></header><div class="face-scan-fingerprint-art"><svg viewBox="0 0 80 80" aria-hidden="true"><path d="M40 8c-15 0-25 11-25 25m50 0C65 18 55 8 40 8M21 37c0-11 7-18 19-18s19 7 19 18M17 44c0 13-2 20-7 27m16-28c0 12-2 21-5 29m12-30c0 16-1 23-3 31m13-31c0 15 2 23 4 30m8-29c0 13 2 21 6 27M29 37c0-7 4-11 11-11s11 4 11 11v9c0 10 1 16 4 23M35 38c0-3 2-5 5-5s5 2 5 5v13c0 5 0 10 2 15"/></svg><i class="fingerprint-sweep"></i></div><div class="fingerprint-metrics"><span>TRACKS<b data-fp-tracks>00 / 18</b></span><span>PROGRESS<b data-fp-progress>00%</b></span><span>RESULT<b data-fp-result>STANDBY</b></span></div></div><div class="face-scan-readout">PROCESSING<b>ON THIS DEVICE</b></div></aside></aside></div><p class="face-scan-hint">Camera frames stay in this browser and are not recorded. MediaPipe may send usage metrics. Close the scan to stop the camera.</p></div>';
    document.body.append(panel);
    panel.querySelector(".face-scan-close").addEventListener("click", stop);
    panel.addEventListener("click", (event) => {
      if (event.target === panel) stop();
    });
    video = panel.querySelector("video");
    canvas = panel.querySelector("canvas");
    context = canvas.getContext("2d");
  }

  function chain(points, indices, color, width = 2) {
    if (!points || indices.length < 2) return;
    context.beginPath();
    indices.forEach((index, position) => {
      const point = points[index];
      if (!point) return;
      const x = point.x * canvas.width;
      const y = point.y * canvas.height;
      if (!position) context.moveTo(x, y);
      else context.lineTo(x, y);
    });
    context.strokeStyle = color;
    context.lineWidth = width;
    context.shadowColor = color;
    context.shadowBlur = 10;
    context.stroke();
    context.shadowBlur = 0;
  }

  function marker(point, label, color = "#63ffb6") {
    if (!point) return;
    const x = point.x * canvas.width;
    const y = point.y * canvas.height;
    context.beginPath();
    context.arc(x, y, Math.max(4, canvas.width * .008), 0, Math.PI * 2);
    context.strokeStyle = color;
    context.lineWidth = 1.7;
    context.shadowColor = color;
    context.shadowBlur = 12;
    context.stroke();
    context.shadowBlur = 0;
    context.fillStyle = "#e8fff7";
    context.font = "12px ui-monospace,monospace";
    context.fillText(label, x + 9, y - 8);
  }

  function drawLandmarks(points, clear = true, stage = "idle") {
    const w = canvas.width;
    const h = canvas.height;
    if (clear) context.clearRect(0, 0, w, h);
    const green = "#63ffb6";
    const oval = [10,338,297,332,284,251,389,356,454,323,361,288,397,365,379,378,400,377,152,148,176,149,150,136,172,58,132,93,234,127,162,21,54,103,67,109,10];
    const eyeL = [33,160,158,133,153,144,163,7,33];
    const eyeR = [362,385,387,263,373,380,390,249,362];
    const nose = [168,6,197,195,5,4,1,19,94,2];
    const cheekL = [234,127,116,117,118,101,50,123,147];
    const cheekR = [454,356,345,346,347,330,280,352,376];
    const lips = [61,146,91,181,84,17,314,405,321,375,291,308,324,318,402,317,14,87,178,88,95,78,61];
    const leftGreen = stage === "left-eye" || stage === "all";
    const rightGreen = stage === "right-eye" || stage === "all";
    chain(points, oval, "rgba(89,255,190,.92)", Math.max(1.4, w / 520));
    chain(points, eyeL, leftGreen ? green : "#74efff", Math.max(2, w / 440));
    chain(points, eyeR, rightGreen ? green : "#74efff", Math.max(2, w / 440));
    chain(points, nose, stage === "nose" || stage === "all" ? green : "#b4a4ff", Math.max(1.8, w / 480));
    chain(points, lips, stage === "lips" || stage === "all" ? green : "#ff89d8", Math.max(1.7, w / 500));
    chain(points, cheekL, "rgba(255,86,205,.9)", Math.max(1.4, w / 560));
    chain(points, cheekR, "rgba(255,86,205,.9)", Math.max(1.4, w / 560));
    [[33,"EYE",leftGreen],[263,"EYE",rightGreen],[1,"NOSE",stage === "nose" || stage === "all"],[61,"LIP",stage === "lips" || stage === "all"],[291,"LIP",stage === "lips" || stage === "all"],[50,"CHEEK",false],[280,"CHEEK",false]].forEach(([index,label,isGreen]) => {
      marker(points[index], label, isGreen ? green : label === "EYE" ? "#74efff" : label === "NOSE" ? "#b4a4ff" : label === "LIP" ? "#ff89d8" : "#63ffb6");
    });
    for (let i = 0; i < points.length; i += 9) {
      const point = points[i];
      context.beginPath();
      context.arc(point.x * w, point.y * h, Math.max(1, w / 900), 0, Math.PI * 2);
      context.fillStyle = "rgba(106,255,195,.72)";
      context.fill();
    }
  }

  function releaseCamera() {
    if (frameId) cancelAnimationFrame(frameId);
    frameId = 0;
    stream?.getTracks().forEach((track) => track.stop());
    stream = null;
    video?.pause();
    if (landmarker) {
      landmarker.close();
      landmarker = null;
    }
  }

  function updateFingerprintMetrics(progress, result = "SCANNING") {
    if (!panel) return;
    const percent = Math.max(0, Math.min(100, Math.round(progress)));
    const tracks = Math.round(percent * 18 / 100);
    const tracksNode = panel.querySelector("[data-fp-tracks]");
    const progressNode = panel.querySelector("[data-fp-progress]");
    const resultNode = panel.querySelector("[data-fp-result]");
    if (tracksNode) tracksNode.textContent = String(tracks).padStart(2, "0") + " / 18";
    if (progressNode) progressNode.textContent = String(percent).padStart(2, "0") + "%";
    if (resultNode) resultNode.textContent = result;
  }

  function resetStages() {
    clearInterval(fingerprintTimer);
    fingerprintTimer = 0;
    panel?.querySelectorAll("[data-scan-stage]").forEach((node) => {
      node.classList.remove("is-green", "is-scanning");
      const state = node.querySelector("b");
      if (state) state.textContent = "WAITING";
    });
    panel?.querySelector("[data-fingerprint-lab]")?.classList.remove("is-green", "is-scanning");
    updateFingerprintMetrics(0, "STANDBY");
  }

  async function runScanSequence(token) {
    const steps = [
      ["left-eye", "SCANNING LEFT EYE LANDMARKS", 950],
      ["right-eye", "SCANNING RIGHT EYE LANDMARKS", 950],
      ["fingerprint", "SCANNING FINGERPRINT RIDGES // VISUAL SIMULATION", 3400],
      ["nose", "SCANNING NOSE LANDMARKS", 950],
      ["lips", "SCANNING LIP CONTOUR", 950],
    ];
    for (const [id, label, duration] of steps) {
      if (cancelled || !panel || token !== scanToken) return;
      activeStage = id;
      setStatus(label);
      const row = panel.querySelector('[data-scan-stage="' + id + '"]');
      row?.classList.add("is-scanning");
      if (id === "fingerprint") {
        const lab = panel.querySelector("[data-fingerprint-lab]");
        lab?.classList.add("is-scanning");
        const started = performance.now();
        clearInterval(fingerprintTimer);
        fingerprintTimer = window.setInterval(() => {
          const progress = Math.min(99, ((performance.now() - started) / duration) * 100);
          updateFingerprintMetrics(progress, "SIMULATED");
        }, 80);
      }
      await new Promise((resolve) => setTimeout(resolve, duration));
      clearInterval(fingerprintTimer);
      fingerprintTimer = 0;
      if (cancelled || !panel || token !== scanToken) return;
      row?.classList.remove("is-scanning");
      if (id === "fingerprint") {
        panel.querySelector("[data-fingerprint-lab]")?.classList.remove("is-scanning");
        panel.querySelector("[data-fingerprint-lab]")?.classList.add("is-green");
        updateFingerprintMetrics(100, "✓ DEMO MARK");
      }
      row?.classList.add("is-green");
      const state = row?.querySelector("b");
      if (state) state.textContent = "✓ GREEN";
    }
    if (cancelled || !panel || token !== scanToken || !video || !canvas || !context || !latestPoints) return;
    locked = true;
    sequenceRunning = false;
    activeStage = "all";
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    context.drawImage(video, 0, 0, canvas.width, canvas.height);
    drawLandmarks(latestPoints, false, "all");
    panel.querySelector(".face-scan-screen").classList.add("is-locked");
    panel.querySelector(".face-scan-screen").classList.remove("is-scanning");
    setStatus("SCAN COMPLETE // GREEN CHECK", true);
    releaseCamera();
    onSignal();
  }

  function beginScanSequence(points) {
    if (sequenceRunning || locked) return;
    sequenceRunning = true;
    latestPoints = points;
    const token = ++scanToken;
    void runScanSequence(token);
  }

  async function start() {
    if (panel) return;
    cancelled = false;
    locked = false;
    lockSince = 0;
    buildPanel();
    if (!navigator.mediaDevices?.getUserMedia) {
      setStatus("CAMERA UNAVAILABLE / USE HTTPS", false, true);
      return;
    }
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: { facingMode: "user", width: { ideal: 960 }, height: { ideal: 720 } },
      });
      if (cancelled || !panel) {
        stream?.getTracks().forEach((track) => track.stop());
        stream = null;
        return;
      }
      video.srcObject = stream;
      await video.play();
      if (cancelled || !panel) return;
      setStatus("LOADING FACE LANDMARK MODEL");
      const visionApi = await import(VISION_BASE + "/vision_bundle.mjs");
      const vision = await visionApi.FilesetResolver.forVisionTasks(VISION_BASE + "/wasm");
      const options = {
        baseOptions: { modelAssetPath: FACE_MODEL, delegate: "GPU" },
        runningMode: "VIDEO",
        numFaces: 1,
        outputFaceBlendshapes: false,
      };
      try {
        landmarker = await visionApi.FaceLandmarker.createFromOptions(vision, options);
      } catch {
        options.baseOptions.delegate = "CPU";
        landmarker = await visionApi.FaceLandmarker.createFromOptions(vision, options);
      }
      if (cancelled || !panel) {
        landmarker?.close();
        landmarker = null;
        return;
      }
      setStatus("CENTER YOUR FACE IN THE FRAME");
      const render = () => {
        if (cancelled || !panel || !stream || locked) return;
        if (video.readyState >= 2 && video.videoWidth) {
          if (canvas.width !== video.videoWidth || canvas.height !== video.videoHeight) {
            canvas.width = video.videoWidth;
            canvas.height = video.videoHeight;
          }
          const result = landmarker.detectForVideo(video, performance.now());
          const points = result.faceLandmarks?.[0];
          if (points?.length) {
            latestPoints = points;
            drawLandmarks(points, true, activeStage);
            if (!sequenceRunning) {
              const center = points[1] || points[10];
              const dx = center.x - .5;
              const dy = center.y - .5;
              const instruction = Math.abs(dx) > .12 ? (dx < 0 ? "SHIFT RIGHT" : "SHIFT LEFT") : Math.abs(dy) > .16 ? (dy < 0 ? "MOVE DOWN" : "MOVE UP") : "HOLD STILL";
              setStatus(instruction);
              if (instruction === "HOLD STILL") {
                if (!lockSince) lockSince = performance.now();
                if (performance.now() - lockSince > 1450) beginScanSequence(points);
              } else {
                lockSince = 0;
              }
            }
          } else {
            lockSince = 0;
            latestPoints = null;
            if (sequenceRunning) {
              sequenceRunning = false;
              activeStage = "idle";
              scanToken++;
              resetStages();
              setStatus("FACE LOST // CENTER AGAIN");
            } else {
              setStatus("MOVE INTO FRAME");
            }
          }
        }
        frameId = requestAnimationFrame(render);
      };
      render();
    } catch (error) {
      if (!panel || cancelled) return;
      const denied = error?.name === "NotAllowedError" || error?.name === "PermissionDeniedError";
      setStatus(denied ? "CAMERA PERMISSION DENIED" : "SCAN UNAVAILABLE / TRY AGAIN", false, true);
      releaseCamera();
    }
  }

  function stop() {
    cancelled = true;
    clearInterval(fingerprintTimer);
    fingerprintTimer = 0;
    scanToken++;
    sequenceRunning = false;
    activeStage = "idle";
    releaseCamera();
    panel?.remove();
    panel = null;
    video = null;
    canvas = null;
    context = null;
    locked = false;
    lockSince = 0;
    onStop();
  }

  return { start, stop };
}
