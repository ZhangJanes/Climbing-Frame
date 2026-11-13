/** Grid is in modules. 1 unit = 1 module = pitch mm. */
export const MAX = { x: 12, y: 6, z: 10 };

/** Visual estimates from the product photos, not printed specs. */
export const JOINT_MM = 52;
export const TUBE_MM = 40;

export function jointUnits(pitch: number) {
  return JOINT_MM / pitch;
}

export function tubeRadius(pitch: number) {
  return TUBE_MM / 2 / pitch;
}

/** Node centers sit half a joint above the floor so the bottom joint rests on y = 0. */
export function nodePos(x: number, y: number, z: number, pitch: number): [number, number, number] {
  return [x, y + jointUnits(pitch) / 2, z];
}

export function inNode(x: number, y: number, z: number) {
  return x >= 0 && y >= 0 && z >= 0 && x <= MAX.x && y <= MAX.y && z <= MAX.z;
}
