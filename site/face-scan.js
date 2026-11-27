const VISION_VERSION = "1.2.3";
const VISION_BASE = "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@" + VISION_VERSION;
const FACE_MODEL = "https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task";

export function createFaceScanner({ onSignal = () => {} } = {}) {
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
    ".face-scan-readout{border:1px solid #3ccfe555;padding:11px;background:#05101b99;color:#6a9ba7;font-size:10px}",
    ".face-scan-readout b{display:block;margin-top:4px;color:#d6fbff;font-size:12px;letter-spacing:.08em}",
    ".face-scan-readout.is-green{border-color:#40ff9a99;color:#70ffba;box-shadow:0 0 18px #28ff9a22}",
    ".face-scan-hint{margin:13px 0 0;color:#6e9eab;font-size:10px;letter-spacing:.06em}",
    ".face-scan-error{color:#ff8a9b!important}",
    "@keyframes faceScanSweep{from{top:0}to{top:100%}}",
    "@media(max-width:740px){.face-scan-holo{padding:8px}.face-scan-layout{grid-template-columns:1fr}.face-scan-side{display:grid;grid-template-columns:1fr 1fr}.face-scan-head{font-size:9px}.face-scan-readout{padding:8px}}",
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
      signalBox.querySelector("b").textContent = "GREEN / TRACK LOCKED";
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
    panel.innerHTML = '<div class="face-scan-card"><header class="face-scan-head"><b>JARVIS // HOLOGRAPHIC FACE SCAN</b><button class="face-scan-close" type="button" aria-label="Close face scan">CLOSE ×</button></header><div class="face-scan-layout"><div class="face-scan-screen is-scanning"><video autoplay muted playsinline></video><canvas></canvas></div><aside class="face-scan-side"><div class="face-scan-readout">SCAN STATUS<b data-face-status>REQUESTING CAMERA ACCESS</b></div><div class="face-scan-readout">TRACK SIGNAL<b data-face-signal>WAITING FOR FACE</b></div><div class="face-scan-readout">LANDMARKS<b>EYES · NOSE · CHEEKS</b></div><div class="face-scan-readout">PROCESSING<b>ON THIS DEVICE</b></div></aside></div><p class="face-scan-hint">Camera frames stay in this browser and are not recorded. MediaPipe may send usage metrics. Close the scan to stop the camera.</p></div>';
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

  function drawLandmarks(points, clear = true) {
    const w = canvas.width;
    const h = canvas.height;
    if (clear) context.clearRect(0, 0, w, h);
    const oval = [10,338,297,332,284,251,389,356,454,323,361,288,397,365,379,378,400,377,152,148,176,149,150,136,172,58,132,93,234,127,162,21,54,103,67,109,10];
    const eyeL = [33,160,158,133,153,144,163,7,33];
    const eyeR = [362,385,387,263,373,380,390,249,362];
    const nose = [168,6,197,195,5,4,1,19,94,2];
    const cheekL = [234,127,116,117,118,101,50,123,147];
    const cheekR = [454,356,345,346,347,330,280,352,376];
    chain(points, oval, "rgba(89,255,190,.92)", Math.max(1.4, w / 520));
    chain(points, eyeL, "#74efff", Math.max(2, w / 440));
    chain(points, eyeR, "#74efff", Math.max(2, w / 440));
    chain(points, nose, "#b4a4ff", Math.max(1.8, w / 480));
    chain(points, cheekL, "rgba(255,86,205,.9)", Math.max(1.4, w / 560));
    chain(points, cheekR, "rgba(255,86,205,.9)", Math.max(1.4, w / 560));
    [33,133,362,263,1,50,280,234,454].forEach((index, number) => {
      const labels = {0:"EYE",1:"EYE",2:"EYE",3:"EYE",4:"NOSE",5:"CHEEK",6:"CHEEK",7:"LEFT",8:"RIGHT"};
      marker(points[index], labels[number], number < 4 ? "#74efff" : number === 4 ? "#b4a4ff" : "#63ffb6");
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

  function finishScan(points) {
    if (locked || !video || !canvas || !context) return;
    locked = true;
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    context.drawImage(video, 0, 0, canvas.width, canvas.height);
    drawLandmarks(points, false);
    panel.querySelector(".face-scan-screen").classList.add("is-locked");
    panel.querySelector(".face-scan-screen").classList.remove("is-scanning");
    setStatus("FACE TRACK LOCK // GREEN SIGNAL", true);
    releaseCamera();
    onSignal();
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
          context.clearRect(0, 0, canvas.width, canvas.height);
          if (points?.length) {
            drawLandmarks(points);
            const center = points[1] || points[10];
            const dx = center.x - .5;
            const dy = center.y - .5;
            const instruction = Math.abs(dx) > .12 ? (dx < 0 ? "SHIFT RIGHT" : "SHIFT LEFT") : Math.abs(dy) > .16 ? (dy < 0 ? "MOVE DOWN" : "MOVE UP") : "HOLD STILL";
            setStatus(instruction);
            if (instruction === "HOLD STILL") {
              if (!lockSince) lockSince = performance.now();
              if (performance.now() - lockSince > 1450) finishScan(points);
            } else {
              lockSince = 0;
            }
          } else {
            lockSince = 0;
            setStatus("MOVE INTO FRAME");
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
    releaseCamera();
    panel?.remove();
    panel = null;
    video = null;
    canvas = null;
    context = null;
    locked = false;
    lockSince = 0;
  }

  return { start, stop };
}
