import type { DocumentationExample } from "./example-contract.js";

// docs-example:start structured-diagnostics-and-resource-limits
import {
  design,
  mm,
  parseDocument,
  stringifyDocument,
  vec3,
} from "invariantcad";

const cad = design("bounded-input");
const box = cad.box("box", {
  size: vec3(mm(10), mm(20), mm(30)),
});
cad.output("box", box);

const json = stringifyDocument(cad.build());
const documentBytes = new TextEncoder().encode(json).byteLength;
const parsed = parseDocument(json, {
  limits: { maxDocumentBytes: documentBytes - 1 },
});
if (parsed.ok) {
  throw new Error("Expected the configured byte ceiling to reject the input");
}
const issue = parsed.diagnostics[0];
if (issue === undefined) {
  throw new Error("Expected a structured resource-limit diagnostic");
}

export const diagnosticsLimitSummary = {
  code: issue.code,
  severity: issue.severity,
  resource: issue.details?.resource,
  limit: issue.details?.limit,
  actual: issue.details?.actual,
};
console.log(diagnosticsLimitSummary);
// docs-example:end structured-diagnostics-and-resource-limits

export const documentationExample = {
  id: "structured-diagnostics-and-resource-limits",
  checks: {
    structuredCode: diagnosticsLimitSummary.code === "IR_INVALID",
    errorSeverity: diagnosticsLimitSummary.severity === "error",
    namedResource:
      diagnosticsLimitSummary.resource === "maxDocumentBytes",
    configuredLimit:
      diagnosticsLimitSummary.limit === documentBytes - 1,
    measuredActual: diagnosticsLimitSummary.actual === documentBytes,
  },
} satisfies DocumentationExample;
