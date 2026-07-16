import { createManifoldKernel } from "../src/index.js";
import { geometryKernelConformance } from "./kernel-conformance.js";

geometryKernelConformance({
  id: "manifold",
  create: createManifoldKernel,
  relativeTolerance: 1e-7,
});
