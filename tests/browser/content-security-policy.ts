/**
 * Content Security Policy served with every production browser-smoke
 * response. It must stay identical to the example policy documented in
 * docs/evaluation/browser-and-workers.mdx.
 *
 * - `'wasm-unsafe-eval'` permits WebAssembly compilation.
 * - `'unsafe-eval'` is required because the bundled Manifold and stock
 *   occt-wasm Embind glue generate binding invokers with `new Function`
 *   while the runtime initializes.
 * - `blob:` permits the attested OCCT browser loader's Blob module import.
 */
export const BROWSER_SMOKE_CONTENT_SECURITY_POLICY =
  "script-src 'self' blob: 'wasm-unsafe-eval' 'unsafe-eval'";
