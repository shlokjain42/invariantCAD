/**
 * Content Security Policy served with every production browser-smoke
 * response. smoke.spec.ts checks that the example policies in
 * docs/evaluation/browser-and-workers.mdx and
 * docs/evaluation/occt-runtime-attestation.mdx stay identical to it.
 *
 * - `'wasm-unsafe-eval'` permits WebAssembly compilation.
 * - `'unsafe-eval'` is required because the bundled Manifold and stock
 *   occt-wasm Embind glue generate binding invokers with `new Function`
 *   while the runtime initializes.
 * - `blob:` permits the attested OCCT browser loader's Blob module import.
 */
export const BROWSER_SMOKE_CONTENT_SECURITY_POLICY =
  "script-src 'self' blob: 'wasm-unsafe-eval' 'unsafe-eval'";
