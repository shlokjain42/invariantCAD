import { diagnostic, type Diagnostic } from "../core/result.js";
import type { AssemblyNodeIR, DesignDocument } from "../ir.js";

const IntrinsicArray = Array;
const IntrinsicObject = Object;
const IntrinsicReflect = Reflect;
const intrinsicArraySort = IntrinsicArray.prototype.sort;
const intrinsicObjectCreate = IntrinsicObject.create;
const intrinsicObjectHasOwn = IntrinsicObject.hasOwn;
const intrinsicObjectKeys = IntrinsicObject.keys;
const intrinsicReflectApply = IntrinsicReflect.apply;
const intrinsicStringCharCodeAt = String.prototype.charCodeAt;

type DocumentV7IdentityKind =
  | "parameter"
  | "node"
  | "output"
  | "sketch-entity"
  | "sketch-constraint"
  | "assembly-occurrence";

interface IdentityDescription {
  readonly kind: DocumentV7IdentityKind;
  readonly label: string;
  readonly id: string;
  readonly path: string;
}

type FrozenDocumentNode =
  DesignDocument["nodes"][keyof DesignDocument["nodes"]];

interface StoredTopologySource {
  readonly sketch: string;
  readonly entity: string;
}

interface StoredTopologyLineageItem {
  readonly feature: string;
  readonly source?: StoredTopologySource;
}

interface StoredTopologyNeighbor {
  readonly lineage: readonly StoredTopologyLineageItem[];
}

interface StoredTopologyVariant {
  readonly lineage: readonly StoredTopologyLineageItem[];
  readonly adjacency: readonly StoredTopologyNeighbor[];
}

interface StoredTopologyReferenceEntry {
  readonly variants: readonly StoredTopologyVariant[];
}

function reflectApply(
  target: (...arguments_: never[]) => unknown,
  receiver: unknown,
  arguments_: readonly unknown[],
): unknown {
  return intrinsicReflectApply(target, receiver, arguments_);
}

function objectCreateNull<T>(): Record<string, T> {
  return reflectApply(intrinsicObjectCreate, IntrinsicObject, [
    null,
  ]) as Record<string, T>;
}

function objectHasOwn(value: object, key: PropertyKey): boolean {
  return reflectApply(intrinsicObjectHasOwn, IntrinsicObject, [
    value,
    key,
  ]) as boolean;
}

function objectKeys(value: object): string[] {
  return reflectApply(intrinsicObjectKeys, IntrinsicObject, [
    value,
  ]) as string[];
}

function stringCharCodeAt(value: string, index: number): number {
  return reflectApply(intrinsicStringCharCodeAt, value, [index]) as number;
}

function isAsciiLetter(code: number): boolean {
  return (
    (code >= 0x41 && code <= 0x5a) ||
    (code >= 0x61 && code <= 0x7a)
  );
}

