/**
 * Gallery particle transition — the one place to art-direct it.
 *
 * The outgoing specimen dissolves in place into fine dust that spreads out
 * softly around it, blurring and thinning as it goes; the incoming one gathers
 * out of the same kind of dust and then hands over to the living specimen with
 * a long, soft fade.
 * Distances in CSS px, times in seconds, timeline fractions 0–1.
 */
export const galleryParticleConfig = {
  /** Particles per specimen, rounded to a square power of two: 65536 = 256². */
  particleCount: 65536,
  /** Size multiplier over the size that exactly tiles the silhouette. 0.8–2. */
  particleSize: 1.35,
  /** 0–1. */
  particleOpacity: 1,
  /** How far the dust spreads, as a fraction of the specimen's radius (most stays near, a few go far). 0–1.5. */
  spread: 1.1,
  /** Upward drift, as a fraction of the radius. 0–0.6. */
  lift: 0.22,
  /** Swirl around the centre, radians. 0–1.5. */
  swirl: 0.7,
  /** How much particles blur and grow as they disperse. 0–2. */
  softness: 1.2,
  /** px: depth drift. 0–60. */
  depth: 24,
  /** 0–0.3: how much regions are offset in time (noise-driven). */
  stagger: 0.18,
  /** Total length, s. */
  duration: 2,
  /** Timeline window in which the live incoming specimen fades in over its particles. */
  handoff: [0.62, 1] as [number, number],
  /** Quarter the particle count and capture size on low-tier devices. */
  adaptiveQuality: true,
};

export type GalleryParticleConfig = typeof galleryParticleConfig;
