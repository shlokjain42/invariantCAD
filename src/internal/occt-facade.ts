import {
  INDEXED_TOPOLOGY_KIND,
  INDEXED_TOPOLOGY_RELATION,
} from "./topology-evolution.js";
import type {
  OcctDraftFacadeModule,
  OcctDraftRawKernel,
} from "./occt-draft.js";
import type { OcctBooleanFacadeModule } from "./occt-boolean.js";

export const OCCT_DRAFT_FACADE_VERSION =
  "invariantcad-facade@0.2.0+occt-wasm.3.7.0";

export const OCCT_CONTROLLED_PIPE_SHELL_FACADE_VERSION =
  "invariantcad-facade@0.3.0+occt-wasm.3.7.0";

export const OCCT_BOOLEAN_FACADE_VERSION =
  "invariantcad-facade@0.4.0+occt-wasm.3.7.0";

const DRAFT_FACADE_MARKERS = Object.freeze([
  "InvariantCadDraftReport",
  "InvariantCadTopologyKind",
  "InvariantCadTopologyRelation",
  "invariantcadDraftFacesAtomic",
  "invariantcadFacadeVersion",
] as const);

const CONTROLLED_PIPE_SHELL_FACADE_MARKERS = Object.freeze([
  ...DRAFT_FACADE_MARKERS,
  "InvariantCadPipeShellReport",
  "invariantcadPipeShellSolid",
] as const);

const BOOLEAN_FACADE_MARKERS = Object.freeze([
  ...CONTROLLED_PIPE_SHELL_FACADE_MARKERS,
  "InvariantCadBooleanOperation",
  "InvariantCadBooleanReport",
  "invariantcadBooleanAtomic",
] as const);

const TOPOLOGY_KIND_MEMBERS = Object.freeze({
  NONE: INDEXED_TOPOLOGY_KIND.NONE,
  FACE: INDEXED_TOPOLOGY_KIND.FACE,
  EDGE: INDEXED_TOPOLOGY_KIND.EDGE,
  VERTEX: INDEXED_TOPOLOGY_KIND.VERTEX,
});

const TOPOLOGY_RELATION_MEMBERS = Object.freeze({
  PRESERVED: INDEXED_TOPOLOGY_RELATION.PRESERVED,
  MODIFIED: INDEXED_TOPOLOGY_RELATION.MODIFIED,
  GENERATED: INDEXED_TOPOLOGY_RELATION.GENERATED,
  DELETED: INDEXED_TOPOLOGY_RELATION.DELETED,
  CREATED: INDEXED_TOPOLOGY_RELATION.CREATED,
});

const BOOLEAN_OPERATION_MEMBERS = Object.freeze({
  UNION: 0,
  SUBTRACT: 1,
  INTERSECT: 2,
});

/** Structural view of the controlled PipeShell report returned by Embind. */
export interface OcctPipeShellRawReport {
  readonly ok: unknown;
  readonly stage: unknown;
  readonly code: unknown;
  readonly message: unknown;
  readonly occtStatus: unknown;
  readonly errorOnSurface: unknown;
  readonly tolerance3d: unknown;
  readonly boundaryTolerance: unknown;
  readonly angularTolerance: unknown;
  readonly buildCount: unknown;
  readonly solidificationCount: unknown;
  hasResult(): unknown;
  transferCode(kernel: OcctDraftRawKernel): unknown;
  takeResultId(kernel: OcctDraftRawKernel): unknown;
  delete(): void;
}

/** Exact ABI 0.3 module: atomic draft plus controlled transactional PipeShell. */
export interface OcctControlledPipeShellFacadeModule
  extends OcctDraftFacadeModule {
  readonly InvariantCadPipeShellReport: Function;
  invariantcadPipeShellSolid(
    kernel: OcctDraftRawKernel,
    profileWireId: number,
    spineWireId: number,
    tolerance3d: number,
    boundaryTolerance: number,
    angularTolerance: number,
  ): OcctPipeShellRawReport;
}

export interface OcctDraftFacadeProbe {
  readonly abi: "0.2";
  readonly version: typeof OCCT_DRAFT_FACADE_VERSION;
  readonly module: OcctDraftFacadeModule;
  readonly draft: OcctDraftFacadeModule;
  readonly pipeShell: undefined;
  readonly boolean: undefined;
}

