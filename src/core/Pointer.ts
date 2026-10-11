/**
 * Global pointer tracker. Views read from it each frame; nothing is
 * dispatched per event, which keeps input cost flat regardless of the number
 * of views on screen.
 */
export class Pointer {
  x = -9999;
  y = -9999;
  down = false;
  /** A press began this frame / a release happened this frame. */
  pressedThisFrame = false;
  releasedThisFrame = false;
  /** Client position at press time. */
  downX = 0;
  downY = 0;
  /** Largest distance travelled since the press (px). Used to tell clicks from drags. */
  travel = 0;
  fine = matchMedia('(pointer: fine)').matches;
  /** Velocity in px/s, smoothed. */
  vx = 0;
  vy = 0;
  private lastX = 0;
  private lastY = 0;
  private lastT = 0;
  hasMoved = false;
  /** A touch ended or turned into a scroll: forget its position after this frame. */
  private lifted = false;

  constructor() {
    const opts = { passive: true } as const;
    window.addEventListener('pointermove', this.onMove, opts);
    window.addEventListener('pointerdown', this.onDown, opts);
    window.addEventListener('pointerup', this.onUp, opts);
    window.addEventListener('pointercancel', this.onUp, opts);
    document.addEventListener('pointerleave', this.onLeave, opts);
    window.addEventListener('blur', this.onUp);
  }

  private onMove = (e: PointerEvent) => {
    const now = performance.now();
    const dt = Math.max(1, now - this.lastT) / 1000;
    if (this.hasMoved) {
      const ivx = (e.clientX - this.lastX) / dt;
      const ivy = (e.clientY - this.lastY) / dt;
      this.vx += (ivx - this.vx) * 0.35;
      this.vy += (ivy - this.vy) * 0.35;
    }
    this.lastX = this.x = e.clientX;
    this.lastY = this.y = e.clientY;
    this.lastT = now;
    this.hasMoved = true;
    if (this.down) {
      this.travel = Math.max(this.travel, Math.hypot(this.x - this.downX, this.y - this.downY));
    }
  };

  private onDown = (e: PointerEvent) => {
    if (e.button !== 0) return;
    this.onMove(e);
    this.down = true;
    this.pressedThisFrame = true;
    this.downX = e.clientX;
    this.downY = e.clientY;
    this.travel = 0;
  };

  private onUp = (e?: Event) => {
    // a finger has no position once lifted, or once the browser takes it over to
    // scroll (pointercancel): left where it was, everything scrolling under that
    // point would keep being hovered, heard and pressed
    if ((e as PointerEvent | undefined)?.pointerType === 'touch') this.lifted = true;
    if (!this.down) return;
    this.down = false;
    this.releasedThisFrame = true;
  };

  private onLeave = () => {
    if (!this.down && !this.fine) {
      this.x = this.y = -9999;
    }
  };

  /** Called by the engine at the end of each frame. */
  endFrame(dt: number): void {
    this.pressedThisFrame = false;
    this.releasedThisFrame = false;
    if (this.lifted) {
      // after the release frame, so a tap still lands where it was
      this.lifted = false;
      this.x = this.y = -9999;
      this.hasMoved = false;
    }
    // velocity relaxes toward zero when the pointer stops producing events
    const k = Math.exp(-dt * 6);
    this.vx *= k;
    this.vy *= k;
  }
}
