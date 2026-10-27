import {
  diagnostic,
  failure,
  success,
  type CadResult,
  type Diagnostic,
} from "../core/result.js";
import type { DesignDocument } from "../ir.js";

const IntrinsicArray = Array;
const IntrinsicMap = Map;
const IntrinsicObject = Object;
const IntrinsicReflect = Reflect;
const IntrinsicSet = Set;
const intrinsicArrayIsArray = IntrinsicArray.isArray;
const intrinsicArraySort = IntrinsicArray.prototype.sort;
const intrinsicObjectCreate = IntrinsicObject.create;
const intrinsicObjectHasOwn = IntrinsicObject.hasOwn;
const intrinsicObjectKeys = IntrinsicObject.keys;
const intrinsicReflectApply = IntrinsicReflect.apply;
const intrinsicStringCharCodeAt = String.prototype.charCodeAt;
const intrinsicMapGet = IntrinsicMap.prototype.get;
const intrinsicMapHas = IntrinsicMap.prototype.has;
const intrinsicMapSet = IntrinsicMap.prototype.set;
const intrinsicSetAdd = IntrinsicSet.prototype.add;
const intrinsicSetHas = IntrinsicSet.prototype.has;

const PHASE = "documentV7IdentityRenames";
const MAP_PATH = "/identityRenames";
const MAX_INSTANCE_INDEX = 2 ** 32 - 2;

/** Identity namespaces that a legacy document may need to rename for v7. */
export type DocumentV7IdentityRenameKind =
  | "parameter"
  | "node"
  | "output"
  | "sketch-entity"
  | "sketch-constraint"
  | "assembly-occurrence";

/**
 * Caller-authored renames for legacy identities that Document v7 cannot carry.
 *
 * Flat maps are keyed by legacy ID. Sketch maps are keyed by legacy sketch
 * node ID, then legacy entity or constraint ID. Occurrence maps are keyed by
 * legacy assembly node ID, then decimal instance index, because a legacy
 * assembly may repeat one occurrence ID.
 */
export interface DocumentV7IdentityRenames {
  readonly parameters?: Readonly<Record<string, string>>;
  readonly nodes?: Readonly<Record<string, string>>;
  readonly outputs?: Readonly<Record<string, string>>;
  readonly sketchEntities?: Readonly<
    Record<string, Readonly<Record<string, string>>>
  >;
  readonly sketchConstraints?: Readonly<
    Record<string, Readonly<Record<string, string>>>
  >;
  readonly assemblyOccurrences?: Readonly<
    Record<string, Readonly<Record<string, string>>>
  >;
}

/** One rename applied during migration, in deterministic order. */
export interface AppliedDocumentV7IdentityRename {
  readonly kind: DocumentV7IdentityRenameKind;
  readonly from: string;
  readonly to: string;
  /** Legacy and migrated IDs of the containing sketch or assembly node. */
  readonly scope?: { readonly from: string; readonly to: string };
  /** Position of a renamed occurrence in its assembly's instance list. */
  readonly instanceIndex?: number;
  /** Output names are selected by callers and external documents. */
  readonly consumerVisible: boolean;
}

interface FlatRenames {
  readonly entries: ReadonlyMap<string, string>;
}

/** A validated rename plan bound to one legacy document. */
export interface DocumentV7IdentityRenamePlan {
  readonly parameters: ReadonlyMap<string, string>;
  readonly nodes: ReadonlyMap<string, string>;
  readonly outputs: ReadonlyMap<string, string>;
  readonly sketchEntities: ReadonlyMap<string, ReadonlyMap<string, string>>;
  readonly sketchConstraints: ReadonlyMap<
    string,
    ReadonlyMap<string, string>
  >;
  readonly assemblyOccurrences: ReadonlyMap<
    string,
    ReadonlyMap<number, string>
  >;
  readonly applied: readonly AppliedDocumentV7IdentityRename[];
}

type CapturedScopedRenames = ReadonlyMap<string, FlatRenames>;

interface CapturedRenames {
  readonly parameters: FlatRenames;
  readonly nodes: FlatRenames;
  readonly outputs: FlatRenames;
  readonly sketchEntities: CapturedScopedRenames;
  readonly sketchConstraints: CapturedScopedRenames;
  readonly assemblyOccurrences: CapturedScopedRenames;
}

const FLAT_FIELDS = ["parameters", "nodes", "outputs"] as const;
const SCOPED_FIELDS = [
  "sketchEntities",
  "sketchConstraints",
  "assemblyOccurrences",
] as const;

function reflectApply(
  target: (...arguments_: never[]) => unknown,
  receiver: unknown,
  arguments_: readonly unknown[],
): unknown {
  return intrinsicReflectApply(target, receiver, arguments_);
}

function objectKeys(value: object): string[] {
  return reflectApply(intrinsicObjectKeys, IntrinsicObject, [
    value,
  ]) as string[];
}

