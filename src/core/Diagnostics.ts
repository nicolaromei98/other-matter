import type { Engine } from './Engine';

/**
 * Development HUD: frame time, FPS, draw calls, triangles, points, pixel
 * ratio. Shown in dev builds or with ?debug; toggle with the ` key.
 */
export class Diagnostics {
  private acc = 0;
  private frames = 0;
  private worst = 0;

  constructor(
    private engine: Engine,
    private el: HTMLElement,
  ) {
    el.hidden = !new URLSearchParams(location.search).has('debug');
    window.addEventListener('keydown', (e) => {
      if (e.key === '`') el.hidden = !el.hidden;
    });
    engine.renderer.info.autoReset = true;
    const prev = engine.onAfterRender;
    engine.onAfterRender = (dt) => {
      prev?.(dt);
      this.sample(dt);
    };
  }

  private sample(dt: number): void {
    this.acc += dt;
    this.frames++;
    this.worst = Math.max(this.worst, dt);
    if (this.acc < 0.5 || this.el.hidden) return;
    const info = this.engine.renderer.info.render;
    const ms = (this.acc / this.frames) * 1000;
    const visible = this.engine.specimens.filter((s) => s.group.visible).length;
    this.el.textContent = [
      `fps    ${(this.frames / this.acc).toFixed(0)}`,
      `frame  ${ms.toFixed(1)} ms  (worst ${(this.worst * 1000).toFixed(1)})`,
      `calls  ${info.calls}`,
      `tris   ${info.triangles.toLocaleString('en-GB')}`,
      `points ${info.points.toLocaleString('en-GB')}`,
      `dpr    ${this.engine.pixelRatio.toFixed(2)}  tier ${this.engine.tier}`,
      `live   ${visible}/6`,
    ].join('\n');
    this.acc = 0;
    this.frames = 0;
    this.worst = 0;
  }
}