export interface OcctControlledPipeShellFacadeProbe {
  readonly abi: "0.3";
  readonly version: typeof OCCT_CONTROLLED_PIPE_SHELL_FACADE_VERSION;
  readonly module: OcctControlledPipeShellFacadeModule;
  readonly draft: OcctDraftFacadeModule;
  readonly pipeShell: OcctControlledPipeShellFacadeModule;
  readonly boolean: undefined;
}

export interface OcctBooleanFacadeProbe {
  readonly abi: "0.4";
  readonly version: typeof OCCT_BOOLEAN_FACADE_VERSION;
  readonly module: OcctBooleanFacadeModule;
  readonly draft: OcctDraftFacadeModule;
  readonly pipeShell: OcctControlledPipeShellFacadeModule;
  readonly boolean: OcctBooleanFacadeModule;
}

export type OcctFacadeProbe =
  | OcctDraftFacadeProbe
  | OcctControlledPipeShellFacadeProbe
  | OcctBooleanFacadeProbe;

/**
 * Kept under its original name so callers that catch the 0.2 probe error do
 * not break. The error now covers every version of the owned facade surface.
 */
export class OcctDraftFacadeProtocolError extends Error {
  constructor(message: string) {
    super(`Invalid InvariantCAD OCCT facade: ${message}`);
    this.name = "OcctDraftFacadeProtocolError";
  }
}

export { OcctDraftFacadeProtocolError as OcctFacadeProtocolError };

function facadeProtocolError(message: string): never {
  throw new OcctDraftFacadeProtocolError(message);
}

function isObject(value: unknown): value is Record<PropertyKey, unknown> {
  return (typeof value === "object" && value !== null) || typeof value === "function";
}

function exactOwnNames(
  value: unknown,
  expected: readonly string[],
  label: string,
): asserts value is Record<string, unknown> {
  if (!isObject(value)) facadeProtocolError(`${label} must be an object`);
  const actual = Object.getOwnPropertyNames(value).sort();
  const wanted = [...expected].sort();
  if (
    actual.length !== wanted.length ||
    actual.some((name, index) => name !== wanted[index])
  ) {
    facadeProtocolError(
      `${label} members are '${actual.join(",")}', expected '${wanted.join(",")}'`,
    );
  }
}

function assertExactNumericEnum(
  value: unknown,
  expected: Readonly<Record<string, number>>,
  label: string,
): void {
  exactOwnNames(value, Object.keys(expected), label);
  for (const [name, number] of Object.entries(expected)) {
    if (typeof value[name] !== "number" || !Object.is(value[name], number)) {
      facadeProtocolError(`${label}.${name} must be the number ${number}`);
    }
  }
}

function exactMarkerSet(
  markers: readonly string[],
  expected: readonly string[],
): boolean {
  const wanted = [...expected].sort();
  return (
    markers.length === wanted.length &&
    markers.every((name, index) => name === wanted[index])
  );
}

function validateDraftSurface(candidate: Record<string, unknown>): void {
  if (typeof candidate.VectorUint32 !== "function") {
    facadeProtocolError("VectorUint32 must be an Embind constructor");
  }
  if (typeof candidate.InvariantCadDraftReport !== "function") {
    facadeProtocolError("InvariantCadDraftReport must be an Embind class marker");
  }
  if (typeof candidate.invariantcadFacadeVersion !== "function") {
    facadeProtocolError("invariantcadFacadeVersion must be a function");
  }
  if (typeof candidate.invariantcadDraftFacesAtomic !== "function") {
    facadeProtocolError("invariantcadDraftFacesAtomic must be a function");
  }
  assertExactNumericEnum(
    candidate.InvariantCadTopologyKind,
    TOPOLOGY_KIND_MEMBERS,
    "InvariantCadTopologyKind",
  );
  assertExactNumericEnum(
    candidate.InvariantCadTopologyRelation,
    TOPOLOGY_RELATION_MEMBERS,
    "InvariantCadTopologyRelation",
  );
}

