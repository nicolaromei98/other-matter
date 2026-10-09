import * as THREE from 'three';
import { mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';

/**
 * Indexed, seamless unit sphere (UV seam welded) so per-vertex displacement
 * never cracks along the meridian. Every specimen body starts from this and
 * gets its organic form in the vertex shader.
 */
export function weldedSphere(widthSegments: number, heightSegments: number): THREE.BufferGeometry {
  const g = new THREE.SphereGeometry(1, widthSegments, heightSegments);
  g.deleteAttribute('uv');
  g.deleteAttribute('normal');
  const w = mergeVertices(g, 1e-5);
  // unit sphere: the normal is the position
  w.setAttribute('normal', (w.attributes.position as THREE.BufferAttribute).clone());
  return w;
}
