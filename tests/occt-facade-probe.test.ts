import { describe, expect, it, vi } from "vitest";
import {
  OCCT_BOOLEAN_FACADE_VERSION,
  OCCT_CONTROLLED_PIPE_SHELL_FACADE_VERSION,
  OCCT_DRAFT_FACADE_VERSION,
  OCCT_EDGE_TREATMENT_FACADE_VERSION,
  OcctFacadeProtocolError,
  probeOcctDraftFacade,
  probeOcctFacade,
} from "../src/internal/occt-facade.js";

class FakeVectorUint32 {}

function draftModule() {
  return {
    VectorUint32: FakeVectorUint32,
    InvariantCadDraftReport: class {},
    InvariantCadTopologyKind: {
      NONE: -1,
      FACE: 0,
      EDGE: 1,
      VERTEX: 2,
    },
    InvariantCadTopologyRelation: {
      PRESERVED: 0,
      MODIFIED: 1,
      GENERATED: 2,
      DELETED: 3,
      CREATED: 4,
    },
    invariantcadFacadeVersion: vi.fn(() => OCCT_DRAFT_FACADE_VERSION),
    invariantcadDraftFacesAtomic: vi.fn(),
  };
}

function controlledPipeShellModule() {
  return {
    ...draftModule(),
    InvariantCadPipeShellReport: class {},
    invariantcadFacadeVersion: vi.fn(
      () => OCCT_CONTROLLED_PIPE_SHELL_FACADE_VERSION,
    ),
    invariantcadPipeShellSolid: vi.fn(),
  };
}

function booleanModule() {
  return {
    ...controlledPipeShellModule(),
    InvariantCadBooleanOperation: {
      UNION: 0,
      SUBTRACT: 1,
      INTERSECT: 2,
    },
    InvariantCadBooleanReport: class {},
    invariantcadFacadeVersion: vi.fn(() => OCCT_BOOLEAN_FACADE_VERSION),
    invariantcadBooleanAtomic: vi.fn(),
  };
}

function edgeTreatmentModule() {
  return {
    ...booleanModule(),
    InvariantCadEdgeTreatmentOperation: {
      FILLET: 0,
      CHAMFER: 1,
    },
    InvariantCadEdgeTreatmentReport: class {},
    invariantcadFacadeVersion: vi.fn(
      () => OCCT_EDGE_TREATMENT_FACADE_VERSION,
    ),
    invariantcadEdgeTreatmentAtomic: vi.fn(),
  };
}