function objectHasOwn(value: object, key: PropertyKey): boolean {
  return reflectApply(intrinsicObjectHasOwn, IntrinsicObject, [
    value,
    key,
  ]) as boolean;
}

function objectCreateNull<T>(): Record<string, T> {
  return reflectApply(intrinsicObjectCreate, IntrinsicObject, [
    null,
  ]) as Record<string, T>;
}

function isArray(value: unknown): value is readonly unknown[] {
  return reflectApply(intrinsicArrayIsArray, IntrinsicArray, [
    value,
  ]) as boolean;
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !isArray(value);
}

function mapGet<K, V>(map: ReadonlyMap<K, V>, key: K): V | undefined {
  return reflectApply(intrinsicMapGet, map, [key]) as V | undefined;
}

function mapHas<K, V>(map: ReadonlyMap<K, V>, key: K): boolean {
  return reflectApply(intrinsicMapHas, map, [key]) as boolean;
}

function mapSet<K, V>(map: Map<K, V>, key: K, value: V): void {
  reflectApply(intrinsicMapSet, map, [key, value]);
}

function setAdd<T>(set: Set<T>, value: T): void {
  reflectApply(intrinsicSetAdd, set, [value]);
}

function setHas<T>(set: ReadonlySet<T>, value: T): boolean {
  return reflectApply(intrinsicSetHas, set, [value]) as boolean;
}

function append<T>(values: T[], value: T): void {
  values[values.length] = value;
}

function stringCharCodeAt(value: string, index: number): number {
  return reflectApply(intrinsicStringCharCodeAt, value, [index]) as number;
}

/** The Document v7 identifier grammar `^[A-Za-z][A-Za-z0-9._:-]*$`. */
function isDocumentV7Id(value: string): boolean {
  if (value.length === 0) return false;
  for (let index = 0; index < value.length; index += 1) {
    const code = stringCharCodeAt(value, index);
    const letter =
      (code >= 0x41 && code <= 0x5a) || (code >= 0x61 && code <= 0x7a);
    if (index === 0) {
      if (!letter) return false;
      continue;
    }
    if (
      !letter &&
      !(code >= 0x30 && code <= 0x39) &&
      code !== 0x2d &&
      code !== 0x2e &&
      code !== 0x3a &&
      code !== 0x5f
    ) {
      return false;
    }
  }
  return true;
}

function jsonPointerSegment(value: string): string {
  let escaped = "";
  for (let index = 0; index < value.length; index += 1) {
    const code = stringCharCodeAt(value, index);
    escaped += code === 0x7e ? "~0" : code === 0x2f ? "~1" : value[index];
  }
  return escaped;
}

function lexicalCompare(first: string, second: string): number {
  return first < second ? -1 : first > second ? 1 : 0;
}

function renameError(
  message: string,
  path: string,
  reason: string,
  details: Readonly<Record<string, unknown>> = {},
): Diagnostic {
  return diagnostic("IR_INVALID", message, {
    severity: "error",
    path,
    details: { phase: PHASE, reason, ...details },
  });
}

function captureFlat(
  value: unknown,
  path: string,
  diagnostics: Diagnostic[],
): FlatRenames {
  const entries = new IntrinsicMap<string, string>();
  if (value === undefined) return { entries };
  if (!isRecord(value)) {
    append(
      diagnostics,
      renameError(
        "Identity renames must be a record of legacy ID to Document v7 ID",
        path,
        "identity-rename-map-malformed",
      ),
    );
    return { entries };
  }
  const keys = objectKeys(value);
  for (let index = 0; index < keys.length; index += 1) {
    const key = keys[index]!;
    const target = value[key];
    if (typeof target !== "string") {
      append(
        diagnostics,
        renameError(
          "Identity rename targets must be strings",
          `${path}/${jsonPointerSegment(key)}`,
          "identity-rename-map-malformed",
        ),
      );
      continue;
    }
    mapSet(entries, key, target);
  }
  return { entries };
}

function captureScoped(
  value: unknown,
  path: string,
  diagnostics: Diagnostic[],
): CapturedScopedRenames {
  const scopes = new IntrinsicMap<string, FlatRenames>();
  if (value === undefined) return scopes;
  if (!isRecord(value)) {
    append(
      diagnostics,
      renameError(
        "Scoped identity renames must be a record keyed by legacy node ID",
        path,
        "identity-rename-map-malformed",
      ),
    );
    return scopes;
  }
  const keys = objectKeys(value);
  for (let index = 0; index < keys.length; index += 1) {
    const key = keys[index]!;
    mapSet(
      scopes,
      key,
      captureFlat(
        value[key],
        `${path}/${jsonPointerSegment(key)}`,
        diagnostics,
      ),
    );
  }
  return scopes;
}

