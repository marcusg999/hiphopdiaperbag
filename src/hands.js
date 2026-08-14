/**
 * VITRINE — reach in and turn it.
 *
 * MediaPipe hand tracking, wired so that closing your fist in front of the
 * webcam grabs the bag and moving your hand turns it, 1:1 with your wrist.
 * Open your hand and it keeps going on inertia.
 *
 * Everything here is lazy. The 7.8MB model and the wasm runtime are only
 * fetched after an explicit click, which is both a Lighthouse requirement and
 * the only honest way to ask for a camera.
 *
 * Grab detection uses the mean distance from the four fingertips to the
 * middle-finger MCP, normalised by hand span. That is scale-invariant, so it
 * behaves the same whether the hand is near the lens or far from it — a raw
 * thumb-to-index pinch distance does not.
 */

const LM = {
  WRIST: 0, THUMB_TIP: 4, INDEX_MCP: 5, INDEX_TIP: 8,
  MIDDLE_MCP: 9, MIDDLE_TIP: 12, RING_TIP: 16, PINKY_MCP: 17, PINKY_TIP: 20,
};

const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

export function createHandControl(opts = {}) {
  const onState = opts.onState || (() => {});
  const onFrame = opts.onFrame || (() => {});
  const orbit = opts.orbit;
  const video = opts.video;
  // How far the bag turns for a full sweep of the hand across the frame.
  const degreesPerWidth = opts.degreesPerWidth ?? 900;

  let landmarker = null;
  let stream = null;
  let raf = 0;
  let running = false;
  let closed = false;         // fist currently closed
  let lastX = null;
  let lastVel = 0;
  let lastTs = -1;
  let smoothOpen = 1;

  const CLOSE_ON = 0.62;      // hysteresis so a hovering hand doesn't chatter
  const CLOSE_OFF = 0.78;

  function state(s, detail) { onState(s, detail); }

  async function start() {
    if (running) return;
    state('requesting');
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        video: { width: { ideal: 640 }, height: { ideal: 480 }, facingMode: 'user' },
        audio: false,
      });
    } catch (err) {
      state('denied', err && err.name);
      return false;
    }

    state('loading');
    try {
      const vision = await import('../vendor/mediapipe/vision_bundle.mjs');
      const fileset = await vision.FilesetResolver.forVisionTasks('vendor/mediapipe/wasm');
      landmarker = await vision.HandLandmarker.createFromOptions(fileset, {
        baseOptions: {
          modelAssetPath: 'assets/models/hand_landmarker.task',
          delegate: 'GPU',
        },
        runningMode: 'VIDEO',
        numHands: 1,
        minHandDetectionConfidence: 0.5,
        minHandPresenceConfidence: 0.5,
        minTrackingConfidence: 0.5,
      });
    } catch (err) {
      stop();
      state('failed', String(err && err.message || err));
      return false;
    }

    video.srcObject = stream;
    video.muted = true;
    video.playsInline = true;
    await video.play().catch(() => {});
    running = true;
    orbit && orbit.setIdle(false);
    state('tracking');
    raf = requestAnimationFrame(loop);
    return true;
  }

  function loop() {
    if (!running) return;
    if (video.readyState >= 2 && video.currentTime !== lastTs) {
      lastTs = video.currentTime;
      let res = null;
      try {
        res = landmarker.detectForVideo(video, performance.now());
      } catch { /* a dropped frame is not worth tearing the session down */ }

      const hand = res && res.landmarks && res.landmarks[0];
      if (hand) {
        // Scale-invariant openness: fingertips vs the knuckle, over hand span.
        const mcp = hand[LM.MIDDLE_MCP];
        const span = dist(hand[LM.WRIST], mcp) || 1e-4;
        const curl = (
          dist(hand[LM.INDEX_TIP], mcp) + dist(hand[LM.MIDDLE_TIP], mcp) +
          dist(hand[LM.RING_TIP], mcp) + dist(hand[LM.PINKY_TIP], mcp)
        ) / 4 / span;
        smoothOpen += (curl - smoothOpen) * 0.35;

        const wasClosed = closed;
        if (!closed && smoothOpen < CLOSE_ON) closed = true;
        else if (closed && smoothOpen > CLOSE_OFF) closed = false;

        // The webcam is mirrored for the viewer, so invert x to keep the
        // bag turning the same way the hand moves on screen.
        const x = 1 - mcp.x;

        if (closed && !wasClosed) {
          lastX = x;
          orbit && orbit.grab();
          state('grabbed');
        } else if (closed && lastX !== null) {
          const dx = x - lastX;
          lastX = x;
          lastVel = dx * degreesPerWidth;
          orbit && orbit.addAngle(lastVel);
        } else if (!closed && wasClosed) {
          lastX = null;
          orbit && orbit.release(lastVel);
          state('released');
        }

        onFrame({ hand, open: smoothOpen, closed, x, y: mcp.y });
      } else if (closed) {
        // Hand left the frame while gripping — let go rather than freeze.
        closed = false;
        lastX = null;
        orbit && orbit.release(lastVel);
        state('lost');
        onFrame(null);
      } else {
        onFrame(null);
      }
    }
    raf = requestAnimationFrame(loop);
  }

  function stop() {
    running = false;
    cancelAnimationFrame(raf);
    if (stream) stream.getTracks().forEach((t) => t.stop());
    stream = null;
    if (video) video.srcObject = null;
    if (landmarker) { try { landmarker.close(); } catch {} landmarker = null; }
    closed = false; lastX = null;
    orbit && orbit.setIdle(true);
    state('off');
  }

  return {
    start, stop,
    get running() { return running; },
    get supported() {
      return !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia
        && typeof WebAssembly === 'object');
    },
  };
}
