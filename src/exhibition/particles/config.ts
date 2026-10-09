/**
 * Gallery particle transition — the one place to art-direct it.
 *
 * The outgoing specimen dissolves in place into very fine dust that drifts a
 * little way out and fades, thinning as it goes; the incoming one gathers out
 * of the same dust and then hands over to the living specimen with a long,
 * soft fade. Light by design: small particles, short drift, gradual fades.
 * Distances in CSS px, times in seconds, timeline fractions 0–1.
 */
export const galleryParticleConfig = {
  /** Particles per specimen, rounded to a square power of two: 65536 = 256². */
  particleCount: 65536,
  /** Size multiplier over the size that exactly tiles the silhouette. 0.6–1.5. */
  particleSize: 1,
  /** 0–1. */
  particleOpacity: 1,
  /** How far the dust drifts, as a fraction of the specimen's radius (most stay nearer). 0–1. */
  spread: 0.26,
  /** Upward drift, as a fraction of the radius. 0–0.3. */
  lift: 0.07,
  /** Swirl around the centre, radians. 0–1. */
  swirl: 0.3,
  /** Particle size once dispersed, relative to its size in the specimen (finer dust). 0.2–1. */
  dust: 0.45,
  /** px: depth drift. 0–60. */
  depth: 14,
  /** 0–0.3: how much regions are offset in time (noise-driven). */
  stagger: 0.18,
  /** Total length, s. */
  duration: 1.8,
  /** Timeline window in which the live incoming specimen fades in over its particles. */
  handoff: [0.62, 1] as [number, number],
  /** Quarter the particle count and capture size on low-tier devices. */
  adaptiveQuality: true,
};

export type GalleryParticleConfig = typeof galleryParticleConfig;
