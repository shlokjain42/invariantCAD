/**
 * Repository-staged mixed product-document evaluation.
 *
 * This module is intentionally absent from the package root. It composes the
 * captured v7 product planner with the existing exact/approximate leaf views;
 * it does not promote Document v7 or widen the public evaluator contract.
 *
 * @internal
 */
export {
  DEFAULT_LOCAL_ASSEMBLY_EVALUATION_LIMITS_V7 as DEFAULT_PRODUCT_DOCUMENT_EVALUATION_LIMITS_V7,
  EvaluatedProductDocumentV7,
  evaluateProductDocumentOutputsV7 as evaluateProductDocument,
  type EvaluatedProductDocumentOutputV7,
  type EvaluateLocalAssemblyOutputsV7Options as EvaluateProductDocumentV7Options,
  type LocalAssemblyEvaluationLimitsV7 as ProductDocumentEvaluationLimitsV7,
} from "./document-v7-local-assembly-evaluation.js";
