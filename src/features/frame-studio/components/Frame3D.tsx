import { ContactShadows, OrbitControls } from "@react-three/drei";
import { Canvas, useThree } from "@react-three/fiber";
import { useEffect, useMemo } from "react";
import { ACESFilmicToneMapping, DoubleSide, type BufferGeometry } from "three";
import { GRAPHICS, useSettings } from "../../../state/settingsStore";
import { type FrameDesign } from "../geometry";
import { lookForPart } from "../parts";
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
  Colour says which part it is; finish says what it is made of.

  These were both carried by colour once — every part took the material's own
  shade — and it failed at both jobs. Carbon is a near-black #3a352f, and on
  the dark background this view used to have, a carbon frame was a silhouette
  with no readable detail at all. Worse, the one thing a reader most needs
  from an exploded assembly is which piece is which, and four parts in one
  colour cannot say that.

  So the palette below identifies the part, and the material comes through in
  metalness and roughness, which is where it actually shows: aluminium stays
  bright and specular, plywood and nylon stay flat, acrylic stays glassy.
*/
/** Surface finish by material. Colour is the part's; this is the material's. */
const MATERIAL_FINISH: Record<string, { metalness: number; roughness: number }> = {
  "cf-plate": { metalness: 0.25, roughness: 0.38 },
  g10: { metalness: 0.05, roughness: 0.6 },
  "alu-6061": { metalness: 0.85, roughness: 0.3 },
  "ply-birch": { metalness: 0, roughness: 0.9 },
  acrylic: { metalness: 0.05, roughness: 0.12 },
  "pa-cf": { metalness: 0.04, roughness: 0.85 },
  "pa12-cf": { metalness: 0.04, roughness: 0.85 },
  petg: { metalness: 0.04, roughness: 0.5 },
  pla: { metalness: 0, roughness: 0.75 },
};
const FALLBACK_FINISH = { metalness: 0.05, roughness: 0.65 };

interface Finish {
  color: string;
  metalness: number;
  roughness: number;
}

