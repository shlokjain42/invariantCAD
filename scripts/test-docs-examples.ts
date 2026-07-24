import assert from "node:assert/strict";

const { parametricBoxSummary } = await import(
  "../examples/docs/parametric-box.js"
);
assert.equal(parametricBoxSummary.volume, 6_000);
assert.ok(parametricBoxSummary.stlBytes > 84);

const { mountingPlateSummary } = await import(
  "../examples/docs/mounting-plate.js"
);
const expectedExactVolume = (100 * 50 - Math.PI * 5 ** 2) * 6;
assert.ok(
  Math.abs(mountingPlateSummary.defaultVolume - expectedExactVolume) < 2,
);
assert.ok(mountingPlateSummary.defaultStlBytes > 84);
assert.ok(
  Math.abs(mountingPlateSummary.exactVolume - expectedExactVolume) < 1e-6,
);
assert.ok(mountingPlateSummary.stepBytes > 1_000);
assert.match(mountingPlateSummary.stepHeader, /ISO-10303-21/u);

console.log("Documentation examples passed portable and exact runtime checks.");
