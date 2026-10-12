import type { HandStatus, HandTracker } from '../core/HandTracker';

/** Bones of the hand, as landmark index pairs. */
const BONES = [
  [0, 1], [1, 2], [2, 3], [3, 4],
  [0, 5], [5, 6], [6, 7], [7, 8],
  [5, 9], [9, 10], [10, 11], [11, 12],
  [9, 13], [13, 14], [14, 15], [15, 16],
  [13, 17], [17, 18], [18, 19], [19, 20],
  [0, 17],
];

/**
 * The hand tracker's window, bottom-left while it is on: the camera, mirrored
 * and monochrome (it never leaves the device), the tracked hand drawn over
 * it, and a reading of what the hand is doing.
 */
export class HandPanel {
  private readonly el: HTMLElement;
  private readonly canvas: HTMLCanvasElement;
  private readonly g: CanvasRenderingContext2D;
  private readonly label: HTMLElement;
  private text = '';

  constructor(private readonly tracker: HandTracker) {
    this.el = document.createElement('div');
    this.el.className = 'om-hand';
    this.el.hidden = true;
    this.el.setAttribute('aria-hidden', 'true');
    const view = document.createElement('div');
    view.className = 'om-hand-view';
    tracker.video.className = 'om-hand-video';
    this.canvas = document.createElement('canvas');
    view.append(tracker.video, this.canvas);
    this.label = document.createElement('span');
    this.label.className = 'om-label om-hand-state';
    this.el.append(view, this.label);
    document.body.appendChild(this.el);
    this.g = this.canvas.getContext('2d')!;
    tracker.onStatus((s) => this.show(s));
  }

  private show(s: HandStatus): void {
    this.el.hidden = !(s === 'on' || s === 'loading');
    if (s === 'loading') this.say('HAND — STARTING CAMERA');
  }

  private say(t: string): void {
    if (t === this.text) return;
    this.text = t;
    this.label.textContent = t;
  }

  /** Redraw the hand and the reading (each frame while tracking). */
  frame(): void {
    if (!this.tracker.active) return;
    const h = this.tracker.hand;
    this.say(h.present ? `PALM — OPEN ${String(Math.round(h.open * 100)).padStart(2, '0')}%` : 'NO HAND — REFORMING');

    const c = this.canvas;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const w = Math.round(c.clientWidth * dpr);
    const hgt = Math.round(c.clientHeight * dpr);
    if (c.width !== w || c.height !== hgt) {
      c.width = w;
      c.height = hgt;
    }
    const g = this.g;
    g.clearRect(0, 0, w, hgt);
    if (!h.present || h.points.length < 21) return;

    // the video is drawn with object-fit: cover; map the landmarks the same way
    const v = this.tracker.video;
    const vw = v.videoWidth || 4;
    const vh = v.videoHeight || 3;
    const s = Math.max(w / vw, hgt / vh);
    const ox = (w - vw * s) / 2;
    const oy = (hgt - vh * s) / 2;
    const P = h.points.map((p) => [ox + p.x * vw * s, oy + p.y * vh * s]);

    g.lineWidth = 1.2 * dpr;
    g.strokeStyle = 'rgba(255, 255, 255, 0.7)';
    g.beginPath();
    for (const [a, b] of BONES) {
      g.moveTo(P[a][0], P[a][1]);
      g.lineTo(P[b][0], P[b][1]);
    }
    g.stroke();
    g.fillStyle = '#ffffff';
    for (const [x, y] of P) {
      g.beginPath();
      g.arc(x, y, 1.8 * dpr, 0, Math.PI * 2);
      g.fill();
    }
    // the palm: the interaction point, a ring that opens with the hand
    const cx = (P[0][0] + P[5][0] + P[9][0] + P[13][0] + P[17][0]) / 5;
    const cy = (P[0][1] + P[5][1] + P[9][1] + P[13][1] + P[17][1]) / 5;
    g.lineWidth = 1.5 * dpr;
    g.strokeStyle = '#ffffff';
    g.beginPath();
    g.arc(cx, cy, (4 + h.open * 10) * dpr, 0, Math.PI * 2);
    g.stroke();
  }
}
