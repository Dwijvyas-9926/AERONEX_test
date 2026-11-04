import { ContactShadows, GizmoHelper, GizmoViewport, Grid, OrbitControls } from "@react-three/drei";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";
import type { OrbitControls as OrbitControlsImpl } from "three-stdlib";
import { attitudeToEuler } from "../../rendering/frames";
import { fitTransform } from "../../rendering/fitModel";
import { Quadcopter } from "../../rendering/Quadcopter";
import { GRAPHICS, type GraphicsPreset } from "../../state/settingsStore";
import type { AxisDir } from "../../services/import/orient";
import { useLink } from "../../state/linkStore";
import { applyTwinMaterials } from "./twinMaterials";
import { livePose, ManualController, newPose, stepScripted, type Keys } from "./testFlight";

export type TwinMode = "inspect" | "scripted" | "manual" | "live";

/* Body-axis arrows for the inspect view (sprite labels, no font downloads). */
function Label({ text, color, position }: { text: string; color: string; position: [number, number, number] }) {
  const tex = useMemo(() => {
    const c = document.createElement("canvas");
    const ctx = c.getContext("2d")!;
    const font = "600 44px Manrope Variable, Manrope, sans-serif";
    ctx.font = font;
    const w = Math.ceil(ctx.measureText(text).width) + 24;
    c.width = w;
    c.height = 64;
    ctx.font = font;
    ctx.fillStyle = color;
    ctx.textBaseline = "middle";
    ctx.fillText(text, 12, 34);
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    return { t, aspect: w / 64 };
  }, [text, color]);
  const h = 0.16;
  return (
    <sprite position={position} scale={[h * tex.aspect, h, 1]}>
      <spriteMaterial map={tex.t} transparent depthWrite={false} />
    </sprite>
  );
}

function Axes() {
  const items: { dir: [number, number, number]; color: string; label: string }[] = [
    { dir: [0, 0, -1], color: "#d8a648", label: "Forward" },
    { dir: [1, 0, 0], color: "#c49ad0", label: "Right" },
    { dir: [0, 1, 0], color: "#9cb257", label: "Up" },
  ];
  return (
    <group>
      {items.map((a) => {
        const d = new THREE.Vector3(...a.dir);
        const len = 1.0;
        const end = d.clone().multiplyScalar(len);
        return (
          <group key={a.label}>
            <arrowHelper args={[d, new THREE.Vector3(0, 0, 0), len, a.color, 0.14, 0.09]} />
            <Label text={a.label} color={a.color} position={end.clone().add(d.clone().multiplyScalar(0.18)).toArray() as [number, number, number]} />
          </group>
        );
      })}
    </group>
  );
}

/** The imported model (or the default quad) with its fit transform applied. */
function ModelBody({ object, forward, up, scalePercent, env }: { object: THREE.Group | null; forward: AxisDir; up: AxisDir; scalePercent: number; env: THREE.Texture | null }) {
  const fitRef = useRef<THREE.Group>(null);
  const spin = useRef(0);
  // Apply the twin's exact material scheme so the model looks identical to the simulator.
  useLayoutEffect(() => {
    if (object) applyTwinMaterials(object, env);
  }, [object, env]);
  useLayoutEffect(() => {
    const g = fitRef.current;
    if (!g) return;
    g.clear();
    if (object) {
      const f = fitTransform(object, forward, up, scalePercent);
      g.add(object);
      g.position.set(...f.position);
      g.quaternion.set(...f.quaternion);
      g.scale.setScalar(f.scale);
    }
  }, [object, forward, up, scalePercent]);
  return (
    <group>
      <group ref={fitRef} />
      {!object && (
        <group position={[0, 0.22, 0]} scale={1.7}>
          <Quadcopter spin={spin} discs={false} castShadow={false} />
        </group>
      )}
    </group>
  );
}

