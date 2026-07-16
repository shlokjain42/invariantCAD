declare module "occt-wasm/dist/occt-wasm.js" {
  export interface OcctModuleOptions {
    readonly wasmBinary?: ArrayBuffer;
    readonly locateFile?: (path: string) => string;
    readonly print?: (message: string) => void;
    readonly printErr?: (message: string) => void;
  }

  export type OcctModuleFactory = (
    options?: OcctModuleOptions,
  ) => Promise<unknown>;

  const createOcctModule: OcctModuleFactory;

  export default createOcctModule;
}
