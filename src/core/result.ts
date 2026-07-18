export type DiagnosticSeverity = "info" | "warning" | "error";

export type DiagnosticCode =
  | "IR_INVALID"
  | "REFERENCE_MISSING"
  | "REFERENCE_KIND_MISMATCH"
  | "DUPLICATE_ID"
  | "GRAPH_CYCLE"
  | "EXPRESSION_INVALID"
  | "EXPRESSION_DIMENSION_MISMATCH"
  | "PARAMETER_MISSING"
  | "PARAMETER_OUT_OF_RANGE"
  | "PARAMETER_CYCLE"
  | "MASS_DENSITY_INVALID"
  | "MASS_DENSITY_MISSING"
  | "MASS_PROPERTIES_INVALID"
  | "BOM_PART_NUMBER_MISSING"
  | "BOM_PART_NUMBER_DUPLICATE"
  | "BOM_MATERIAL_MISSING"
  | "BOM_OUTPUT_UNSUPPORTED"
  | "CONFIGURATION_MISSING"
  | "SKETCH_SOLVE_FAILED"
  | "SKETCH_UNDER_CONSTRAINED"
  | "SKETCH_OVER_CONSTRAINED"
  | "SKETCH_NO_CLOSED_REGION"
  | "FEATURE_INVALID"
  | "BOOLEAN_FAILED"
  | "EMPTY_RESULT"
  | "KERNEL_ERROR"
  | "KERNEL_CAPABILITY_MISSING"
  | "TOPOLOGY_SELECTOR_INVALID"
  | "TOPOLOGY_SELECTION_MISSING"
  | "TOPOLOGY_SELECTION_AMBIGUOUS"
  | "TOPOLOGY_HISTORY_UNAVAILABLE"
  | "OUTPUT_MISSING"
  | "EVALUATION_ABORTED"
  | "EXPORT_UNSUPPORTED";

export interface DiagnosticLocation {
  readonly node?: string;
  readonly path?: string;
  readonly message: string;
}

export interface Diagnostic {
  readonly severity: DiagnosticSeverity;
  readonly code: DiagnosticCode;
  readonly message: string;
  readonly node?: string;
  readonly path?: string;
  readonly related?: readonly DiagnosticLocation[];
  readonly hints?: readonly string[];
  readonly details?: Readonly<Record<string, unknown>>;
}

export type CadResult<T> =
  | {
      readonly ok: true;
      readonly value: T;
      readonly diagnostics: readonly Diagnostic[];
    }
  | {
      readonly ok: false;
      readonly diagnostics: readonly Diagnostic[];
    };

export function success<T>(
  value: T,
  diagnostics: readonly Diagnostic[] = [],
): CadResult<T> {
  return { ok: true, value, diagnostics };
}

export function failure<T = never>(
  ...diagnostics: readonly Diagnostic[]
): CadResult<T> {
  return { ok: false, diagnostics };
}

export function diagnostic(
  code: DiagnosticCode,
  message: string,
  options: Omit<Diagnostic, "code" | "message"> = { severity: "error" },
): Diagnostic {
  return { code, message, ...options };
}

export function hasErrors(diagnostics: readonly Diagnostic[]): boolean {
  return diagnostics.some((item) => item.severity === "error");
}

export class CadError extends Error {
  readonly diagnostics: readonly Diagnostic[];

  constructor(message: string, diagnostics: readonly Diagnostic[]) {
    super(message);
    this.name = "CadError";
    this.diagnostics = diagnostics;
  }
}
