import type { TopologyKind } from "../protocol/topology.js";

export function pluralTopologyKind(
  topology: TopologyKind,
): "faces" | "edges" | "vertices" {
  switch (topology) {
    case "face":
      return "faces";
    case "edge":
      return "edges";
    case "vertex":
      return "vertices";
  }
}
