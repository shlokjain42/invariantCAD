import type {
  BoundingBox,
  DesignDocument,
} from "../../src/index.js";
import { enclosureReferenceModel } from "./enclosure.js";
import { flangeReferenceModel } from "./flange.js";
import { shaftReferenceModel } from "./shaft.js";

export type ReferenceKernelId = "manifold" | "occt";

export interface ReferenceModel {
  readonly id: string;
  readonly title: string;
  readonly description: string;
  readonly outputName: string;
  readonly supportedKernels: readonly ReferenceKernelId[];
  readonly expected: {
    readonly volumeMm3: number;
    readonly boundingBox: BoundingBox;
    readonly massDensityKgPerM3: number;
  };
  buildDocument(): DesignDocument;
}

export {
  enclosureReferenceModel,
  flangeReferenceModel,
  shaftReferenceModel,
};

export const referenceModels: readonly ReferenceModel[] = Object.freeze([
  enclosureReferenceModel,
  flangeReferenceModel,
  shaftReferenceModel,
]);