describe("owned OCCT facade capability probe", () => {
  it("classifies marker-free stock without trusting unrelated constructors", () => {
    expect(
      probeOcctFacade({
        VectorUint32: FakeVectorUint32,
        PipeShellReport: class {},
      }),
    ).toBeUndefined();
  });

  it("recognizes exact legacy 0.2 as draft-only", () => {
    const module = draftModule();
    const facade = probeOcctFacade(module);

    expect(facade).toEqual({
      abi: "0.2",
      version: OCCT_DRAFT_FACADE_VERSION,
      module,
      draft: module,
      pipeShell: undefined,
      boolean: undefined,
      edgeTreatment: undefined,
    });
    expect(Object.isFrozen(facade)).toBe(true);
    expect(probeOcctDraftFacade(module)).toBe(module);
  });

  it("recognizes exact 0.3 as draft plus controlled PipeShell", () => {
    const module = controlledPipeShellModule();
    const facade = probeOcctFacade(module);

    expect(facade).toEqual({
      abi: "0.3",
      version: OCCT_CONTROLLED_PIPE_SHELL_FACADE_VERSION,
      module,
      draft: module,
      pipeShell: module,
      boolean: undefined,
      edgeTreatment: undefined,
    });
    expect(Object.isFrozen(facade)).toBe(true);
    expect(probeOcctDraftFacade(module)).toBe(module);
  });

  it("recognizes exact 0.4 as draft, controlled PipeShell, and Boolean", () => {
    const module = booleanModule();
    const facade = probeOcctFacade(module);

    expect(facade).toEqual({
      abi: "0.4",
      version: OCCT_BOOLEAN_FACADE_VERSION,
      module,
      draft: module,
      pipeShell: module,
      boolean: module,
      edgeTreatment: undefined,
    });
    expect(Object.isFrozen(facade)).toBe(true);
    expect(probeOcctDraftFacade(module)).toBe(module);
  });

  it("recognizes exact 0.5 as the complete edge-treatment facade", () => {
    const module = edgeTreatmentModule();
    const facade = probeOcctFacade(module);

    expect(facade).toEqual({
      abi: "0.5",
      version: OCCT_EDGE_TREATMENT_FACADE_VERSION,
      module,
      draft: module,
      pipeShell: module,
      boolean: module,
      edgeTreatment: module,
    });
    expect(Object.isFrozen(facade)).toBe(true);
    expect(probeOcctDraftFacade(module)).toBe(module);
  });

  it("fails closed for partial, extra, and unknown owned marker surfaces", () => {
    const partial = {
      invariantcadFacadeVersion: () =>
        OCCT_CONTROLLED_PIPE_SHELL_FACADE_VERSION,
      invariantcadPipeShellSolid: vi.fn(),
    };
    expect(() => probeOcctFacade(partial)).toThrow(OcctFacadeProtocolError);

    const partialBoolean = {
      ...controlledPipeShellModule(),
      InvariantCadBooleanReport: class {},
      invariantcadBooleanAtomic: vi.fn(),
    };
    expect(() => probeOcctFacade(partialBoolean)).toThrow(
      OcctFacadeProtocolError,
    );

    const partialEdgeTreatment = {
      ...booleanModule(),
      InvariantCadEdgeTreatmentReport: class {},
      invariantcadEdgeTreatmentAtomic: vi.fn(),
    };
    expect(() => probeOcctFacade(partialEdgeTreatment)).toThrow(
      OcctFacadeProtocolError,
    );

    const extra = {
      ...booleanModule(),
      invariantcadFutureCapability: vi.fn(),
    };
    expect(() => probeOcctFacade(extra)).toThrow(
      "expected exact ABI 0.2, 0.3, 0.4, or 0.5",
    );

    const differentlyCasedUnknown = {
      ...draftModule(),
      InVaRiAnTcAdUnknown: true,
    };
    expect(() => probeOcctFacade(differentlyCasedUnknown)).toThrow(
      OcctFacadeProtocolError,
    );
  });

  it("rejects mixed marker/version pairs and wrong member types", () => {
    const oldMarkersNewVersion = draftModule();
    oldMarkersNewVersion.invariantcadFacadeVersion.mockReturnValue(
      OCCT_CONTROLLED_PIPE_SHELL_FACADE_VERSION,
    );
    expect(() => probeOcctFacade(oldMarkersNewVersion)).toThrow(
      `expected '${OCCT_DRAFT_FACADE_VERSION}'`,
    );

    const newMarkersOldVersion = controlledPipeShellModule();
    newMarkersOldVersion.invariantcadFacadeVersion.mockReturnValue(
      OCCT_DRAFT_FACADE_VERSION,
    );
    expect(() => probeOcctFacade(newMarkersOldVersion)).toThrow(
      `expected '${OCCT_CONTROLLED_PIPE_SHELL_FACADE_VERSION}'`,
    );

    const pipeShellMarkersBooleanVersion = controlledPipeShellModule();
    pipeShellMarkersBooleanVersion.invariantcadFacadeVersion.mockReturnValue(
      OCCT_BOOLEAN_FACADE_VERSION,
    );
    expect(() => probeOcctFacade(pipeShellMarkersBooleanVersion)).toThrow(
      `expected '${OCCT_CONTROLLED_PIPE_SHELL_FACADE_VERSION}'`,
    );

    const booleanMarkersPipeShellVersion = booleanModule();
    booleanMarkersPipeShellVersion.invariantcadFacadeVersion.mockReturnValue(
      OCCT_CONTROLLED_PIPE_SHELL_FACADE_VERSION,
    );
    expect(() => probeOcctFacade(booleanMarkersPipeShellVersion)).toThrow(
      `expected '${OCCT_BOOLEAN_FACADE_VERSION}'`,
    );

    const booleanMarkersEdgeTreatmentVersion = booleanModule();
    booleanMarkersEdgeTreatmentVersion.invariantcadFacadeVersion.mockReturnValue(
      OCCT_EDGE_TREATMENT_FACADE_VERSION,
    );
    expect(() => probeOcctFacade(booleanMarkersEdgeTreatmentVersion)).toThrow(
      `expected '${OCCT_BOOLEAN_FACADE_VERSION}'`,
    );

    const edgeTreatmentMarkersBooleanVersion = edgeTreatmentModule();
    edgeTreatmentMarkersBooleanVersion.invariantcadFacadeVersion.mockReturnValue(
      OCCT_BOOLEAN_FACADE_VERSION,
    );
    expect(() => probeOcctFacade(edgeTreatmentMarkersBooleanVersion)).toThrow(
      `expected '${OCCT_EDGE_TREATMENT_FACADE_VERSION}'`,
    );

    const wrongGlobal = controlledPipeShellModule();
    wrongGlobal.invariantcadPipeShellSolid = 7 as unknown as typeof wrongGlobal.invariantcadPipeShellSolid;
    expect(() => probeOcctFacade(wrongGlobal)).toThrow(
      "invariantcadPipeShellSolid must be a function",
    );

    const wrongClass = controlledPipeShellModule();
    wrongClass.InvariantCadPipeShellReport = {} as typeof wrongClass.InvariantCadPipeShellReport;
    expect(() => probeOcctFacade(wrongClass)).toThrow(
      "InvariantCadPipeShellReport must be an Embind class marker",
    );

    const wrongBooleanGlobal = booleanModule();
    wrongBooleanGlobal.invariantcadBooleanAtomic =
      7 as unknown as typeof wrongBooleanGlobal.invariantcadBooleanAtomic;
    expect(() => probeOcctFacade(wrongBooleanGlobal)).toThrow(
      "invariantcadBooleanAtomic must be a function",
    );

    const wrongBooleanClass = booleanModule();
    wrongBooleanClass.InvariantCadBooleanReport =
      {} as typeof wrongBooleanClass.InvariantCadBooleanReport;
    expect(() => probeOcctFacade(wrongBooleanClass)).toThrow(
      "InvariantCadBooleanReport must be an Embind class marker",
    );

    const wrongEdgeTreatmentGlobal = edgeTreatmentModule();
    wrongEdgeTreatmentGlobal.invariantcadEdgeTreatmentAtomic =
      7 as unknown as typeof wrongEdgeTreatmentGlobal.invariantcadEdgeTreatmentAtomic;
    expect(() => probeOcctFacade(wrongEdgeTreatmentGlobal)).toThrow(
      "invariantcadEdgeTreatmentAtomic must be a function",
    );

    const wrongEdgeTreatmentClass = edgeTreatmentModule();
    wrongEdgeTreatmentClass.InvariantCadEdgeTreatmentReport =
      {} as typeof wrongEdgeTreatmentClass.InvariantCadEdgeTreatmentReport;
    expect(() => probeOcctFacade(wrongEdgeTreatmentClass)).toThrow(
      "InvariantCadEdgeTreatmentReport must be an Embind class marker",
    );
  });

  it("keeps numeric topology enums exact across known versions", () => {
    const extraEnumMember = controlledPipeShellModule();
    Object.assign(extraEnumMember.InvariantCadTopologyKind, { FUTURE: 3 });
    expect(() => probeOcctFacade(extraEnumMember)).toThrow(
      "InvariantCadTopologyKind members",
    );

    const wrappedEnumValue = controlledPipeShellModule();
    wrappedEnumValue.InvariantCadTopologyRelation.MODIFIED = {
      value: 1,
    } as unknown as number;
    expect(() => probeOcctFacade(wrappedEnumValue)).toThrow(
      "InvariantCadTopologyRelation.MODIFIED must be the number 1",
    );

    const booleanTopologyEnum = booleanModule();
    delete (
      booleanTopologyEnum.InvariantCadTopologyKind as Partial<
        typeof booleanTopologyEnum.InvariantCadTopologyKind
      >
    ).VERTEX;
    expect(() => probeOcctFacade(booleanTopologyEnum)).toThrow(
      "InvariantCadTopologyKind members",
    );
  });

  it("keeps the Boolean operation enum exact", () => {
    const extraMember = booleanModule();
    Object.assign(extraMember.InvariantCadBooleanOperation, { XOR: 3 });
    expect(() => probeOcctFacade(extraMember)).toThrow(
      "InvariantCadBooleanOperation members",
    );

    const missingMember = booleanModule();
    delete (
      missingMember.InvariantCadBooleanOperation as Partial<
        typeof missingMember.InvariantCadBooleanOperation
      >
    ).INTERSECT;
    expect(() => probeOcctFacade(missingMember)).toThrow(
      "InvariantCadBooleanOperation members",
    );

    const wrongValue = booleanModule();
    wrongValue.InvariantCadBooleanOperation.SUBTRACT = 7;
    expect(() => probeOcctFacade(wrongValue)).toThrow(
      "InvariantCadBooleanOperation.SUBTRACT must be the number 1",
    );

    const wrappedValue = booleanModule();
    wrappedValue.InvariantCadBooleanOperation.UNION = {
      value: 0,
    } as unknown as number;
    expect(() => probeOcctFacade(wrappedValue)).toThrow(
      "InvariantCadBooleanOperation.UNION must be the number 0",
    );
  });

  it("keeps the edge-treatment operation enum exact", () => {
    const extraMember = edgeTreatmentModule();
    Object.assign(extraMember.InvariantCadEdgeTreatmentOperation, { DRAFT: 2 });
    expect(() => probeOcctFacade(extraMember)).toThrow(
      "InvariantCadEdgeTreatmentOperation members",
    );

    const missingMember = edgeTreatmentModule();
    delete (
      missingMember.InvariantCadEdgeTreatmentOperation as Partial<
        typeof missingMember.InvariantCadEdgeTreatmentOperation
      >
    ).CHAMFER;
    expect(() => probeOcctFacade(missingMember)).toThrow(
      "InvariantCadEdgeTreatmentOperation members",
    );

    const wrongValue = edgeTreatmentModule();
    wrongValue.InvariantCadEdgeTreatmentOperation.CHAMFER = 7;
    expect(() => probeOcctFacade(wrongValue)).toThrow(
      "InvariantCadEdgeTreatmentOperation.CHAMFER must be the number 1",
    );

    const wrappedValue = edgeTreatmentModule();
    wrappedValue.InvariantCadEdgeTreatmentOperation.FILLET = {
      value: 0,
    } as unknown as number;
    expect(() => probeOcctFacade(wrappedValue)).toThrow(
      "InvariantCadEdgeTreatmentOperation.FILLET must be the number 0",
    );
  });
});