/**
 * Validates the shape of a detached, bounded rename-map snapshot. The caller
 * must already have captured it as plain own data without invoking accessors.
 */
export function captureDocumentV7IdentityRenames(
  snapshot: unknown,
): CadResult<CapturedRenames> {
  const diagnostics: Diagnostic[] = [];
  if (!isRecord(snapshot)) {
    return failure(
      renameError(
        "Identity renames must be a record",
        MAP_PATH,
        "identity-rename-map-malformed",
      ),
    );
  }
  const keys = objectKeys(snapshot);
  for (let index = 0; index < keys.length; index += 1) {
    const key = keys[index]!;
    let known = false;
    for (const field of [...FLAT_FIELDS, ...SCOPED_FIELDS]) {
      if (field === key) known = true;
    }
    if (!known) {
      append(
        diagnostics,
        renameError(
          `Unknown identity rename namespace '${key}'`,
          `${MAP_PATH}/${jsonPointerSegment(key)}`,
          "identity-rename-map-malformed",
        ),
      );
    }
  }
  const captured: CapturedRenames = {
    parameters: captureFlat(
      snapshot.parameters,
      `${MAP_PATH}/parameters`,
      diagnostics,
    ),
    nodes: captureFlat(snapshot.nodes, `${MAP_PATH}/nodes`, diagnostics),
    outputs: captureFlat(snapshot.outputs, `${MAP_PATH}/outputs`, diagnostics),
    sketchEntities: captureScoped(
      snapshot.sketchEntities,
      `${MAP_PATH}/sketchEntities`,
      diagnostics,
    ),
    sketchConstraints: captureScoped(
      snapshot.sketchConstraints,
      `${MAP_PATH}/sketchConstraints`,
      diagnostics,
    ),
    assemblyOccurrences: captureScoped(
      snapshot.assemblyOccurrences,
      `${MAP_PATH}/assemblyOccurrences`,
      diagnostics,
    ),
  };
  return diagnostics.length > 0
    ? { ok: false, diagnostics: sortDiagnostics(diagnostics) }
    : success(captured);
}

/** Whether a captured map requests no rename at all. */
export function documentV7IdentityRenamesAreEmpty(
  captured: CapturedRenames,
): boolean {
  if (
    captured.parameters.entries.size > 0 ||
    captured.nodes.entries.size > 0 ||
    captured.outputs.entries.size > 0
  ) {
    return false;
  }
  for (const scoped of [
    captured.sketchEntities,
    captured.sketchConstraints,
    captured.assemblyOccurrences,
  ]) {
    for (const renames of scoped.values()) {
      if (renames.entries.size > 0) return false;
    }
  }
  return true;
}

interface NamespaceRule {
  readonly kind: DocumentV7IdentityRenameKind;
  readonly label: string;
  readonly mapPath: string;
  /** Existing source IDs in this namespace. */
  readonly existing: readonly string[];
}

/**
 * Checks one flat namespace: every source exists and blocks v7, every target
 * is a v7 ID, targets are unique, and no target collides with a retained ID.
 */
function planFlatNamespace(
  rule: NamespaceRule,
  renames: FlatRenames,
  diagnostics: Diagnostic[],
): Map<string, string> {
  const planned = new IntrinsicMap<string, string>();
  const existing = new IntrinsicSet<string>();
  for (let index = 0; index < rule.existing.length; index += 1) {
    setAdd(existing, rule.existing[index]!);
  }
  const targets = new IntrinsicMap<string, string>();
  for (const [from, to] of renames.entries) {
    const path = `${rule.mapPath}/${jsonPointerSegment(from)}`;
    if (!setHas(existing, from)) {
      append(
        diagnostics,
        renameError(
          `${rule.label} '${from}' does not exist in the legacy document or its stored topology evidence`,
          path,
          "identity-rename-unknown-source",
          { identityKind: rule.kind, identity: from },
        ),
      );
      continue;
    }
    if (isDocumentV7Id(from)) {
      append(
        diagnostics,
        renameError(
          `${rule.label} '${from}' is already a Document v7 ID and must keep its identity`,
          path,
          "identity-rename-not-required",
          { identityKind: rule.kind, identity: from },
        ),
      );
      continue;
    }
    if (!isDocumentV7Id(to)) {
      append(
        diagnostics,
        renameError(
          `Rename target '${to}' for ${rule.label} '${from}' is not a Document v7 ID`,
          path,
          "identity-rename-invalid-target",
          { identityKind: rule.kind, identity: from, target: to },
        ),
      );
      continue;
    }
    const previous = mapGet(targets, to);
    if (previous !== undefined) {
      append(
        diagnostics,
        renameError(
          `${rule.label}s '${previous}' and '${from}' cannot both be renamed to '${to}'`,
          path,
          "identity-rename-collision",
          { identityKind: rule.kind, identity: from, target: to },
        ),
      );
      continue;
    }
    mapSet(targets, to, from);
    mapSet(planned, from, to);
  }
  for (const [to, from] of targets) {
    if (setHas(existing, to) && !mapHas(planned, to)) {
      append(
        diagnostics,
        renameError(
          `Rename target '${to}' for ${rule.label} '${from}' collides with a retained ID`,
          `${rule.mapPath}/${jsonPointerSegment(from)}`,
          "identity-rename-collision",
          { identityKind: rule.kind, identity: from, target: to },
        ),
      );
      planned.delete(from);
    }
  }
  return planned;
}

