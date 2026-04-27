import * as THREE from 'three';
import { STLExporter } from 'three/examples/jsm/exporters/STLExporter.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { LithopaneGeometry } from './LithopaneMesh';

/**
 * Export a LithopaneGeometry (body + notches) as binary STL and trigger download.
 */
export function exportSTL(lithoGeo: LithopaneGeometry, filename = 'lithopane.stl') {
  // Merge body + notches for export (notches are always included in the STL)
  const geos = [lithoGeo.body];
  if (lithoGeo.notches) geos.push(lithoGeo.notches);
  const geometry = geos.length > 1 ? mergeGeometries(geos, false) ?? lithoGeo.body : lithoGeo.body;

  const material = new THREE.MeshBasicMaterial();
  const mesh = new THREE.Mesh(geometry, material);
  const exporter = new STLExporter();
  const buffer = exporter.parse(mesh, { binary: true });
  material.dispose();
  // Dispose merged geometry only if we created a new one
  if (geometry !== lithoGeo.body) geometry.dispose();

  const blob = new Blob([buffer], { type: 'application/octet-stream' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