function Rig({
  mode,
  object,
  forward,
  up,
  scalePercent,
  keys,
  env,
}: {
  mode: TwinMode;
  object: THREE.Group | null;
  forward: AxisDir;
  up: AxisDir;
  scalePercent: number;
  keys: React.MutableRefObject<Keys>;
  env: THREE.Texture | null;
}) {
  const fly = useRef<THREE.Group>(null);
  const controls = useRef<OrbitControlsImpl>(null);
  const { camera } = useThree();
  const t = useRef(0);
  const manual = useMemo(() => new ManualController(), []);
  const prev = useRef(new THREE.Vector3());
  const euler = useMemo(() => new THREE.Euler(), []);
  const baseAlt = useRef(NaN); // altitude baseline captured when live mode starts
  const altLP = useRef(NaN); // low-pass-filtered altitude, to reject baro noise

  // Reset pose when entering a flight mode
  useEffect(() => {
    t.current = 0;
    manual.reset();
    if (mode === "inspect") {
      Object.assign(livePose, newPose());
      fly.current?.position.set(0, 0, 0);
      fly.current?.rotation.set(0, 0, 0);
      controls.current?.target.set(0, 0.5, 0);
      camera.position.set(1.8, 1.3, 2.2);
      controls.current?.update();
    } else if (mode === "live") {
      const y = 1.2;
      baseAlt.current = NaN; // re-zero vertical motion on entering live mode
      altLP.current = NaN;
      fly.current?.position.set(0, y, 0);
      fly.current?.rotation.set(0, 0, 0);
      controls.current?.target.set(0, y, 0);
      camera.position.set(1.2, 1.0, 1.55); // close in so the model is large and easy to read
      controls.current?.update();
    } else {
      prev.current.set(0, mode === "manual" ? 1.2 : 1.25, 0);
      camera.position.set(2.6, 2.0, 3.0);
      controls.current?.target.copy(prev.current);
      controls.current?.update();
    }
  }, [mode, camera, manual]);

  useFrame((_, dt) => {
    if (mode === "inspect") {
      if (controls.current) controls.current.autoRotate = false;
      return;
    }
    if (mode === "live") {
      // Mirror the connected autopilot's attitude AND vertical movement in real time.
      const tel = useLink.getState().telemetry;
      const att = tel.attitude;
      // Relative/baro altitude responds to lifting the board by hand. Shown as
      // vertical motion relative to the height captured when live mode started,
      // with a generous gain so even a small hand-lift is clearly visible.
      const rawAlt = tel.position?.value.relAlt ?? tel.hud?.value.alt ?? null;
      if (fly.current) {
        const REST = 1.2;
        let targetY = REST;
        if (rawAlt != null) {
          // 1) Low-pass the altitude (≈0.9 s time constant) so barometer noise
          //    and EKF jitter are smoothed out before they can move anything.
          if (!Number.isFinite(altLP.current)) altLP.current = rawAlt;
          altLP.current += (rawAlt - altLP.current) * (1 - Math.exp(-dt / 0.9));
          if (!Number.isFinite(baseAlt.current)) baseAlt.current = altLP.current;
          // 2) Deadband: within ±0.25 m of the start height the model stays at rest.
          let delta = altLP.current - baseAlt.current;
          const DB = 0.25;
          delta = Math.abs(delta) < DB ? 0 : delta - Math.sign(delta) * DB;
          targetY = REST + Math.max(-1.1, Math.min(2.6, delta * 1.5));
        }
        // 3) Slew-limited approach: the model can only rise/fall at a capped
        //    speed, so even a jump in the signal can never make it bounce.
        const maxStep = 0.7 * dt;
        const diff = targetY - fly.current.position.y;
        fly.current.position.x = 0;
        fly.current.position.z = 0;
        fly.current.position.y += Math.max(-maxStep, Math.min(maxStep, diff));
        if (att) fly.current.rotation.copy(attitudeToEuler(att.value.roll, att.value.pitch, att.value.yaw, euler));
      }
      return;
    }
    const p = mode === "scripted" ? stepScripted((t.current += Math.min(dt, 0.05)), livePose) : manual.update(dt, keys.current);
    if (mode === "scripted") Object.assign(livePose, p);
    if (fly.current) {
      fly.current.position.set(p.x, p.y, p.z);
      fly.current.rotation.copy(attitudeToEuler(p.roll, p.pitch, p.yaw, euler));
    }
    const c = controls.current;
    if (c) {
      camera.position.x += p.x - prev.current.x;
      camera.position.y += p.y - prev.current.y;
      camera.position.z += p.z - prev.current.z;
      c.target.set(p.x, p.y, p.z);
      c.update();
    }
    prev.current.set(p.x, p.y, p.z);
  });

  return (
    <>
      <group ref={fly}>
        <ModelBody object={object} forward={forward} up={up} scalePercent={scalePercent} env={env} />
      </group>
      {mode === "inspect" && object && <Axes />}
      <OrbitControls ref={controls} makeDefault enableDamping dampingFactor={0.1} enablePan={mode === "inspect"} minDistance={0.6} maxDistance={14} maxPolarAngle={1.5} />
    </>
  );
}