type LegacyNode = Readonly<Record<string, unknown>> & {
  readonly kind: string;
};

function legacyNodes(
  document: DesignDocument,
): Readonly<Record<string, LegacyNode>> {
  return document.nodes as unknown as Readonly<Record<string, LegacyNode>>;
}

function configurationOccurrenceReferences(
  document: DesignDocument,
  assemblyId: string,
): ReadonlySet<string> {
  const references = new IntrinsicSet<string>();
  const configurations = (document.configurations ?? {}) as Readonly<
    Record<
      string,
      {
        readonly instanceSuppressions?: Readonly<
          Record<string, Readonly<Record<string, boolean>>>
        >;
      }
    >
  >;
  const configurationIds = objectKeys(configurations);
  for (let index = 0; index < configurationIds.length; index += 1) {
    const suppressions =
      configurations[configurationIds[index]!]!.instanceSuppressions;
    if (
      suppressions === undefined ||
      !objectHasOwn(suppressions, assemblyId)
    ) {
      continue;
    }
    const occurrenceIds = objectKeys(suppressions[assemblyId]!);
    for (let occurrence = 0; occurrence < occurrenceIds.length; occurrence += 1) {
      setAdd(references, occurrenceIds[occurrence]!);
    }
  }
  return references;
}

function parseInstanceIndex(value: string): number | undefined {
  if (value.length === 0 || value.length > 10) return undefined;
  if (value.length > 1 && stringCharCodeAt(value, 0) === 0x30) {
    return undefined;
  }
  let result = 0;
  for (let index = 0; index < value.length; index += 1) {
    const code = stringCharCodeAt(value, index);
    if (code < 0x30 || code > 0x39) return undefined;
    result = result * 10 + (code - 0x30);
  }
  return result <= MAX_INSTANCE_INDEX ? result : undefined;
}

function planOccurrences(
  document: DesignDocument,
  renames: CapturedScopedRenames,
  diagnostics: Diagnostic[],
): Map<string, Map<number, string>> {
  const planned = new IntrinsicMap<string, Map<number, string>>();
  const nodes = legacyNodes(document);
  for (const [assemblyId, scoped] of renames) {
    const scopePath =
      `${MAP_PATH}/assemblyOccurrences/${jsonPointerSegment(assemblyId)}`;
    const node = objectHasOwn(nodes, assemblyId) ? nodes[assemblyId] : undefined;
    if (node === undefined || node.kind !== "assembly") {
      append(
        diagnostics,
        renameError(
          `Assembly node '${assemblyId}' does not exist in the legacy document`,
          scopePath,
          "identity-rename-unknown-source",
          { identityKind: "assembly-occurrence", scope: assemblyId },
        ),
      );
      continue;
    }
    const instances = node.instances as readonly { readonly id: string }[];
    const counts = new IntrinsicMap<string, number>();
    for (let index = 0; index < instances.length; index += 1) {
      const id = instances[index]!.id;
      mapSet(counts, id, (mapGet(counts, id) ?? 0) + 1);
    }
    const referenced = configurationOccurrenceReferences(document, assemblyId);
    const byIndex = new IntrinsicMap<number, string>();
    const targets = new IntrinsicMap<string, number>();
    for (const [key, to] of scoped.entries) {
      const path = `${scopePath}/${jsonPointerSegment(key)}`;
      const index = parseInstanceIndex(key);
      if (index === undefined || index >= instances.length) {
        append(
          diagnostics,
          renameError(
            `Assembly '${assemblyId}' has no instance at index '${key}'`,
            path,
            "identity-rename-unknown-source",
            { identityKind: "assembly-occurrence", scope: assemblyId },
          ),
        );
        continue;
      }
      const from = instances[index]!.id;
      const duplicated = (mapGet(counts, from) ?? 0) > 1;
      if (isDocumentV7Id(from) && !duplicated) {
        append(
          diagnostics,
          renameError(
            `Assembly occurrence '${from}' is already a unique Document v7 ID and must keep its identity`,
            path,
            "identity-rename-not-required",
            {
              identityKind: "assembly-occurrence",
              scope: assemblyId,
              identity: from,
              instanceIndex: index,
            },
          ),
        );
        continue;
      }
      if (setHas(referenced, from)) {
        append(
          diagnostics,
          renameError(
            `Assembly occurrence '${from}' is referenced by a configuration, so renaming one of its duplicates would change which occurrences the configuration controls`,
            path,
            "identity-rename-ambiguous-reference",
            {
              identityKind: "assembly-occurrence",
              scope: assemblyId,
              identity: from,
              instanceIndex: index,
            },
          ),
        );
        continue;
      }
      if (!isDocumentV7Id(to)) {
        append(
          diagnostics,
          renameError(
            `Rename target '${to}' for assembly occurrence '${from}' is not a Document v7 ID`,
            path,
            "identity-rename-invalid-target",
            {
              identityKind: "assembly-occurrence",
              scope: assemblyId,
              identity: from,
              instanceIndex: index,
              target: to,
            },
          ),
        );
        continue;
      }
      const previous = mapGet(targets, to);
      if (previous !== undefined) {
        append(
          diagnostics,
          renameError(
            `Assembly instances ${previous} and ${index} cannot both be renamed to '${to}'`,
            path,
            "identity-rename-collision",
            {
              identityKind: "assembly-occurrence",
              scope: assemblyId,
              instanceIndex: index,
              target: to,
            },
          ),
        );
        continue;
      }
      mapSet(targets, to, index);
      mapSet(byIndex, index, to);
    }
    for (let index = 0; index < instances.length; index += 1) {
      if (mapHas(byIndex, index)) continue;
      const retained = instances[index]!.id;
      const renamedIndex = mapGet(targets, retained);
      if (renamedIndex !== undefined) {
        append(
          diagnostics,
          renameError(
            `Rename target '${retained}' for assembly instance ${renamedIndex} collides with retained instance ${index}`,
            `${scopePath}/${renamedIndex}`,
            "identity-rename-collision",
            {
              identityKind: "assembly-occurrence",
              scope: assemblyId,
              instanceIndex: renamedIndex,
              target: retained,
            },
          ),
        );
        byIndex.delete(renamedIndex);
      }
    }
    mapSet(planned, assemblyId, byIndex);
  }
  return planned;
}

