// Lazy loader for occt-import-js (OpenCascade compiled to WebAssembly).
// The ~2 MB kernel is only fetched the first time a STEP/STP file is imported.

import wasmUrl from "occt-import-js/dist/occt-import-js.wasm?url";

export interface OcctMesh {
  name: string;
  attributes: { position: { array: number[] }; normal?: { array: number[] } };
  index: { array: number[] };
  color?: [number, number, number];
  brep_faces?: { first: number; last: number; color: [number, number, number] | null }[];
}
export interface OcctResult {
  success: boolean;
  meshes: OcctMesh[];
}
interface Occt {
  ReadStepFile(buf: Uint8Array, params: unknown): OcctResult;
}

let occtPromise: Promise<Occt> | null = null;

export function loadOcct(): Promise<Occt> {
  if (!occtPromise) {
    occtPromise = import("occt-import-js").then((m) => {
      const factory = ((m as { default?: unknown }).default ?? m) as (opts: { locateFile: () => string }) => Promise<Occt>;
      return factory({ locateFile: () => wasmUrl });
    });
  }
  return occtPromise;
}
