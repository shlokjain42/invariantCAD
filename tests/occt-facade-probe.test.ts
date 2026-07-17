import { describe, expect, it, vi } from "vitest";
import {
  OCCT_CONTROLLED_PIPE_SHELL_FACADE_VERSION,
  OCCT_DRAFT_FACADE_VERSION,
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

    const extra = {
      ...controlledPipeShellModule(),
      invariantcadFutureCapability: vi.fn(),
    };
    expect(() => probeOcctFacade(extra)).toThrow("expected exact ABI 0.2 or 0.3");

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
  });

  it("keeps numeric topology enums exact for both known versions", () => {
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
  });
});
