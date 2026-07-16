export type Vec2 = readonly [number, number];
export type Vec3 = readonly [number, number, number];
export type Mat4 = readonly [
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
];

export const IDENTITY_MATRIX: Mat4 = [
  1, 0, 0, 0,
  0, 1, 0, 0,
  0, 0, 1, 0,
  0, 0, 0, 1,
];

export function add2(a: Vec2, b: Vec2): Vec2 {
  return [a[0] + b[0], a[1] + b[1]];
}

export function subtract2(a: Vec2, b: Vec2): Vec2 {
  return [a[0] - b[0], a[1] - b[1]];
}

export function length2(value: Vec2): number {
  return Math.hypot(value[0], value[1]);
}

export function distance2(a: Vec2, b: Vec2): number {
  return length2(subtract2(a, b));
}

export function dot2(a: Vec2, b: Vec2): number {
  return a[0] * b[0] + a[1] * b[1];
}

export function cross2(a: Vec2, b: Vec2): number {
  return a[0] * b[1] - a[1] * b[0];
}

export function transformPoint(point: Vec3, matrix: Mat4): Vec3 {
  const [x, y, z] = point;
  return [
    matrix[0] * x + matrix[4] * y + matrix[8] * z + matrix[12],
    matrix[1] * x + matrix[5] * y + matrix[9] * z + matrix[13],
    matrix[2] * x + matrix[6] * y + matrix[10] * z + matrix[14],
  ];
}

export function multiplyMatrices(a: Mat4, b: Mat4): Mat4 {
  const result = new Array<number>(16).fill(0);
  for (let column = 0; column < 4; column += 1) {
    for (let row = 0; row < 4; row += 1) {
      for (let inner = 0; inner < 4; inner += 1) {
        const index = column * 4 + row;
        result[index] = result[index]! +
          a[inner * 4 + row]! * b[column * 4 + inner]!;
      }
    }
  }
  return result as unknown as Mat4;
}

export function translationMatrix([x, y, z]: Vec3): Mat4 {
  return [
    1, 0, 0, 0,
    0, 1, 0, 0,
    0, 0, 1, 0,
    x, y, z, 1,
  ];
}

export function scaleMatrix([x, y, z]: Vec3): Mat4 {
  return [
    x, 0, 0, 0,
    0, y, 0, 0,
    0, 0, z, 0,
    0, 0, 0, 1,
  ];
}

export function rotationMatrix([x, y, z]: Vec3): Mat4 {
  const sx = Math.sin(x);
  const cx = Math.cos(x);
  const sy = Math.sin(y);
  const cy = Math.cos(y);
  const sz = Math.sin(z);
  const cz = Math.cos(z);

  const rx: Mat4 = [
    1, 0, 0, 0,
    0, cx, sx, 0,
    0, -sx, cx, 0,
    0, 0, 0, 1,
  ];
  const ry: Mat4 = [
    cy, 0, -sy, 0,
    0, 1, 0, 0,
    sy, 0, cy, 0,
    0, 0, 0, 1,
  ];
  const rz: Mat4 = [
    cz, sz, 0, 0,
    -sz, cz, 0, 0,
    0, 0, 1, 0,
    0, 0, 0, 1,
  ];
  return multiplyMatrices(rz, multiplyMatrices(ry, rx));
}

export function composeTransform(
  translation: Vec3,
  rotation: Vec3,
  scale: Vec3,
): Mat4 {
  return multiplyMatrices(
    translationMatrix(translation),
    multiplyMatrices(rotationMatrix(rotation), scaleMatrix(scale)),
  );
}