interface StoredLineageIdentities {
  /** Node IDs named by stored lineage features or source sketches. */
  readonly nodes: ReadonlySet<string>;
  /** Entity IDs named by stored lineage sources, keyed by source sketch. */
  readonly sketchEntities: ReadonlyMap<string, ReadonlySet<string>>;
}

/**
 * Collects identities named by stored topology evidence. Evidence may name
 * historical features and sketches that no longer exist as nodes.
 */
function storedLineageIdentities(
  document: DesignDocument,
): StoredLineageIdentities {
  const nodes = new IntrinsicSet<string>();
  const sketchEntities = new IntrinsicMap<string, Set<string>>();
  if (document.version === 1 || document.topologyReferences === undefined) {
    return { nodes, sketchEntities };
  }
  const visit = (
    lineage: readonly {
      readonly feature: string;
      readonly source?: { readonly sketch: string; readonly entity: string };
    }[],
  ): void => {
    for (let index = 0; index < lineage.length; index += 1) {
      const item = lineage[index]!;
      setAdd(nodes, item.feature);
      if (item.source === undefined) continue;
      setAdd(nodes, item.source.sketch);
      let entities = mapGet(sketchEntities, item.source.sketch);
      if (entities === undefined) {
        entities = new IntrinsicSet<string>();
        mapSet(sketchEntities, item.source.sketch, entities);
      }
      setAdd(entities, item.source.entity);
    }
  };
  const references = document.topologyReferences as unknown as Readonly<
    Record<
      string,
      {
        readonly variants: readonly {
          readonly lineage: Parameters<typeof visit>[0];
          readonly adjacency: readonly {
            readonly lineage: Parameters<typeof visit>[0];
          }[];
        }[];
      }
    >
  >;
  const ids = objectKeys(references);
  for (let index = 0; index < ids.length; index += 1) {
    for (const variant of references[ids[index]!]!.variants) {
      visit(variant.lineage);
      for (const neighbor of variant.adjacency) visit(neighbor.lineage);
    }
  }
  return { nodes, sketchEntities };
}

