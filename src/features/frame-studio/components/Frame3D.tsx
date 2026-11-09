import { ContactShadows, OrbitControls } from "@react-three/drei";
import { Canvas, useThree } from "@react-three/fiber";
import { useEffect, useMemo } from "react";
import { ACESFilmicToneMapping, DoubleSide, type BufferGeometry } from "three";
import { GRAPHICS, useSettings } from "../../../state/settingsStore";
import { type FrameDesign } from "../geometry";
import { geometryFor } from "../solid";

/*
  Solid view.

  The meshes here are the very same extrusions the STL exporter writes, so what
  the user turns around on screen is what their printer or cutter receives — a
  preview built from a prettier, separate model would be free to disagree with
  the files, which is the one thing a design preview must never do.

  Units are millimetres throughout; the scene is scaled down once at the root
  so the camera can work in sensible numbers.
*/

interface Props {
  design: FrameDesign;
  exploded: boolean;
}

/*
  Parts are coloured by what they are actually made of, so the preview reads as
  the material the user picked rather than as generic plastic. The top plate is
  lifted a shade so the three parts stay tellable apart at a glance.
*/
const MATERIAL_LOOK: Record<string, { color: string; metalness: number; roughness: number }> = {
  "cf-plate": { color: "#3a352f", metalness: 0.08, roughness: 0.4 },
  g10: { color: "#2d7d5a", metalness: 0.02, roughness: 0.6 },
  "alu-6061": { color: "#b7bcc2", metalness: 0.9, roughness: 0.32 },
  "ply-birch": { color: "#b98f5c", metalness: 0, roughness: 0.85 },
  acrylic: { color: "#6ba2b6", metalness: 0.02, roughness: 0.18 },
  "pa-cf": { color: "#423c35", metalness: 0.02, roughness: 0.85 },
  "pa12-cf": { color: "#4a443c", metalness: 0.02, roughness: 0.85 },
  petg: { color: "#53798d", metalness: 0.02, roughness: 0.55 },
  pla: { color: "#86765f", metalness: 0, roughness: 0.75 },
};
const FALLBACK_LOOK = { color: "#42342a", metalness: 0.03, roughness: 0.65 };
/** Nudge a hex colour toward light, to separate the top plate from the rest. */
function lighten(hex: string, amount: number): string {
  const v = parseInt(hex.slice(1), 16);
  const mix = (c: number) => Math.round(c + (255 - c) * amount);
  return `#${[(v >> 16) & 255, (v >> 8) & 255, v & 255].map((c) => mix(c).toString(16).padStart(2, "0")).join("")}`;
}

function Part({
  geometry,
  look,
  z,
  rotation = 0,
  shift = 0,
}: {
  geometry: BufferGeometry;
  look: { color: string; metalness: number; roughness: number };
  z: number;
  rotation?: number;
  shift?: number;
}) {
  return (
    // Profiles are drawn in XY and extruded along +Z, which is exactly how the
    // aircraft sits: lay the scene on its back by rotating -90° about X.
    <group rotation={[-Math.PI / 2, 0, 0]} position={[0, 0, 0]}>
      <group rotation={[0, 0, rotation]}>
        <mesh geometry={geometry} position={[shift, 0, z]} castShadow receiveShadow>
          <meshStandardMaterial
            color={look.color}
            metalness={look.metalness}
            roughness={look.roughness}
            side={DoubleSide}
          />
        </mesh>
      </group>
    </group>
  );
}

/**
 * Explicit three-point lighting, no image-based environment.
 *
 * A generated room environment was tried here and rejected: it is a bright
 * white-walled space whose ambient contribution swamped the base colours, so
 * carbon, nylon and plywood all rendered as the same pale grey no matter what
 * they were set to. Plain lights at known intensities keep each material
 * looking like itself, and cost less to render besides.
 */
function ToneMap() {
  const gl = useThree((s) => s.gl);
  useEffect(() => {
    gl.toneMapping = ACESFilmicToneMapping;
    gl.toneMappingExposure = 1;
  }, [gl]);
  return null;
}

export function Frame3D({ design: d, exploded }: Props) {
  const graphics = useSettings((s) => s.graphics);
  const preset = GRAPHICS[graphics];

  const geos = useMemo(() => {
    const bottom = d.profiles.find((p) => p.id === "bottom-plate")!;
    const top = d.profiles.find((p) => p.id === "top-plate")!;
    const arm = d.profiles.find((p) => p.id === "arm")!;
    return {
      bottom: geometryFor(bottom),
      top: geometryFor(top),
      arm: geometryFor(arm),
      bottomT: bottom.thicknessMm,
      topT: top.thicknessMm,
      armT: arm.thicknessMm,
    };
  }, [d.profiles]);

  // Real stack-up: bottom plate, arms resting on it, standoffs, top plate.
  const gap = exploded ? Math.max(18, geos.armT * 3) : 0;
  const zArm = geos.bottomT + gap;
  const zTop = zArm + geos.armT + Math.max(5, geos.armT + 2) + gap;

  const look = MATERIAL_LOOK[d.material.id] ?? FALLBACK_LOOK;
  const topLook = { ...look, color: lighten(look.color, 0.22) };
  const reach = Math.max(...d.motors.map((m) => Math.hypot(m[0], m[1]))) + d.section.padWidthMm;
  const shift = d.rootRadiusMm - d.armOverlapMm;

  return (
    <Canvas
      className="fs-canvas"
      dpr={preset.dpr}
      shadows={preset.shadows}
      /*
        Frame the whole aircraft. At 38° the half-angle is 19°, so the camera
        has to stand off by about reach/tan(19°) — roughly 2.9 × reach — or the
        arm tips sit outside the frustum and the model looks cropped.
      */
      camera={{ position: [reach * 1.4, reach * 1.25, reach * 1.6], fov: 38, near: 1, far: reach * 20 }}
    >
      <color attach="background" args={["#120c08"]} />
      {/* Key from the front-right, a cool rim from behind-left to separate the
          parts from the background, and a little ambient so nothing is black. */}
      <ambientLight intensity={0.5} color="#ffeedd" />
      <directionalLight position={[reach, reach * 1.5, reach * 0.8]} intensity={1.5} color="#fff2dd" castShadow={preset.shadows} />
      <directionalLight position={[-reach * 0.8, reach * 0.5, -reach]} intensity={0.55} color="#a8c0d4" />
      <ToneMap />
      <ContactShadows position={[0, -1, 0]} scale={reach * 3} blur={2.4} opacity={0.5} far={reach} />

      <group>
        <Part geometry={geos.bottom} look={look} z={0} />
        {d.motors.map((m, i) => (
          <Part
            key={i}
            geometry={geos.arm}
            look={look}
            z={zArm}
            rotation={Math.atan2(m[1], m[0])}
            shift={shift}
          />
        ))}
        <Part geometry={geos.top} look={topLook} z={zTop} />
      </group>

      <OrbitControls
        enablePan={false}
        minDistance={reach * 0.6}
        maxDistance={reach * 4}
        autoRotate={!exploded}
        autoRotateSpeed={0.5}
        target={[0, zArm * 0.5, 0]}
      />
    </Canvas>
  );
}