function isDocumentV7Id(value: string): boolean {
  if (value.length === 0 || !isAsciiLetter(stringCharCodeAt(value, 0))) {
    return false;
  }
  for (let index = 1; index < value.length; index += 1) {
    const code = stringCharCodeAt(value, index);
    if (
      !isAsciiLetter(code) &&
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

function append<T>(values: T[], value: T): void {
  values[values.length] = value;
}

function appendIdentityDiagnostic(
  diagnostics: Diagnostic[],
  identity: IdentityDescription,
  sourceVersion: DesignDocument["version"],
): void {
  if (isDocumentV7Id(identity.id)) return;
  append(
    diagnostics,
    diagnostic(
      "IR_INVALID",
      `${identity.label} '${identity.id}' is not representable in Document v7 without rewriting its durable identity`,
      {
        severity: "error",
        path: identity.path,
        details: {
          reason: "document-v7-id-grammar-incompatible",
          identityKind: identity.kind,
          identity: identity.id,
          sourceVersion,
          targetVersion: 7,
        },
      },
    ),
  );
}

function appendRecordKeyDiagnostics(
  diagnostics: Diagnostic[],
  record: Readonly<Record<string, unknown>>,
  parentPath: string,
  kind: DocumentV7IdentityKind,
  label: string,
  sourceVersion: DesignDocument["version"],
): void {
  const ids = objectKeys(record);
  for (let index = 0; index < ids.length; index += 1) {
    const id = ids[index]!;
    appendIdentityDiagnostic(
      diagnostics,
      {
        kind,
        label,
        id,
        path: `${parentPath}/${jsonPointerSegment(id)}`,
      },
      sourceVersion,
    );
  }
}

function appendAssemblyOccurrenceDiagnostics(
  diagnostics: Diagnostic[],
  node: AssemblyNodeIR,
  assemblyNodeId: string,
  sourceVersion: DesignDocument["version"],
): void {
  const seen = objectCreateNull<number>();
  const nodePath = `/nodes/${jsonPointerSegment(assemblyNodeId)}`;
  for (let index = 0; index < node.instances.length; index += 1) {
    const id = node.instances[index]!.id;
    const path = `${nodePath}/instances/${index}/id`;
    appendIdentityDiagnostic(
      diagnostics,
      {
        kind: "assembly-occurrence",
        label: "Assembly occurrence ID",
        id,
        path,
      },
      sourceVersion,
    );
    if (objectHasOwn(seen, id)) {
      const firstPath = `${nodePath}/instances/${seen[id]}/id`;
      append(
        diagnostics,
        diagnostic(
          "DUPLICATE_ID",
          `Assembly occurrence ID '${id}' is duplicated`,
          {
            severity: "error",
            node: assemblyNodeId,
            path,
            related: [
              {
                path: firstPath,
                message: "First occurrence is declared here",
              },
            ],
            details: {
              reason: "document-v7-duplicate-assembly-occurrence-id",
              identityKind: "assembly-occurrence",
              identity: id,
              assemblyNodeId,
              firstIndex: seen[id],
              duplicateIndex: index,
              sourceVersion,
              targetVersion: 7,
            },
          },
        ),
      );
    } else {
      seen[id] = index;
    }
  }
}

function appendStoredTopologyLineageDiagnostics(
  diagnostics: Diagnostic[],
  lineage: readonly StoredTopologyLineageItem[],
  lineagePath: string,
  sourceVersion: DesignDocument["version"],
): void {
  for (let index = 0; index < lineage.length; index += 1) {
    const item = lineage[index]!;
    const itemPath = `${lineagePath}/${index}`;
    appendIdentityDiagnostic(
      diagnostics,
      {
        kind: "node",
        label: "Topology lineage feature",
        id: item.feature,
        path: `${itemPath}/feature`,
      },
      sourceVersion,
    );
    if (item.source === undefined) continue;
    appendIdentityDiagnostic(
      diagnostics,
      {
        kind: "node",
        label: "Topology source sketch",
        id: item.source.sketch,
        path: `${itemPath}/source/sketch`,
      },
      sourceVersion,
    );
    appendIdentityDiagnostic(
      diagnostics,
      {
        kind: "sketch-entity",
        label: "Topology source entity",
        id: item.source.entity,
        path: `${itemPath}/source/entity`,
      },
      sourceVersion,
    );
  }
}

function appendStoredTopologyDiagnostics(
  diagnostics: Diagnostic[],
  document: DesignDocument,
): void {
  if (
    document.version === 1 ||
    document.topologyReferences === undefined
  ) {
    return;
  }
  const references = document.topologyReferences as unknown as Readonly<
    Record<string, StoredTopologyReferenceEntry>
  >;
  const referenceIds = objectKeys(references);
  for (
    let referenceIndex = 0;
    referenceIndex < referenceIds.length;
    referenceIndex += 1
  ) {
    const referenceId = referenceIds[referenceIndex]!;
    const entry = references[referenceId]!;
    const referencePath =
      `/topologyReferences/${jsonPointerSegment(referenceId)}`;
    for (
      let variantIndex = 0;
      variantIndex < entry.variants.length;
      variantIndex += 1
    ) {
      const variant = entry.variants[variantIndex]!;
      const variantPath = `${referencePath}/variants/${variantIndex}`;
      appendStoredTopologyLineageDiagnostics(
        diagnostics,
        variant.lineage,
        `${variantPath}/lineage`,
        document.version,
      );
      for (
        let neighborIndex = 0;
        neighborIndex < variant.adjacency.length;
        neighborIndex += 1
      ) {
        appendStoredTopologyLineageDiagnostics(
          diagnostics,
          variant.adjacency[neighborIndex]!.lineage,
          `${variantPath}/adjacency/${neighborIndex}/lineage`,
          document.version,
        );
      }
    }
  }
}

function sortDiagnosticsByPath(diagnostics: Diagnostic[]): void {
  reflectApply(intrinsicArraySort, diagnostics, [
    (first: Diagnostic, second: Diagnostic): number => {
      const firstPath = first.path ?? "";
      const secondPath = second.path ?? "";
      return firstPath < secondPath ? -1 : firstPath > secondPath ? 1 : 0;
    },
  ]);
}

/**
 * Reports frozen v1-v6 identities that cannot be preserved verbatim by the
 * staged Document v7 grammar.
 *
 * The returned diagnostics are stably ordered by UTF-16 JSON-pointer path.
 * Equal-path diagnostics retain audit order: grammar incompatibility precedes
 * duplicate-occurrence reporting.
 */
export function diagnoseDocumentV7IdentityRepresentability(
  document: DesignDocument,
): readonly Diagnostic[] {
  const diagnostics = new IntrinsicArray<Diagnostic>();
  const sourceVersion = document.version;
  const nodes = document.nodes as unknown as Readonly<
    Record<string, FrozenDocumentNode>
  >;
  appendRecordKeyDiagnostics(
    diagnostics,
    document.parameters,
    "/parameters",
    "parameter",
    "Parameter ID",
    sourceVersion,
  );
  appendRecordKeyDiagnostics(
    diagnostics,
    nodes,
    "/nodes",
    "node",
    "Node ID",
    sourceVersion,
  );
  appendRecordKeyDiagnostics(
    diagnostics,
    document.outputs,
    "/outputs",
    "output",
    "Output name",
    sourceVersion,
  );

  const nodeIds = objectKeys(nodes);
  for (let index = 0; index < nodeIds.length; index += 1) {
    const nodeId = nodeIds[index]!;
    const node = nodes[nodeId]!;
    const nodePath = `/nodes/${jsonPointerSegment(nodeId)}`;
    if (node.kind === "sketch") {
      appendRecordKeyDiagnostics(
        diagnostics,
        node.entities,
        `${nodePath}/entities`,
        "sketch-entity",
        "Sketch entity ID",
        sourceVersion,
      );
      appendRecordKeyDiagnostics(
        diagnostics,
        node.constraints,
        `${nodePath}/constraints`,
        "sketch-constraint",
        "Sketch constraint ID",
        sourceVersion,
      );
    } else if (node.kind === "assembly") {
      appendAssemblyOccurrenceDiagnostics(
        diagnostics,
        node,
        nodeId,
        sourceVersion,
      );
    }
  }

  appendStoredTopologyDiagnostics(diagnostics, document);
  sortDiagnosticsByPath(diagnostics);
  return diagnostics;
}
