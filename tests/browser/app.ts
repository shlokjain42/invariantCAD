/// <reference types="vite/client" />

import {
  createEvaluator,
  design,
  EvaluatedSolid,
  mm,
  vec3,
} from "invariantcad";
import { createOcctKernel } from "invariantcad/kernels/occt";

export interface BrowserSmokeResult {
  readonly manifold: {
    readonly volume: number;
    readonly triangles: number;
    readonly stlBytes: number;
  };
  readonly occt: {
    readonly volume: number;
    readonly faces: number;
    readonly edges: number;
    readonly vertices: number;
    readonly stepBytes: number;
  };
}

declare global {
  interface Window {
    invariantCadBrowserSmoke: Promise<BrowserSmokeResult>;
  }
}

function browserSmokeDocument() {
  const cad = design("browser-smoke");
  const box = cad.box("box", {
    size: vec3(mm(2), mm(3), mm(4)),
  });
  cad.output("box", box);
  return cad.build();
}

function diagnosticMessage(
  diagnostics: readonly { readonly code: string; readonly message: string }[],
): string {
  return diagnostics
    .map((item) => item.code + ": " + item.message)
    .join("\n");
}

async function runBrowserSmoke(): Promise<BrowserSmokeResult> {
  const document = browserSmokeDocument();
  const manifoldEvaluator = await createEvaluator();

  let manifold: BrowserSmokeResult["manifold"];
  try {
    const result = await manifoldEvaluator.evaluate(document);
    if (!result.ok) {
      throw new Error(diagnosticMessage(result.diagnostics));
    }
    try {
      const output = result.value.output("box");
      const mesh = output.mesh();
      const stl = output.export("stl");
      if (!(stl instanceof Uint8Array)) {
        throw new TypeError("Binary STL export did not return bytes");
      }
      manifold = {
        volume: output.measure().volume,
        triangles: mesh.indices.length / 3,
        stlBytes: stl.byteLength,
      };
    } finally {
      result.value.dispose();
    }
  } finally {
    manifoldEvaluator.dispose();
  }

  const occtKernel = await createOcctKernel();
  const occtEvaluator = await createEvaluator({ kernel: occtKernel });
  let occt: BrowserSmokeResult["occt"];
  try {
    const result = await occtEvaluator.evaluate(document);
    if (!result.ok) {
      throw new Error(diagnosticMessage(result.diagnostics));
    }
    try {
      const output = result.value.output("box");
      if (!(output instanceof EvaluatedSolid)) {
        throw new TypeError("Expected the browser fixture output to be a solid");
      }
      const topology = output.topology();
      if (!topology.ok) {
        throw new Error(diagnosticMessage(topology.diagnostics));
      }
      const step = output.export("step");
      if (!(step instanceof Uint8Array)) {
        throw new TypeError("STEP export did not return bytes");
      }
      occt = {
        volume: output.measure().volume,
        faces: topology.value.faces.length,
        edges: topology.value.edges.length,
        vertices: topology.value.vertices.length,
        stepBytes: step.byteLength,
      };
    } finally {
      result.value.dispose();
    }
  } finally {
    occtEvaluator.dispose();
  }

  return { manifold, occt };
}

const resultElement = document.querySelector("#result");
const smoke = runBrowserSmoke();
window.invariantCadBrowserSmoke = smoke;

void smoke.then(
  (result) => {
    document.body.dataset.status = "passed";
    if (resultElement !== null) {
      resultElement.textContent = JSON.stringify(result, undefined, 2);
    }
  },
  (error: unknown) => {
    document.body.dataset.status = "failed";
    if (resultElement !== null) {
      resultElement.textContent =
        error instanceof Error ? error.stack ?? error.message : String(error);
    }
    console.error(error);
  },
);
