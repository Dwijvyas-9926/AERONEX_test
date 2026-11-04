/*
  Local vehicle profiles. These are the user's own description of an aircraft,
  stored in this browser. They are deliberately separate from anything read
  from a flight controller: a profile saying "PX4" never overrides what a
  connected vehicle actually reports.
*/

export type FrameType = "quad-x" | "quad-plus" | "hexa-x" | "octa-x";
export type DeclaredFirmware = "ardupilot" | "px4" | "unsure";
export type BoardId = "pixhawk-2.4.8" | "pixhawk-6c-mini" | "other";

export interface VehicleProfile {
  id: string;
  name: string;
  frame: FrameType;
  firmware: DeclaredFirmware;
  board: BoardId;
  /** Approximate all-up mass in grams; used later by the simulator. */
  massGrams: number | null;
  /** Motor-to-motor diagonal in millimetres. */
  diagonalMm: number | null;
  notes: string;
  /** 3D model: the built-in quadcopter, or an imported assembly (bytes live in IndexedDB). */
  model: ModelDescriptor;
  createdAt: number;
  updatedAt: number;
}

export type ImportedFormat = "glb" | "gltf" | "obj" | "stl" | "step";
export type AxisDir = "+x" | "-x" | "+y" | "-y" | "+z" | "-z";

export type ModelDescriptor =
  | { source: "default" }
  | {
      source: "imported";
      filename: string;
      format: ImportedFormat;
      parts: number;
      triangles: number;
      /** Bounding-box size in the file's own units. */
      size: [number, number, number];
      /** Orientation correction: which model axis is the nose and which is up. */
      forward: AxisDir;
      up: AxisDir;
      /** Display scale relative to auto-fit, in percent. */
      scalePercent: number;
    };

export const FRAME_LABELS: Record<FrameType, string> = {
  "quad-x": "Quadcopter, X",
  "quad-plus": "Quadcopter, +",
  "hexa-x": "Hexacopter, X",
  "octa-x": "Octocopter, X",
};

export const FIRMWARE_LABELS: Record<DeclaredFirmware, string> = {
  ardupilot: "ArduPilot (ArduCopter)",
  px4: "PX4",
  unsure: "Not sure yet",
};

export const BOARD_LABELS: Record<BoardId, string> = {
  "pixhawk-2.4.8": "Pixhawk 2.4.8",
  "pixhawk-6c-mini": "Holybro Pixhawk 6C Mini",
  other: "Other MAVLink controller",
};

/** Board facts shown in the UI. Only stable, published characteristics. */
export const BOARD_NOTES: Record<BoardId, string> = {
  "pixhawk-2.4.8": "STM32F427 FMUv2/v3-class board. Widely run with ArduPilot; current PX4 releases may not fit its flash.",
  "pixhawk-6c-mini": "STM32H743 at 480 MHz with redundant IMUs. Supported by both PX4 and ArduPilot.",
  other: "Any controller speaking MAVLink. Capabilities are detected on connection.",
};
