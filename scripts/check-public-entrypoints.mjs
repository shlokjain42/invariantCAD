import {
  PUBLIC_ENTRYPOINTS,
  validatePublicEntrypoints,
} from "./public-entrypoints.mjs";

await validatePublicEntrypoints();
console.log(
  `Verified the public entry-point manifest for ${PUBLIC_ENTRYPOINTS.length} JavaScript exports.`,
);