function validateControlledPipeShellSurface(
  candidate: Record<string, unknown>,
): void {
  if (typeof candidate.InvariantCadPipeShellReport !== "function") {
    facadeProtocolError(
      "InvariantCadPipeShellReport must be an Embind class marker",
    );
  }
  if (typeof candidate.invariantcadPipeShellSolid !== "function") {
    facadeProtocolError("invariantcadPipeShellSolid must be a function");
  }
}

function validateBooleanSurface(candidate: Record<string, unknown>): void {
  if (typeof candidate.InvariantCadBooleanReport !== "function") {
    facadeProtocolError(
      "InvariantCadBooleanReport must be an Embind class marker",
    );
  }
  if (typeof candidate.invariantcadBooleanAtomic !== "function") {
    facadeProtocolError("invariantcadBooleanAtomic must be a function");
  }
  assertExactNumericEnum(
    candidate.InvariantCadBooleanOperation,
    BOOLEAN_OPERATION_MEMBERS,
    "InvariantCadBooleanOperation",
  );
}

/**
 * Detects only a complete, known owned facade. Marker-free modules are stock
 * OCCT and return `undefined`; partial, extended, mixed-version, and unknown
 * marker namespaces fail closed.
 */
export function probeOcctFacade(module: unknown): OcctFacadeProbe | undefined {
  if (!isObject(module)) facadeProtocolError("module must be an object");
  const markers = Object.getOwnPropertyNames(module)
    .filter((name) => /^invariantcad/iu.test(name))
    .sort();
  if (markers.length === 0) return undefined;

  const isDraft = exactMarkerSet(markers, DRAFT_FACADE_MARKERS);
  const isControlledPipeShell = exactMarkerSet(
    markers,
    CONTROLLED_PIPE_SHELL_FACADE_MARKERS,
  );
  const isBoolean = exactMarkerSet(markers, BOOLEAN_FACADE_MARKERS);
  if (!isDraft && !isControlledPipeShell && !isBoolean) {
    facadeProtocolError(
      `marker set is '${markers.join(",")}', expected exact ABI 0.2, 0.3, or 0.4 markers`,
    );
  }

  const candidate = module as Record<string, unknown>;
  validateDraftSurface(candidate);
  if (isControlledPipeShell || isBoolean) {
    validateControlledPipeShellSurface(candidate);
  }
  if (isBoolean) validateBooleanSurface(candidate);

  const rawVersion = candidate.invariantcadFacadeVersion as () => unknown;
  const version = rawVersion();
  const expectedVersion = isBoolean
    ? OCCT_BOOLEAN_FACADE_VERSION
    : isControlledPipeShell
      ? OCCT_CONTROLLED_PIPE_SHELL_FACADE_VERSION
      : OCCT_DRAFT_FACADE_VERSION;
  if (version !== expectedVersion) {
    facadeProtocolError(
      `version is '${String(version)}', expected '${expectedVersion}'`,
    );
  }

  if (isBoolean) {
    const booleanModule = module as unknown as OcctBooleanFacadeModule;
    return Object.freeze({
      abi: "0.4" as const,
      version: OCCT_BOOLEAN_FACADE_VERSION,
      module: booleanModule,
      draft: booleanModule as unknown as OcctDraftFacadeModule,
      pipeShell: booleanModule as unknown as OcctControlledPipeShellFacadeModule,
      boolean: booleanModule,
    });
  }

  if (isControlledPipeShell) {
    const controlledModule =
      module as unknown as OcctControlledPipeShellFacadeModule;
    return Object.freeze({
      abi: "0.3" as const,
      version: OCCT_CONTROLLED_PIPE_SHELL_FACADE_VERSION,
      module: controlledModule,
      draft: controlledModule,
      pipeShell: controlledModule,
      boolean: undefined,
    });
  }

  const draftModule = module as unknown as OcctDraftFacadeModule;
  return Object.freeze({
    abi: "0.2" as const,
    version: OCCT_DRAFT_FACADE_VERSION,
    module: draftModule,
    draft: draftModule,
    pipeShell: undefined,
    boolean: undefined,
  });
}

/** Compatibility projection used by the existing atomic-draft integration. */
export function probeOcctDraftFacade(
  module: unknown,
): OcctDraftFacadeModule | undefined {
  return probeOcctFacade(module)?.draft;
}
