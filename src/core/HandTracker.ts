import type { HandLandmarker, NormalizedLandmark } from '@mediapipe/tasks-vision';

/** Keep in step with package.json: the wasm runtime is fetched for this exact version. */
const VERSION = '1.0.1';
const WASM = `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${VERSION}/wasm`;
const MODEL = 'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task';

export type HandStatus = 'off' | 'loading' | 'on' | 'denied' | 'error';

export interface Hand {
  /** A hand is in the frame. */
  present: boolean;
  /** Palm centre on screen, client px. */
  x: number;
  y: number;
  /** Palm speed on screen, px/s, smoothed. */
  speed: number;
  /** 0 a fist … 1 a wide-open hand. */
  open: number;
  /** The 21 landmarks, mirrored like the preview (0…1), for drawing. */
  points: { x: number; y: number }[];
}

/** Wrist and the four knuckles: their mean is the palm's centre. */
const PALM = [0, 5, 9, 13, 17];
const TIPS = [4, 8, 12, 16, 20];

/**
 * Webcam hand tracking with MediaPipe's Hand Landmarker. Everything runs on
 * the device: frames never leave the browser. The library, its wasm runtime
 * and the model are only fetched the first time it is switched on.
 *
 * It runs on its own loop, one detection per camera frame, and keeps `hand`
 * up to date: where the palm is (mirrored, with a margin so the screen's
 * edges are reachable without leaving the camera's view), how fast it moves
 * and how open it is (fingertips' distance from the palm, in palm sizes). A
 * hand missing for a quarter of a second is gone.
 */
export class HandTracker {
  readonly hand: Hand = { present: false, x: -9999, y: -9999, speed: 0, open: 0, points: [] };
  readonly video: HTMLVideoElement;
  status: HandStatus = 'off';
  private readonly listeners = new Set<(s: HandStatus) => void>();
  private landmarker: HandLandmarker | null = null;
  private stream: MediaStream | null = null;
  private running = false;
  private lastSeen = 0;
  private lastT = 0;

  constructor() {
    this.video = document.createElement('video');
    this.video.muted = true;
    this.video.playsInline = true;
    this.video.setAttribute('aria-hidden', 'true');
  }

  get active(): boolean {
    return this.status === 'on';
  }

  /** Switched off while starting (the status is read again after each await). */
  private get cancelled(): boolean {
    return this.status !== 'loading';
  }

  onStatus(fn: (s: HandStatus) => void): void {
    this.listeners.add(fn);
  }

  private set(s: HandStatus): void {
    this.status = s;
    this.listeners.forEach((fn) => fn(s));
  }

  toggle(): void {
    if (this.status === 'on' || this.status === 'loading') this.stop();
    else void this.start();
  }

  async start(): Promise<void> {
    if (this.status === 'on' || this.status === 'loading') return;
    if (!navigator.mediaDevices?.getUserMedia) {
      this.set('error');
      return;
    }
    this.set('loading');
    try {
      this.stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'user', width: { ideal: 640 }, height: { ideal: 480 } },
        audio: false,
      });
    } catch {
      this.set('denied');
      return;
    }
    // switched off while waiting for the permission
    if (this.cancelled) return this.release();
    try {
      this.video.srcObject = this.stream;
      await this.video.play();
      if (!this.landmarker) {
        const { FilesetResolver, HandLandmarker } = await import('@mediapipe/tasks-vision');
        const files = await FilesetResolver.forVisionTasks(WASM);
        this.landmarker = await HandLandmarker.createFromOptions(files, {
          baseOptions: { modelAssetPath: MODEL, delegate: 'GPU' },
          runningMode: 'VIDEO',
          numHands: 1,
          minHandDetectionConfidence: 0.6,
          minHandPresenceConfidence: 0.6,
          minTrackingConfidence: 0.5,
        });
      }
    } catch {
      this.release();
      this.set('error');
      return;
    }
    if (this.cancelled) return this.release();
    this.running = true;
    this.lastT = performance.now();
    this.set('on');
    this.loop();
  }

  stop(): void {
    this.running = false;
    this.release();
    this.lose();
    this.set('off');
  }

  private release(): void {
    this.stream?.getTracks().forEach((t) => t.stop());
    this.stream = null;
    this.video.srcObject = null;
  }

  private lose(): void {
    const h = this.hand;
    h.present = false;
    h.speed = 0;
    h.points = [];
  }

  private loop = (): void => {
    if (!this.running) return;
    const v = this.video;
    if (this.landmarker && v.readyState >= 2) {
      const now = performance.now();
      const res = this.landmarker.detectForVideo(v, now);
      this.update(res.landmarks[0], now);
    }
    if ('requestVideoFrameCallback' in v) v.requestVideoFrameCallback(() => this.loop());
    else requestAnimationFrame(this.loop);
  };

  private update(lm: NormalizedLandmark[] | undefined, now: number): void {
    const h = this.hand;
    const dt = Math.min(0.1, Math.max(0.001, (now - this.lastT) / 1000));
    this.lastT = now;
    if (!lm) {
      if (h.present && now - this.lastSeen > 250) this.lose();
      return;
    }
    this.lastSeen = now;

    let px = 0;
    let py = 0;
    for (const i of PALM) {
      px += lm[i].x / PALM.length;
      py += lm[i].y / PALM.length;
    }
    // mirrored (it is a mirror to the user), and the middle of the frame spans the whole screen
    const nx = Math.min(1, Math.max(0, (1 - px - 0.14) / 0.72));
    const ny = Math.min(1, Math.max(0, (py - 0.12) / 0.7));
    const sx = nx * window.innerWidth;
    const sy = ny * window.innerHeight;

    const aspect = this.video.videoWidth / Math.max(1, this.video.videoHeight);
    const dist = (ax: number, ay: number, bx: number, by: number) => Math.hypot((ax - bx) * aspect, ay - by);
    const size = Math.max(1e-4, dist(lm[0].x, lm[0].y, lm[9].x, lm[9].y));
    let reach = 0;
    for (const i of TIPS) reach += dist(lm[i].x, lm[i].y, px, py) / TIPS.length;
    const t = Math.min(1, Math.max(0, (reach / size - 0.95) / 0.8));
    const open = t * t * (3 - 2 * t);

    if (!h.present) {
      h.x = sx;
      h.y = sy;
      h.speed = 0;
      h.open = open;
    } else {
      const ox = h.x;
      const oy = h.y;
      const k = 1 - Math.exp(-dt / 0.045);
      h.x += (sx - h.x) * k;
      h.y += (sy - h.y) * k;
      const v = Math.hypot(h.x - ox, h.y - oy) / dt;
      h.speed += (v - h.speed) * (1 - Math.exp(-dt / 0.08));
      h.open += (open - h.open) * (1 - Math.exp(-dt / 0.1));
    }
    h.present = true;
    h.points = lm.map((p) => ({ x: 1 - p.x, y: p.y }));
  }
}