function planSketchNamespace(
  document: DesignDocument,
  renames: CapturedScopedRenames,
  field: "entities" | "constraints",
  lineage: StoredLineageIdentities,
  diagnostics: Diagnostic[],
): Map<string, Map<string, string>> {
  const kind: DocumentV7IdentityRenameKind =
    field === "entities" ? "sketch-entity" : "sketch-constraint";
  const mapField =
    field === "entities" ? "sketchEntities" : "sketchConstraints";
  const label = field === "entities" ? "Sketch entity" : "Sketch constraint";
  const planned = new IntrinsicMap<string, Map<string, string>>();
  const nodes = legacyNodes(document);
  for (const [sketchId, scoped] of renames) {
    const scopePath =
      `${MAP_PATH}/${mapField}/${jsonPointerSegment(sketchId)}`;
    const node = objectHasOwn(nodes, sketchId) ? nodes[sketchId] : undefined;
    const sketch = node !== undefined && node.kind === "sketch";
    const historical =
      field === "entities" ? mapGet(lineage.sketchEntities, sketchId) : undefined;
    if (!sketch && historical === undefined) {
      append(
        diagnostics,
        renameError(
          `Sketch '${sketchId}' does not exist in the legacy document or its stored topology evidence`,
          scopePath,
          "identity-rename-unknown-source",
          { identityKind: kind, scope: sketchId },
        ),
      );
      continue;
    }
    const existing = sketch ? objectKeys(node[field] as object) : [];
    if (historical !== undefined) {
      for (const entity of historical) append(existing, entity);
    }
    mapSet(
      planned,
      sketchId,
      planFlatNamespace(
        { kind, label, mapPath: scopePath, existing },
        scoped,
        diagnostics,
      ),
    );
  }
  return planned;
}

function sortDiagnostics(diagnostics: Diagnostic[]): Diagnostic[] {
  reflectApply(intrinsicArraySort, diagnostics, [
    (first: Diagnostic, second: Diagnostic): number =>
      lexicalCompare(first.path ?? "", second.path ?? "") ||
      lexicalCompare(first.message, second.message),
  ]);
  return diagnostics;
}

const KIND_ORDER: Readonly<Record<DocumentV7IdentityRenameKind, number>> = {
  parameter: 0,
  node: 1,
  output: 2,
  "sketch-entity": 3,
  "sketch-constraint": 4,
  "assembly-occurrence": 5,
};

function compareApplied(
  first: AppliedDocumentV7IdentityRename,
  second: AppliedDocumentV7IdentityRename,
): number {
  return (
    KIND_ORDER[first.kind] - KIND_ORDER[second.kind] ||
    lexicalCompare(first.scope?.from ?? "", second.scope?.from ?? "") ||
    (first.instanceIndex ?? -1) - (second.instanceIndex ?? -1) ||
    lexicalCompare(first.from, second.from)
  );
}

/**
 * Validates captured renames against one validated legacy document and
 * returns the deterministic plan and audit record.
 */
export function planDocumentV7IdentityRenames(
  document: DesignDocument,
  captured: CapturedRenames,
): CadResult<DocumentV7IdentityRenamePlan> {
  const diagnostics: Diagnostic[] = [];
  const lineage = storedLineageIdentities(document);
  const nodeIds = objectKeys(document.nodes);
  for (const historical of lineage.nodes) {
    if (!objectHasOwn(document.nodes, historical)) append(nodeIds, historical);
  }
  const parameters = planFlatNamespace(
    {
      kind: "parameter",
      label: "Parameter ID",
      mapPath: `${MAP_PATH}/parameters`,
      existing: objectKeys(document.parameters),
    },
    captured.parameters,
    diagnostics,
  );
  const nodes = planFlatNamespace(
    {
      kind: "node",
      label: "Node ID",
      mapPath: `${MAP_PATH}/nodes`,
      existing: nodeIds,
    },
    captured.nodes,
    diagnostics,
  );
  const outputs = planFlatNamespace(
    {
      kind: "output",
      label: "Output name",
      mapPath: `${MAP_PATH}/outputs`,
      existing: objectKeys(document.outputs),
    },
    captured.outputs,
    diagnostics,
  );
  const sketchEntities = planSketchNamespace(
    document,
    captured.sketchEntities,
    "entities",
    lineage,
    diagnostics,
  );
  const sketchConstraints = planSketchNamespace(
    document,
    captured.sketchConstraints,
    "constraints",
    lineage,
    diagnostics,
  );
  const assemblyOccurrences = planOccurrences(
    document,
    captured.assemblyOccurrences,
    diagnostics,
  );
  if (diagnostics.length > 0) {
    return { ok: false, diagnostics: sortDiagnostics(diagnostics) };
  }

  const nodeName = (id: string): string => mapGet(nodes, id) ?? id;
  const applied: AppliedDocumentV7IdentityRename[] = [];
  for (const [kind, renames] of [
    ["parameter", parameters],
    ["node", nodes],
    ["output", outputs],
  ] as const) {
    for (const [from, to] of renames) {
      append(applied, {
        kind,
        from,
        to,
        consumerVisible: kind === "output",
      });
    }
  }
  for (const [kind, scoped] of [
    ["sketch-entity", sketchEntities],
    ["sketch-constraint", sketchConstraints],
  ] as const) {
    for (const [scope, renames] of scoped) {
      for (const [from, to] of renames) {
        append(applied, {
          kind,
          from,
          to,
          scope: { from: scope, to: nodeName(scope) },
          consumerVisible: false,
        });
      }
    }
  }
  const nodeRecords = legacyNodes(document);
  for (const [scope, renames] of assemblyOccurrences) {
    const instances = nodeRecords[scope]!.instances as readonly {
      readonly id: string;
    }[];
    for (const [instanceIndex, to] of renames) {
      append(applied, {
        kind: "assembly-occurrence",
        from: instances[instanceIndex]!.id,
        to,
        scope: { from: scope, to: nodeName(scope) },
        instanceIndex,
        consumerVisible: false,
      });
    }
  }
  reflectApply(intrinsicArraySort, applied, [compareApplied]);
  return success({
    parameters,
    nodes,
    outputs,
    sketchEntities,
    sketchConstraints,
    assemblyOccurrences,
    applied,
  });
}