function Part({
  geometry,
  look,
  z,
  rotation = 0,
  shift = 0,
}: {
  geometry: BufferGeometry;
  look: Finish;
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
 * A camera side plate, stood on edge.
 *
 * Every other part lies flat, so its profile plane is the plan and no extra
 * rotation is needed. These two stand vertically facing each other across the
 * camera, which asks for a cyclic permutation of the profile's own axes: its
 * length becomes the frame's fore-aft, its height becomes up, and its
 * thickness becomes the across-frame direction.
 *
 * In three's default XYZ Euler order that permutation is [90°, 90°, 0], not
 * the [90°, 0, 90°] it first looked like — the latter sends the plate's
 * length straight up, which stood the plates on their noses in the middle of
 * the frame instead of on their feet at the front of it.
 */
function CameraPart({
  geometry,
  look,
  x,
  y,
  z,
}: {
  geometry: BufferGeometry;
  look: Finish;
  x: number;
  y: number;
  z: number;
}) {
  return (
    <group rotation={[-Math.PI / 2, 0, 0]}>
      <group position={[x, y, z]} rotation={[Math.PI / 2, Math.PI / 2, 0]}>
        <mesh geometry={geometry} castShadow receiveShadow>
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

  /*
    Build the scene from whatever parts the design actually has.

    Looking up a part by a hard-coded id was wrong in two ways at once: a
    unibody has a "chassis" and no separate arms at all, and a dead cat has
    "arm-long" and "arm-short" rather than "arm". Both cases found undefined
    and threw. Deriving the scene from the profiles means any future part
    layout renders without touching this file.
  */
  const scene = useMemo(() => {
    const base = d.profiles.find((p) => p.id === "chassis" || p.id === "bottom-plate")!;
    const top = d.profiles.find((p) => p.id === "top-plate")!;
    const armParts = d.profiles.filter((p) => p.cantileverMm !== undefined);
    // The camera side plates were built, exported and billed for, and then
    // left out of the one view that shows how the frame goes together.
    const cam = d.profiles.find((p) => p.id === "camera-plate");
    const deck = d.profiles.find((p) => p.id === "deck-plate");
    return {
      deck: deck ? geometryFor(deck) : null,
      deckHoles: deck ? deck.holes : [],
      topHoles: top.holes,
      base: geometryFor(base),
      baseId: base.id,
      top: geometryFor(top),
      baseT: base.thicknessMm,
      topT: top.thicknessMm,
      armT: armParts[0]?.thicknessMm ?? base.thicknessMm,
      camera: cam ? geometryFor(cam) : null,
      arms: armParts.map((part) => ({
        id: part.id,
        geometry: geometryFor(part),
        bearings: d.armGroups.find((g) => g.id === part.id)?.bearings ?? [],
      })),
    };
  }, [d.profiles, d.armGroups]);

  /*
    Extruded geometries hold GPU buffers, and a new set is built on every
    change to the design — which is every keystroke in the spec panel. Without
    this the page leaks a few hundred kilobytes per edit until the tab is
    reloaded.
  */
  useEffect(() => {
    return () => {
      scene.base.dispose();
      scene.top.dispose();
      scene.camera?.dispose();
      scene.deck?.dispose();
      for (const a of scene.arms) a.geometry.dispose();
    };
  }, [scene]);

  /*
    Every height comes from the design's own stack-up table.

    This view used to work the heights out for itself, and got them wrong
    twice: it floated a bolted frame's top plate several millimetres above
    the arms it is supposed to be clamping, and stood a unibody's top plate
    just above the chassis where the hardware list has it on standoffs tall
    enough to clear the stack. A preview that disagrees with the parts list
    is worse than no preview.

    The scene's zero is the underside of the bottom plate, so everything in
    the table — measured from the underside of the arms — is lifted by the
    bottom plate's thickness on a bolted frame.
  */
  const unibody = scene.arms.length === 0;
  const lift = unibody ? 0 : scene.baseT;
  const gap = exploded ? Math.max(18, scene.armT * 3) : 0;
  const zArm = lift + gap;
  const zTop = lift + d.stackUp.topPlateZMm + gap * 2;
  const zDeck = d.stackUp.deckZMm === null ? null : lift + d.stackUp.deckZMm + gap * 4;
  const zCamera = zTop + scene.topT + gap;
  /*
    Standoffs, drawn where the plates' own holes say they go. Left out of the
    exploded view, where the gaps they would span are not real distances.
  */
  const standoffs: { x: number; y: number; z0: number; h: number; r: number }[] = [];
  if (!exploded) {
    if (d.stackUp.topStandoffMm > 0) {
      for (const h of scene.topHoles) {
        standoffs.push({ x: h.c[0], y: h.c[1], z0: zTop - d.stackUp.topStandoffMm, h: d.stackUp.topStandoffMm, r: h.r * 1.8 });
      }
    }
    if (zDeck !== null) {
      for (const h of scene.deckHoles) {
        standoffs.push({ x: h.c[0], y: h.c[1], z0: zTop + scene.topT, h: d.stackUp.deckStandoffMm, r: h.r * 1.8 });
      }
    }
  }

  const finish = MATERIAL_FINISH[d.material.id] ?? FALLBACK_FINISH;
  const lookFor = (id: string): Finish => ({ ...finish, color: lookForPart(id).color });
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
      {/*
        A light studio ground rather than the near-black this used to be. On a
        dark field a carbon or nylon frame — both of which are nearly black —
        showed as a silhouette with no readable edges or holes. Against a warm
        off-white every part reads, and it is what a drawing of a part looks
        like on paper anyway.
      */}
      <color attach="background" args={["#ece4d6"]} />
      {/* Key from the front-right, a cool fill from behind-left to keep the
          shaded sides from going flat, and ambient lifted for the light room. */}
      <ambientLight intensity={0.85} color="#fff6e8" />
      <directionalLight position={[reach, reach * 1.5, reach * 0.8]} intensity={1.35} color="#fffaf0" castShadow={preset.shadows} />
      <directionalLight position={[-reach * 0.8, reach * 0.5, -reach]} intensity={0.5} color="#cfd8e4" />
      <ToneMap />
      <ContactShadows position={[0, -1, 0]} scale={reach * 3} blur={2.6} opacity={0.3} far={reach} />

      <group>
        <Part geometry={scene.base} look={lookFor(scene.baseId)} z={0} />
        {scene.arms.map((group, gi) =>
          group.bearings.map((bearing, bi) => (
            <Part
              key={`${gi}-${bi}`}
              geometry={group.geometry}
              look={lookFor(group.id)}
              z={zArm}
              rotation={bearing}
              shift={shift}
            />
          )),
        )}
        <Part geometry={scene.top} look={lookFor("top-plate")} z={zTop} />
        {scene.deck && zDeck !== null && <Part geometry={scene.deck} look={lookFor("deck-plate")} z={zDeck} />}
        {standoffs.map((st, i) => (
          <group key={`st-${i}`} rotation={[-Math.PI / 2, 0, 0]}>
            {/* A cylinder's axis is its own Y; stand it along the scene's up. */}
            <mesh position={[st.x, st.y, st.z0 + st.h / 2]} rotation={[Math.PI / 2, 0, 0]} castShadow>
              <cylinderGeometry args={[st.r, st.r, st.h, 6]} />
              <meshStandardMaterial color="#b9b4aa" metalness={0.85} roughness={0.35} />
            </mesh>
          </group>
        ))}
        {scene.camera && d.cameraMount && [-1, 1].map((side) => (
          <CameraPart
            key={side}
            geometry={scene.camera!}
            look={lookFor("camera-plate")}
            x={(side * d.cameraMount!.spacingMm) / 2}
            y={d.cameraMount!.centreYMm}
            /*
              Standing on the top plate. The body's midpoint sits half its
              height above that plate's top face, which puts the tab bottoms
              exactly in the slots cut for them — and the whole mount above
              the arms, so it cannot run through the deck or brush an arm
              root.
            */
            z={zCamera + d.cameraMount!.heightMm / 2}
          />
        ))}
      </group>

      <OrbitControls
        enablePan={false}
        minDistance={reach * 0.6}
        maxDistance={reach * 4}
        autoRotate={!exploded}
        autoRotateSpeed={0.5}
        target={[0, (zDeck ?? zTop) * 0.4, 0]}
      />
    </Canvas>
  );
}
