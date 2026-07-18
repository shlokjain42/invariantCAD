export type Brand<T, Name extends string> = T & {
  readonly __brand: Name;
};

export type ParameterId = Brand<string, "ParameterId">;
export type NodeId = Brand<string, "NodeId">;
export type EntityId = Brand<string, "EntityId">;
export type MaterialId = Brand<string, "MaterialId">;
export type OutputName = Brand<string, "OutputName">;

const ID_PATTERN = /^[A-Za-z][A-Za-z0-9_.:-]*$/;

export function assertValidId(id: string, label = "ID"): void {
  if (!ID_PATTERN.test(id)) {
    throw new TypeError(
      `${label} '${id}' is invalid; use letters, digits, dots, colons, underscores, or hyphens and begin with a letter`,
    );
  }
}

export function parameterId(id: string): ParameterId {
  assertValidId(id, "Parameter ID");
  return id as ParameterId;
}

export function nodeId(id: string): NodeId {
  assertValidId(id, "Node ID");
  return id as NodeId;
}

export function entityId(id: string): EntityId {
  assertValidId(id, "Entity ID");
  return id as EntityId;
}

export function materialId(id: string): MaterialId {
  assertValidId(id, "Material ID");
  return id as MaterialId;
}

export function outputName(id: string): OutputName {
  assertValidId(id, "Output name");
  return id as OutputName;
}
