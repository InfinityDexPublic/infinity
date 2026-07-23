/* Mutable bridge between React (zone changes) and the 3D scene
   (read every frame, no re-renders). */
export const zoneBus = {
  zone: 'home',
  warp: 0,           // damped by the scene each frame
  warpTarget: 0,     // set by the zone machine during transitions
  spinTarget: 0,     // radians; += one full turn per zone change, always a
                     // multiple of 2π so the ∞ settles facing the camera
}

/* Where the ∞ centerpiece lives in each zone: [x, y, z], scale */
export const ZONE_RIG = {
  home: { pos: [0, 0, 0], scale: 1 },
  launch: { pos: [3.4, 0.3, -1.2], scale: 0.72 },
  pools: { pos: [0, 1.9, -4.5], scale: 0.55 },
  swap: { pos: [-3.6, 0.2, -1.6], scale: 0.68 },
  claim: { pos: [0, -1.6, -3.5], scale: 0.6 },
  docs: { pos: [0, 3.2, -7], scale: 0.4 },
}