type Mutable = Record<string, unknown>;

/** Deep-copies validated plain document data into fresh null-prototype records. */
function copyData(value: unknown): unknown {
  if (isArray(value)) {
    const copy = new IntrinsicArray<unknown>(value.length);
    for (let index = 0; index < value.length; index += 1) {
      copy[index] = copyData(value[index]);
    }
    return copy;
  }
  if (isRecord(value)) {
    const copy = objectCreateNull<unknown>();
    const keys = objectKeys(value);
    for (let index = 0; index < keys.length; index += 1) {
      copy[keys[index]!] = copyData(value[keys[index]!]);
    }
    return copy;
  }
  return value;
}

function renameKeys(
  record: Readonly<Record<string, unknown>>,
  renames: ReadonlyMap<string, string>,
): Mutable {
  const renamed = objectCreateNull<unknown>();
  const keys = objectKeys(record);
  for (let index = 0; index < keys.length; index += 1) {
    const key = keys[index]!;
    renamed[mapGet(renames, key) ?? key] = record[key];
  }
  return renamed;
}

/**
 * Renames parameter references in every expression under `value`. Callers
 * never pass metadata, so free-form JSON is not reinterpreted.
 */
function renameParameterReferences(
  value: unknown,
  parameters: ReadonlyMap<string, string>,
): void {
  if (isArray(value)) {
    for (let index = 0; index < value.length; index += 1) {
      renameParameterReferences(value[index], parameters);
    }
    return;
  }
  if (!isRecord(value)) return;
  const record = value as Mutable;
  if (
    record.op === "parameter" &&
    typeof record.dimension === "string" &&
    typeof record.id === "string"
  ) {
    record.id = mapGet(parameters, record.id) ?? record.id;
    return;
  }
  const keys = objectKeys(record);
  for (let index = 0; index < keys.length; index += 1) {
    renameParameterReferences(record[keys[index]!], parameters);
  }
}

class IdentityRewriter {
  readonly #plan: DocumentV7IdentityRenamePlan;

  constructor(plan: DocumentV7IdentityRenamePlan) {
    this.#plan = plan;
  }

