/**
 * Gallery particle transition — the one place to art-direct it.
 *
 * One cloud of fine particles carries the change: it starts as the outgoing
 * specimen, loosens into light dust mid-way while each particle glides to its
 * place on the incoming specimen and takes on its colour, then settles and
 * hands over to the living specimen with a long, soft fade. Light by design:
 * small particles, a short drift, no particle appears or vanishes on its own.
 * Distances in CSS px, times in seconds, timeline fractions 0–1.
 */
export const galleryParticleConfig = {
  /** Particles per specimen, rounded to a square power of two: 65536 = 256². */
  particleCount: 65536,
  /** Size multiplier over the size that exactly tiles the silhouette. 0.6–1.5. */
  particleSize: 1,
  /** 0–1. */
  particleOpacity: 1,
  /** How far the loosened dust drifts, as a fraction of the specimen's radius (most stay nearer). 0–1. */
  spread: 0.26,
  /** Upward drift, as a fraction of the radius. 0–0.3. */
  lift: 0.07,
  /** Swirl around the centre, radians. 0–1. */
  swirl: 0.3,
  /** Particle size while loosened, relative to its size in a specimen (finer dust). 0.2–1. */
  dust: 0.72,
  /** px: depth drift. 0–60. */
  depth: 14,
  /** 0–0.15: how much regions are offset in time (noise-driven). */
  stagger: 0.12,
  /** Total length, s. The curves are fractions of it, so shorter keeps the same shape. */
  duration: 1.5,
  /** Timeline window in which the live incoming specimen fades in while the cloud slows to rest. */
  handoff: [0.62, 1] as [number, number],
  /** Quarter the particle count and capture size on low-tier devices. */
  adaptiveQuality: true,
};

export type GalleryParticleConfig = typeof galleryParticleConfig;