export interface TwinSceneProps {
  mode: TwinMode;
  object: THREE.Group | null;
  forward: AxisDir;
  up: AxisDir;
  scalePercent: number;
  graphics: GraphicsPreset;
  keys: React.MutableRefObject<Keys>;
}

/** A clean vertical studio gradient as the scene backdrop — professional and
    high-contrast so the model reads clearly, instead of a flat dark fill. */
function StudioBackground() {
  const { scene } = useThree();
  const tex = useMemo(() => {
    const c = document.createElement("canvas");
    c.width = 16;
    c.height = 256;
    const ctx = c.getContext("2d")!;
    const g = ctx.createLinearGradient(0, 0, 0, 256);
    g.addColorStop(0, "#47535f");
    g.addColorStop(0.5, "#323c46");
    g.addColorStop(1, "#1b2027");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 16, 256);
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    return t;
  }, []);
  useEffect(() => {
    const prev = scene.background;
    scene.background = tex;
    return () => {
      scene.background = prev;
      tex.dispose();
    };
  }, [scene, tex]);
  return null;
}

/** Builds the twin's RoomEnvironment image-based lighting and tone mapping. */
function TwinEnv({ onEnv }: { onEnv: (t: THREE.Texture) => void }) {
  const { gl, scene } = useThree();
  useEffect(() => {
    gl.toneMapping = THREE.ACESFilmicToneMapping;
    gl.toneMappingExposure = 1.05;
    const pmrem = new THREE.PMREMGenerator(gl);
    const env = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    scene.environment = env;
    onEnv(env);
    return () => {
      scene.environment = null;
      env.dispose();
      pmrem.dispose();
    };
  }, [gl, scene, onEnv]);
  return null;
}

export default function TwinScene({ mode, object, forward, up, scalePercent, graphics, keys }: TwinSceneProps) {
  const [env, setEnv] = useState<THREE.Texture | null>(null);
  return (
    <Canvas dpr={GRAPHICS[graphics].dpr} camera={{ position: [1.8, 1.3, 2.2], fov: 42, near: 0.01, far: 200 }} shadows={false}>
      <fog attach="fog" args={["#2a333d", 28, 95]} />
      <StudioBackground />
      <TwinEnv onEnv={setEnv} />
      {/* Even, neutral studio lighting so the model reads clearly from any angle. */}
      <hemisphereLight args={["#ffffff", "#5b6673", 0.65]} />
      <directionalLight position={[-6, 12, 4]} intensity={1.5} color="#ffffff" />
      <directionalLight position={[7, 6, -5]} intensity={0.5} color="#cfe0ff" />
      <Rig mode={mode} object={object} forward={forward} up={up} scalePercent={scalePercent} keys={keys} env={env} />
      <Grid
        args={[80, 80]}
        cellSize={0.5}
        cellThickness={0.55}
        cellColor="#3b4653"
        sectionSize={2.5}
        sectionThickness={1.1}
        sectionColor="#5a6a79"
        fadeDistance={55}
        fadeStrength={1.4}
        infiniteGrid
        position={[0, 0, 0]}
      />
      <ContactShadows position={[0, 0.002, 0]} scale={16} blur={2.6} far={6} opacity={0.4} color="#05070a" resolution={512} />
      <GizmoHelper alignment="bottom-right" margin={[56, 56]}>
        <GizmoViewport axisColors={["#d8a648", "#9cb257", "#c49ad0"]} labelColor="#17120c" />
      </GizmoHelper>
    </Canvas>
  );
}