  node(id: string): string {
    return mapGet(this.#plan.nodes, id) ?? id;
  }

  /** `legacySketch` is the source sketch ID before any node rename. */
  entity(legacySketch: string, id: string): string {
    const renames = mapGet(this.#plan.sketchEntities, legacySketch);
    return (renames === undefined ? undefined : mapGet(renames, id)) ?? id;
  }

  ref(value: unknown): void {
    const ref = value as Mutable;
    ref.node = this.node(ref.node as string);
  }

  source(value: unknown): void {
    const source = value as Mutable;
    const legacySketch = source.sketch as string;
    source.entity = this.entity(legacySketch, source.entity as string);
    source.sketch = this.node(legacySketch);
  }

  lineage(items: unknown): void {
    for (const item of items as Mutable[]) {
      item.feature = this.node(item.feature as string);
      if (item.source !== undefined) this.source(item.source);
    }
  }

  query(value: unknown): void {
    const query = value as Mutable;
    switch (query.op) {
      case "origin":
        query.feature = this.node(query.feature as string);
        if (query.source !== undefined) this.source(query.source);
        break;
      case "adjacentTo":
        this.query((query.selection as Mutable).query);
        break;
      case "and":
      case "or":
        for (const nested of query.queries as unknown[]) this.query(nested);
        break;
      case "not":
        this.query(query.query);
        break;
      default:
        break;
    }
  }

  sketch(legacyId: string, node: Mutable): void {
    const entityRenames = mapGet(this.#plan.sketchEntities, legacyId);
    const constraintRenames = mapGet(this.#plan.sketchConstraints, legacyId);
    const entity = (id: unknown): string => this.entity(legacyId, id as string);
    if (entityRenames !== undefined) {
      node.entities = renameKeys(node.entities as Mutable, entityRenames);
    }
    if (constraintRenames !== undefined) {
      node.constraints = renameKeys(
        node.constraints as Mutable,
        constraintRenames,
      );
    }
    for (const item of Object.values(node.entities as Mutable) as Mutable[]) {
      for (const field of ["start", "end", "center"] as const) {
        if (typeof item[field] === "string") item[field] = entity(item[field]);
      }
    }
    for (const item of Object.values(
      node.constraints as Mutable,
    ) as Mutable[]) {
      for (const field of [
        "first",
        "second",
        "entity",
        "point",
        "line",
        "circle",
      ] as const) {
        if (typeof item[field] === "string") item[field] = entity(item[field]);
      }
    }
    const profile = node.profile as Mutable;
    for (const loop of [
      profile.outer,
      ...(profile.holes as unknown[]),
    ] as Mutable[]) {
      if (loop.kind === "circle") {
        loop.entity = entity(loop.entity);
      } else {
        for (const edge of loop.edges as Mutable[]) {
          edge.entity = entity(edge.entity);
        }
      }
    }
  }

  assembly(legacyId: string, node: Mutable): void {
    const renames = mapGet(this.#plan.assemblyOccurrences, legacyId);
    const instances = node.instances as Mutable[];
    for (let index = 0; index < instances.length; index += 1) {
      const instance = instances[index]!;
      const renamed =
        renames === undefined ? undefined : mapGet(renames, index);
      if (renamed !== undefined) instance.id = renamed;
      this.ref(instance.component);
    }
  }

  graphNode(legacyId: string, node: Mutable): void {
    switch (node.kind) {
      case "sketch":
        this.sketch(legacyId, node);
        break;
      case "extrude":
      case "revolve":
        this.ref(node.profile);
        break;
      case "loft":
        for (const profile of node.profiles as unknown[]) this.ref(profile);
        break;
      case "sweep":
        this.ref(node.profile);
        this.ref(node.path);
        break;
      case "boolean":
        this.ref(node.target);
        for (const tool of node.tools as unknown[]) this.ref(tool);
        break;
      case "transform":
      case "offset":
        this.ref(node.input);
        break;
      case "fillet":
      case "chamfer":
        this.ref(node.input);
        this.query((node.edges as Mutable).query);
        break;
      case "shell":
        this.ref(node.input);
        this.query((node.openings as Mutable).query);
        break;
      case "draft":
        this.ref(node.input);
        this.query((node.faces as Mutable).query);
        break;
      case "part":
        this.ref(node.solid);
        break;
      case "assembly":
        this.assembly(legacyId, node);
        break;
      default:
        break;
    }
  }
}

/**
 * Applies a validated plan to a validated legacy document and returns a fresh
 * legacy-shaped document. Definitions and every structural reference are
 * renamed; metadata and other free-form text are never rewritten.
 */
export function applyDocumentV7IdentityRenames(
  document: DesignDocument,
  plan: DocumentV7IdentityRenamePlan,
): DesignDocument {
  const copy = copyData(document) as Mutable;
  const rewriter = new IdentityRewriter(plan);

  copy.parameters = renameKeys(copy.parameters as Mutable, plan.parameters);
  if (plan.parameters.size > 0) {
    for (const parameter of Object.values(copy.parameters as Mutable)) {
      renameParameterReferences(parameter, plan.parameters);
    }
    for (const material of Object.values(
      (copy.materials ?? {}) as Mutable,
    ) as Mutable[]) {
      renameParameterReferences(material.massDensity, plan.parameters);
    }
    for (const configuration of Object.values(
      (copy.configurations ?? {}) as Mutable,
    ) as Mutable[]) {
      renameParameterReferences(
        configuration.parameterOverrides,
        plan.parameters,
      );
    }
  }

  const sourceNodes = copy.nodes as Mutable;
  const nodeIds = objectKeys(sourceNodes);
  for (let index = 0; index < nodeIds.length; index += 1) {
    const legacyId = nodeIds[index]!;
    const node = sourceNodes[legacyId] as Mutable;
    rewriter.graphNode(legacyId, node);
    if (plan.parameters.size > 0) {
      const keys = objectKeys(node);
      for (let keyIndex = 0; keyIndex < keys.length; keyIndex += 1) {
        const key = keys[keyIndex]!;
        if (node.kind === "part" && key === "metadata") continue;
        renameParameterReferences(node[key], plan.parameters);
      }
    }
  }
  copy.nodes = renameKeys(sourceNodes, plan.nodes);

  copy.outputs = renameKeys(copy.outputs as Mutable, plan.outputs);
  for (const output of Object.values(copy.outputs as Mutable)) {
    rewriter.ref(output);
  }

  if (copy.topologyReferences !== undefined) {
    for (const entry of Object.values(
      copy.topologyReferences as Mutable,
    ) as Mutable[]) {
      rewriter.ref(entry.target);
      for (const variant of entry.variants as Mutable[]) {
        rewriter.lineage(variant.lineage);
        for (const neighbor of variant.adjacency as Mutable[]) {
          rewriter.lineage(neighbor.lineage);
        }
      }
    }
  }
  return copy as unknown as DesignDocument;
}
