declare module "occt-wasm/dist/occt-wasm.js" {
  interface OcctModuleOptions {
    readonly wasmBinary?: ArrayBuffer;
    readonly locateFile?: (path: string) => string;
    readonly print?: (message: string) => void;
    readonly printErr?: (message: string) => void;
  }

  const createOcctModule: (
    options?: OcctModuleOptions,
  ) => Promise<unknown>;

  export default createOcctModule;
}
