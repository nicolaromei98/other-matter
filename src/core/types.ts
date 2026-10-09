export type Tier = 'high' | 'low';

export interface Frame {
  /** Wall time in seconds. */
  time: number;
  /** Idle time: wall time scaled by the motion preference. */
  idle: number;
  dt: number;
  /** 1 normally, 0.35 with prefers-reduced-motion. */
  motion: number;
}

/** A specimen's on-screen placement: centre and radius in CSS px, depth in px. */
export interface ScreenCircle {
  x: number;
  y: number;
  r: number;
  z: number;
}
