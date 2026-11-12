import { Line, OrbitControls, Sky } from "@react-three/drei";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type MutableRefObject } from "react";
import * as THREE from "three";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";
import type { OrbitControls as OrbitControlsImpl } from "three-stdlib";
import { FIT_TARGET, fitTransform } from "../../../rendering/fitModel";
import { attitudeToEuler } from "../../../rendering/frames";
import { Quadcopter } from "../../../rendering/Quadcopter";
import type { AxisDir } from "../../../services/import/orient";
import { linkManager } from "../../../services/link/linkManager";
import type { Airframe } from "../../../sim/airframe";
import { euler } from "../../../sim/physics";
import type { Terrain } from "../../../sim/terrain";
import { GRAPHICS, type GraphicsPreset } from "../../../state/settingsStore";
import type { Ending, PlanPoint } from "../../../state/simStore";
import { applyTwinMaterials } from "../../digital-twin/twinMaterials";
import { blobTexture, cloudTexture, groundDetail, labelTexture, padTexture, plantTrees, terrainGeometry } from "./landscape";

/*
  The world the virtual aircraft flies in.

  It draws what the physics computes and nothing else: the aircraft is where
  the simulation says it is, the ground is the same height function the
  simulation collides with, and the wind in the sock and the drifting clouds
  is the wind pushing on the airframe. World axes are the app's: +X east,
  +Y up, −Z north.
*/

export type WorldView = "chase" | "orbit" | "ground" | "top" | "fpv";

export interface FlightWorldProps {
  terrain: Terrain;
  airframe: Airframe;
  route: PlanPoint[];
  takeoffAlt: number;
  ending: Ending;
  wind: { speed: number; fromDeg: number };
  view: WorldView;
  graphics: GraphicsPreset;
  /** The model imported in Digital Twin, or null for the standard quadcopter. */
  object: THREE.Group | null;
  forward: AxisDir;
  up: AxisDir;
  scalePercent: number;
  fenceRadius: number | null;
}

/** Where the aircraft is this frame, shared by everything that follows it. */
interface Pose {
  pos: THREE.Vector3;
  quat: THREE.Quaternion;
  yaw: number;
  /** Height of the ground under it. */
  ground: number;
  throttle: number;
  armed: boolean;
  seq: number;
}

const SUN = new THREE.Vector3(0.48, 0.6, 0.36).normalize();
const ACCENT = "#e8b04a";

/* ---------------------------------------------------------------- ground */

function Ground({ terrain, shadows }: { terrain: Terrain; shadows: boolean }) {
  const parts = useMemo(() => {
    const detail = groundDetail();
    const detailFar = groundDetail();
    return {
      near: terrainGeometry(terrain, 780, 230, 7),
      far: terrainGeometry(terrain, 7000, 190, 110, 700),
      detail,
      detailFar,
    };
  }, [terrain]);
  useEffect(
    () => () => {
      parts.near.dispose();
      parts.far.dispose();
      parts.detail.dispose();
      parts.detailFar.dispose();
    },
    [parts],
  );
  return (
    <>
      <mesh geometry={parts.near} receiveShadow={shadows}>
        <meshStandardMaterial vertexColors map={parts.detail} roughness={0.96} metalness={0} />
      </mesh>
      <mesh geometry={parts.far} position={[0, -0.7, 0]}>
        <meshStandardMaterial vertexColors map={parts.detailFar} roughness={1} metalness={0} />
      </mesh>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, terrain.waterLevel, 0]}>
        <planeGeometry args={[3200, 3200]} />
        <meshStandardMaterial color="#2c5f78" roughness={0.12} metalness={0.55} transparent opacity={0.9} />
      </mesh>
    </>
  );
}

function Trees({ terrain, shadows, max }: { terrain: Terrain; shadows: boolean; max: number }) {
  const trees = useMemo(() => plantTrees(terrain, 1150, 12, max), [terrain, max]);
  const trunk = useRef<THREE.InstancedMesh>(null);
  const conifer = useRef<THREE.InstancedMesh>(null);
  const broad = useRef<THREE.InstancedMesh>(null);
  useLayoutEffect(() => {
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const c = new THREE.Color();
    let ci = 0;
    let bi = 0;
    trees.forEach((t, i) => {
      q.setFromAxisAngle(THREE.Object3D.DEFAULT_UP, t.tint * 6.28);
      m.compose(new THREE.Vector3(t.x, t.y + t.h * 0.2, t.z), q, new THREE.Vector3(t.w * 0.12, t.h * 0.4, t.w * 0.12));
      trunk.current?.setMatrixAt(i, m);
      if (t.kind === 0) {
        m.compose(new THREE.Vector3(t.x, t.y + t.h * 0.62, t.z), q, new THREE.Vector3(t.w, t.h * 0.78, t.w));
        conifer.current?.setMatrixAt(ci, m);
        conifer.current?.setColorAt(ci++, c.setHSL(0.31 + t.tint * 0.05, 0.42, 0.17 + t.tint * 0.07));
      } else {
        m.compose(new THREE.Vector3(t.x, t.y + t.h * 0.66, t.z), q, new THREE.Vector3(t.w * 1.25, t.h * 0.5, t.w * 1.25));
        broad.current?.setMatrixAt(bi, m);
        broad.current?.setColorAt(bi++, c.setHSL(0.26 + t.tint * 0.07, 0.45, 0.24 + t.tint * 0.08));
      }
    });
    for (const [mesh, n] of [
      [trunk.current, trees.length],
      [conifer.current, ci],
      [broad.current, bi],
    ] as const) {
      if (!mesh) continue;
      mesh.count = n;
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
      mesh.computeBoundingSphere();
    }
  }, [trees]);
  const n = Math.max(1, trees.length);
  return (
    <>
      <instancedMesh ref={trunk} args={[undefined, undefined, n]} castShadow={shadows}>
        <cylinderGeometry args={[0.7, 1, 1, 6]} />
        <meshStandardMaterial color="#4a3a2a" roughness={1} />
      </instancedMesh>
      <instancedMesh ref={conifer} args={[undefined, undefined, n]} castShadow={shadows}>
        <coneGeometry args={[0.5, 1, 7]} />
        <meshStandardMaterial roughness={0.95} flatShading />
      </instancedMesh>
      <instancedMesh ref={broad} args={[undefined, undefined, n]} castShadow={shadows}>
        <icosahedronGeometry args={[0.5, 1]} />
        <meshStandardMaterial roughness={0.95} flatShading />
      </instancedMesh>
    </>
  );
}

/* ------------------------------------------------------------- sky, wind */

const windVector = (w: { speed: number; fromDeg: number }, out: THREE.Vector3) => {
  const to = ((w.fromDeg + 180) * Math.PI) / 180;
  return out.set(Math.sin(to) * w.speed, 0, -Math.cos(to) * w.speed);
};

function Clouds({ wind }: { wind: { speed: number; fromDeg: number } }) {
  const group = useRef<THREE.Group>(null);
  const tex = useMemo(() => cloudTexture(), []);
  const puffs = useMemo(() => {
    let seed = 5;
    const r = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    return Array.from({ length: 34 }, () => ({ x: (r() - 0.5) * 11000, y: 520 + r() * 520, z: (r() - 0.5) * 11000, w: 500 + r() * 900, o: 0.55 + r() * 0.4 }));
  }, []);
  const v = useMemo(() => new THREE.Vector3(), []);
  useFrame((_, dt) => {
    const g = group.current;
    if (!g) return;
    // Clouds ride faster air than the ground wind, and always drift a little.
    windVector(wind, v).multiplyScalar(2.2);
    if (wind.speed < 0.5) v.set(3, 0, 1);
    for (const s of g.children) {
      s.position.x += v.x * dt;
      s.position.z += v.z * dt;
      if (s.position.x > 5500) s.position.x -= 11000;
      if (s.position.x < -5500) s.position.x += 11000;
      if (s.position.z > 5500) s.position.z -= 11000;
      if (s.position.z < -5500) s.position.z += 11000;
    }
  });
  return (
    <group ref={group}>
      {puffs.map((p, i) => (
        <sprite key={i} position={[p.x, p.y, p.z]} scale={[p.w, p.w * 0.42, 1]}>
          <spriteMaterial map={tex} transparent opacity={p.o} depthWrite={false} fog={false} />
        </sprite>
      ))}
    </group>
  );
}

/** A windsock: it points downwind and lifts toward level as the wind strengthens. */
function Windsock({ position, wind }: { position: [number, number, number]; wind: { speed: number; fromDeg: number } }) {
  const sock = useRef<THREE.Group>(null);
  const droop = useRef<THREE.Group>(null);
  const v = useMemo(() => new THREE.Vector3(), []);
  useFrame(({ clock }) => {
    windVector(wind, v);
    const t = clock.elapsedTime;
    if (sock.current) sock.current.rotation.y = Math.atan2(-v.z, v.x) + Math.sin(t * 1.7) * 0.06 * Math.min(1, wind.speed / 3);
    // Fully extended at about 8 m/s (15 knots), as a real sock is.
    if (droop.current) droop.current.rotation.z = -(1 - Math.min(1, wind.speed / 8)) * 1.3 + Math.sin(t * 5.3) * 0.04 * Math.min(1, wind.speed / 2);
  });
  return (
    <group position={position}>
      <mesh position={[0, 2.6, 0]} castShadow>
        <cylinderGeometry args={[0.04, 0.06, 5.2, 8]} />
        <meshStandardMaterial color="#d9d6cf" roughness={0.5} metalness={0.4} />
      </mesh>
      <group ref={sock} position={[0, 5.1, 0]}>
        <group ref={droop}>
          {[0, 1, 2, 3].map((i) => (
            <mesh key={i} position={[0.24 + i * 0.44, 0, 0]} rotation={[0, 0, -Math.PI / 2]}>
              <cylinderGeometry args={[0.3 - (i + 1) * 0.045, 0.3 - i * 0.045, 0.44, 12, 1, true]} />
              <meshStandardMaterial color={i % 2 ? "#f4f1ea" : "#e2582c"} roughness={0.8} side={THREE.DoubleSide} />
            </mesh>
          ))}
        </group>
      </group>
    </group>
  );
}

/** Streaks carried on the wind around the aircraft: the air it is flying through. */
function WindStreaks({ wind, pose }: { wind: { speed: number; fromDeg: number }; pose: MutableRefObject<Pose> }) {
  const COUNT = 150;
  const ref = useRef<THREE.InstancedMesh>(null);
  const mat = useRef<THREE.MeshBasicMaterial>(null);
  const pts = useMemo(() => {
    let seed = 13;
    const r = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    return Array.from({ length: COUNT }, () => new THREE.Vector3((r() - 0.5) * 80, (r() - 0.5) * 30, (r() - 0.5) * 80));
  }, []);
  const tmp = useMemo(() => ({ m: new THREE.Matrix4(), q: new THREE.Quaternion(), v: new THREE.Vector3(), s: new THREE.Vector3(), p: new THREE.Vector3(), x: new THREE.Vector3(1, 0, 0) }), []);
  useFrame((_, dt) => {
    const mesh = ref.current;
    if (!mesh) return;
    const strength = Math.min(1, Math.max(0, (wind.speed - 0.8) / 9));
    mesh.visible = strength > 0;
    if (!mesh.visible) return;
    if (mat.current) mat.current.opacity = 0.06 + 0.2 * strength;
    windVector(wind, tmp.v);
    tmp.q.setFromUnitVectors(tmp.x, tmp.p.copy(tmp.v).normalize());
    tmp.s.set(0.35 + wind.speed * 0.11, 1, 1);
    const c = pose.current.pos;
    for (let i = 0; i < COUNT; i++) {
      const p = pts[i];
      p.addScaledVector(tmp.v, dt);
      // Keep them in a box round the aircraft, re-entering upwind.
      if (p.x - c.x > 40) p.x -= 80;
      if (p.x - c.x < -40) p.x += 80;
      if (p.z - c.z > 40) p.z -= 80;
      if (p.z - c.z < -40) p.z += 80;
      if (p.y - c.y > 15) p.y -= 30;
      if (p.y - c.y < -15) p.y += 30;
      tmp.m.compose(tmp.p.set(p.x, Math.max(p.y, pose.current.ground + 0.6), p.z), tmp.q, tmp.s);
      mesh.setMatrixAt(i, tmp.m);
    }
    mesh.instanceMatrix.needsUpdate = true;
  });
  return (
    <instancedMesh ref={ref} args={[undefined, undefined, COUNT]} frustumCulled={false}>
      <boxGeometry args={[1, 0.012, 0.012]} />
      <meshBasicMaterial ref={mat} color="#ffffff" transparent opacity={0.2} depthWrite={false} />
    </instancedMesh>
  );
}

/* ---------------------------------------------------- home and the route */

const lensScale = (camera: THREE.Camera) => Math.tan((((camera as THREE.PerspectiveCamera).fov ?? 55) * Math.PI) / 360) / Math.tan((55 * Math.PI) / 360);

function Tag({ text, position, tone = "accent", size = 0.045 }: { text: string; position: [number, number, number]; tone?: "accent" | "light" | "active"; size?: number }) {
  const l = useMemo(() => (tone === "light" ? labelTexture(text, "#17120c", "#f2e8d6") : tone === "active" ? labelTexture(text, "#17120c", "#9fd45a") : labelTexture(text)), [text, tone]);
  useEffect(() => () => l.tex.dispose(), [l]);
  const ref = useRef<THREE.Sprite>(null);
  useFrame(({ camera }) => {
    // A fixed size on screen whatever the lens: without this a zoomed-in
    // camera blows the label up with everything else.
    const k = lensScale(camera);
    ref.current?.scale.set(size * l.aspect * k, size * k, 1);
  });
  return (
    <sprite ref={ref} position={position} scale={[size * l.aspect, size, 1]} renderOrder={10}>
      <spriteMaterial map={l.tex} sizeAttenuation={false} depthTest={false} transparent />
    </sprite>
  );
}

function HomeBase({ wind }: { wind: { speed: number; fromDeg: number } }) {
  const pad = useMemo(() => padTexture(), []);
  return (
    <group>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.03, 0]} receiveShadow>
        <circleGeometry args={[2.6, 48]} />
        <meshStandardMaterial map={pad} roughness={0.9} />
      </mesh>
      {Array.from({ length: 8 }, (_, i) => {
        const a = (i / 8) * Math.PI * 2;
        return (
          <mesh key={i} position={[Math.cos(a) * 3.1, 0.08, Math.sin(a) * 3.1]}>
            <sphereGeometry args={[0.07, 10, 8]} />
            <meshBasicMaterial color={i % 2 ? "#ffd27a" : "#7fd6ff"} />
          </mesh>
        );
      })}
      {/* The ground station: a shelter, a table and an antenna mast, for a sense of scale. */}
      <group position={[8.5, 0, 6]} rotation={[0, -0.5, 0]}>
        <mesh position={[0, 1.15, 0]} castShadow receiveShadow>
          <boxGeometry args={[3.2, 2.3, 2.4]} />
          <meshStandardMaterial color="#c9c2b2" roughness={0.85} />
        </mesh>
        <mesh position={[0, 2.42, 0]} castShadow>
          <boxGeometry args={[3.5, 0.14, 2.7]} />
          <meshStandardMaterial color="#5b4a3a" roughness={0.7} />
        </mesh>
        <mesh position={[0.6, 1.0, 1.21]}>
          <boxGeometry args={[0.9, 1.9, 0.04]} />
          <meshStandardMaterial color="#3b3027" roughness={0.6} />
        </mesh>
        <mesh position={[-2.6, 0.72, 0.4]} castShadow>
          <boxGeometry args={[1.4, 0.06, 0.7]} />
          <meshStandardMaterial color="#8c7a62" roughness={0.7} />
        </mesh>
        <mesh position={[-2.6, 0.36, 0.4]}>
          <boxGeometry args={[1.2, 0.72, 0.5]} />
          <meshStandardMaterial color="#2f2a25" roughness={0.9} transparent opacity={0.35} />
        </mesh>
        <mesh position={[1.9, 3.4, -1.3]} castShadow>
          <cylinderGeometry args={[0.03, 0.05, 6.8, 6]} />
          <meshStandardMaterial color="#b9b6b0" roughness={0.4} metalness={0.7} />
        </mesh>
      </group>
      <Windsock position={[-7.5, 0, 5]} wind={wind} />
      <Tag text="HOME" position={[0, 3.2, 0]} tone="light" size={0.038} />
    </group>
  );
}

function Route({ terrain, route, takeoffAlt, ending, pose, fenceRadius }: { terrain: Terrain; route: PlanPoint[]; takeoffAlt: number; ending: Ending; pose: MutableRefObject<Pose>; fenceRadius: number | null }) {
  const active = useRef(-1);
  const rings = useRef<(THREE.Mesh | null)[]>([]);
  const path = useMemo(() => {
    const pts: [number, number, number][] = [
      [0, 0.1, 0],
      [0, takeoffAlt, 0],
    ];
    for (const p of route) pts.push([p.e, p.alt, -p.n]);
    const last = route[route.length - 1];
    if (last && ending === "rtl") pts.push([0, last.alt, 0], [0, 0.1, 0]);
    if (last && ending === "land") pts.push([last.e, terrain.surface(last.n, last.e) + 0.1, -last.n]);
    return pts;
  }, [route, takeoffAlt, ending, terrain]);
  useFrame(({ clock }) => {
    // The waypoint being flown to pulses; mission item 2 is waypoint 1.
    const now = pose.current.seq - 2;
    active.current = now;
    rings.current.forEach((r, i) => {
      if (!r) return;
      const on = i === now && pose.current.armed;
      r.scale.setScalar(on ? 1 + 0.18 * Math.sin(clock.elapsedTime * 5) : 1);
      (r.material as THREE.MeshBasicMaterial).color.set(on ? "#9fd45a" : ACCENT);
    });
  });
  const last = route[route.length - 1];
  return (
    <group>
      {path.length > 2 && <Line points={path} color={ACCENT} lineWidth={2} dashed dashSize={3} gapSize={2} transparent opacity={0.9} />}
      {route.map((p, i) => {
        const g = terrain.surface(p.n, p.e);
        const h = Math.max(0.5, p.alt - g);
        return (
          <group key={p.id} position={[p.e, 0, -p.n]}>
            {/* A post from the ground to the waypoint: its height above what is under it. */}
            <mesh position={[0, g + h / 2, 0]}>
              <cylinderGeometry args={[0.07, 0.07, h, 6]} />
              <meshBasicMaterial color={ACCENT} transparent opacity={0.45} />
            </mesh>
            <mesh position={[0, g + 0.06, 0]} rotation={[-Math.PI / 2, 0, 0]}>
              <ringGeometry args={[0.9, 1.15, 28]} />
              <meshBasicMaterial color={ACCENT} transparent opacity={0.7} side={THREE.DoubleSide} />
            </mesh>
            <mesh ref={(m) => void (rings.current[i] = m)} position={[0, p.alt, 0]} rotation={[-Math.PI / 2, 0, 0]}>
              <torusGeometry args={[2, 0.09, 8, 40]} />
              <meshBasicMaterial color={ACCENT} />
            </mesh>
            <Tag text={`${i + 1}  ${Math.round(p.alt)} m`} position={[0, p.alt + 2.6, 0]} />
          </group>
        );
      })}
      {last && ending !== "rtl" && (
        <group position={[last.e, terrain.surface(last.n, last.e), -last.n]}>
          {ending === "land" && (
            <mesh position={[0, 0.08, 0]} rotation={[-Math.PI / 2, 0, 0]}>
              <ringGeometry args={[2.4, 3, 40]} />
              <meshBasicMaterial color="#9fd45a" transparent opacity={0.85} side={THREE.DoubleSide} />
            </mesh>
          )}
          <Tag text={ending === "land" ? "LAND" : "HOVER"} position={[0, ending === "land" ? 2 : last.alt - terrain.surface(last.n, last.e) + 5.4, 0]} tone="active" size={0.04} />
        </group>
      )}
      {fenceRadius ? (
        <mesh position={[0, 60, 0]}>
          <cylinderGeometry args={[fenceRadius, fenceRadius, 160, 96, 1, true]} />
          <meshBasicMaterial color="#e2582c" transparent opacity={0.09} side={THREE.DoubleSide} depthWrite={false} />
        </mesh>
      ) : null}
    </group>
  );
}

/* ------------------------------------------------------------ the aircraft */

function Model({ object, forward, up, scalePercent, airframe, env, spin }: Pick<FlightWorldProps, "object" | "forward" | "up" | "scalePercent" | "airframe"> & { env: THREE.Texture | null; spin: MutableRefObject<number> }) {
  const fit = useRef<THREE.Group>(null);
  useLayoutEffect(() => {
    if (object) applyTwinMaterials(object, env);
  }, [object, env]);
  useLayoutEffect(() => {
    const g = fit.current;
    if (!g) return;
    g.clear();
    if (!object) return;
    const f = fitTransform(object, forward, up, scalePercent);
    g.add(object);
    g.position.set(...f.position);
    g.quaternion.set(...f.quaternion);
    g.scale.setScalar(f.scale);
    object.traverse((o) => {
      o.castShadow = true;
    });
    return () => {
      g.remove(object);
    };
  }, [object, forward, up, scalePercent]);
  // True size: the model is fitted to a display size, so bring it to the
  // airframe's real tip-to-tip span.
  const span = airframe.diagonalM + airframe.propDiaM;
  if (object) return <group ref={fit} scale={span / FIT_TARGET} />;
  const s = airframe.diagonalM / 0.55;
  return (
    <group scale={s} position={[0, 0.115 * s, 0]}>
      <Quadcopter spin={spin} discs castShadow />
    </group>
  );
}

function Flight(props: FlightWorldProps & { pose: MutableRefObject<Pose>; env: THREE.Texture | null; shadows: boolean }) {
  const { terrain, pose, view } = props;
  const craft = useRef<THREE.Group>(null);
  const blob = useRef<THREE.Mesh>(null);
  const drop = useRef<THREE.Mesh>(null);
  const beacon = useRef<THREE.Sprite>(null);
  const sun = useRef<THREE.DirectionalLight>(null);
  const spin = useRef(0);
  const blobTex = useMemo(() => blobTexture(), []);
  const beaconTex = useMemo(() => labelTexture("▼", "#17120c", "#f2e8d6"), []);
  const e3 = useMemo(() => new THREE.Euler(), []);
  const { camera } = useThree();

  // The path flown: a line that grows as it goes.
  const trail = useMemo(() => {
    const MAX = 6000;
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(new Float32Array(MAX * 3), 3));
    geo.setDrawRange(0, 0);
    const line = new THREE.Line(geo, new THREE.LineBasicMaterial({ color: "#ffe3a3", transparent: true, opacity: 0.9 }));
    line.frustumCulled = false;
    return { line, geo, MAX, n: 0, last: new THREE.Vector3(1e9, 0, 0), t: -1 };
  }, []);
  useEffect(() => () => trail.geo.dispose(), [trail]);

  useFrame(() => {
    const v = linkManager.sim;
    if (!v) return;
    const s = v.phys.s;
    const p = pose.current;
    const a = euler(s.q);
    p.pos.set(s.pos[1], -s.pos[2], -s.pos[0]);
    p.quat.setFromEuler(attitudeToEuler(a.roll, a.pitch, a.yaw, e3));
    p.yaw = a.yaw;
    p.ground = terrain.surface(s.pos[0], s.pos[1]);
    p.throttle = v.ap.throttleOut;
    p.armed = v.ap.armed;
    p.seq = v.ap.missionSeq;
    spin.current = v.ap.armed ? 60 + 620 * v.ap.throttleOut : 0;

    if (craft.current) {
      craft.current.position.copy(p.pos);
      craft.current.quaternion.copy(p.quat);
      craft.current.visible = view !== "fpv";
    }
    const agl = Math.max(0, p.pos.y - p.ground);
    const far = camera.position.distanceTo(p.pos);
    if (blob.current) {
      // Wider and fainter with height, as a real shadow is.
      const size = (props.airframe.diagonalM + props.airframe.propDiaM) * (1.3 + agl * 0.05);
      blob.current.position.set(p.pos.x, p.ground + 0.06, p.pos.z);
      blob.current.scale.setScalar(size);
      (blob.current.material as THREE.MeshBasicMaterial).opacity = Math.max(0.08, 0.7 - agl * 0.02);
    }
    if (drop.current) {
      // A thin line to the ground under it: how high it is, at a glance.
      drop.current.visible = agl > 1.5 && view !== "fpv";
      drop.current.position.set(p.pos.x, p.ground + agl / 2, p.pos.z);
      drop.current.scale.set(1, agl, 1);
    }
    if (beacon.current) {
      // Far away the aircraft is a few pixels; a marker keeps it findable.
      beacon.current.visible = far > 45 && view !== "fpv" && view !== "top";
      beacon.current.position.set(p.pos.x, p.pos.y + 0.6 + far * 0.012 * lensScale(camera), p.pos.z);
      const k = lensScale(camera);
      beacon.current.scale.set(0.03 * beaconTex.aspect * k, 0.03 * k, 1);
    }
    if (sun.current) {
      sun.current.position.copy(p.pos).addScaledVector(SUN, 70);
      sun.current.target.position.copy(p.pos);
      sun.current.target.updateMatrixWorld();
    }

    // A reset or a restart puts it back at home: start the trail again.
    if (s.t < trail.t) trail.n = 0;
    trail.t = s.t;
    // Only once it has gone somewhere: a hover in gusts is not a path.
    if (trail.last.distanceTo(p.pos) > 1.5 && trail.n < trail.MAX) {
      const arr = trail.geo.attributes.position as THREE.BufferAttribute;
      arr.setXYZ(trail.n++, p.pos.x, p.pos.y, p.pos.z);
      arr.needsUpdate = true;
      trail.last.copy(p.pos);
    }
    trail.geo.setDrawRange(0, trail.n);
  });

  return (
    <>
      <directionalLight
        ref={sun}
        intensity={2.6}
        color="#fff1d6"
        castShadow={props.shadows}
        shadow-mapSize={[2048, 2048]}
        shadow-camera-left={-22}
        shadow-camera-right={22}
        shadow-camera-top={22}
        shadow-camera-bottom={-22}
        shadow-camera-near={1}
        shadow-camera-far={160}
        shadow-bias={-0.0004}
      />
      <group ref={craft}>
        <Model object={props.object} forward={props.forward} up={props.up} scalePercent={props.scalePercent} airframe={props.airframe} env={props.env} spin={spin} />
      </group>
      <mesh ref={blob} rotation={[-Math.PI / 2, 0, 0]} renderOrder={2}>
        <planeGeometry args={[1, 1]} />
        <meshBasicMaterial map={blobTex} transparent depthWrite={false} polygonOffset polygonOffsetFactor={-4} />
      </mesh>
      <mesh ref={drop}>
        <cylinderGeometry args={[0.012, 0.012, 1, 5]} />
        <meshBasicMaterial color="#ffffff" transparent opacity={0.35} depthWrite={false} />
      </mesh>
      <sprite ref={beacon} scale={[0.03 * beaconTex.aspect, 0.03, 1]} renderOrder={11}>
        <spriteMaterial map={beaconTex.tex} sizeAttenuation={false} depthTest={false} transparent />
      </sprite>
      <primitive object={trail.line} />
    </>
  );
}

/* ----------------------------------------------------------------- camera */

function CameraRig({ view, pose, terrain, size }: { view: WorldView; pose: MutableRefObject<Pose>; terrain: Terrain; size: number }) {
  const { camera } = useThree();
  const controls = useRef<OrbitControlsImpl>(null);
  const prev = useRef(new THREE.Vector3());
  const tmp = useMemo(() => ({ want: new THREE.Vector3(), look: new THREE.Vector3(), back: new THREE.Vector3() }), []);
  const fresh = useRef(true);
  const cam = camera as THREE.PerspectiveCamera;

  useEffect(() => {
    fresh.current = true;
  }, [view]);

  useFrame((_, dt) => {
    const p = pose.current;
    const k = 1 - Math.exp(-Math.min(dt, 0.1) * 4);
    const setFov = (f: number) => {
      if (Math.abs(cam.fov - f) > 0.05) {
        cam.fov += (f - cam.fov) * (fresh.current ? 1 : k);
        cam.updateProjectionMatrix();
      }
    };
    // Heading as a direction on the ground: north is −Z.
    tmp.back.set(-Math.sin(p.yaw), 0, Math.cos(p.yaw));
    if (view === "chase") {
      const dist = Math.max(2.4, size * 5.5);
      tmp.want.copy(p.pos).addScaledVector(tmp.back, dist).add(tmp.look.set(0, dist * 0.42, 0));
      if (fresh.current) camera.position.copy(tmp.want);
      else camera.position.lerp(tmp.want, k);
      setFov(55);
      camera.lookAt(tmp.look.copy(p.pos).addScaledVector(tmp.back, -dist * 0.6));
    } else if (view === "fpv") {
      camera.position.copy(p.pos).addScaledVector(tmp.back, -size * 0.25).add(tmp.look.set(0, size * 0.1, 0));
      camera.quaternion.copy(p.quat);
      setFov(92);
    } else if (view === "top") {
      const h = Math.max(28, (p.pos.y - p.ground) * 0.5 + 30);
      tmp.want.set(p.pos.x, p.pos.y + h, p.pos.z + 0.01);
      if (fresh.current) camera.position.copy(tmp.want);
      else camera.position.lerp(tmp.want, k);
      camera.up.set(0, 0, -1);
      camera.lookAt(p.pos);
      camera.up.set(0, 1, 0);
      setFov(50);
    } else if (view === "ground") {
      // Standing by the ground station, following it with a zoom lens.
      camera.position.set(6.5, 1.75, 9);
      const d = camera.position.distanceTo(p.pos);
      camera.lookAt(p.pos);
      // Zoom in as it goes away, but never so far that the surroundings are lost.
      setFov(Math.min(55, Math.max(9, (2 * Math.atan((size * 9) / Math.max(1, d)) * 180) / Math.PI)));
    } else {
      // Orbit: the pilot's own camera, carried along with the aircraft.
      const c = controls.current;
      if (c) {
        if (fresh.current) {
          camera.position.copy(p.pos).add(tmp.want.set(size * 4.5, size * 2.6, size * 5.5));
          setFov(50);
        } else {
          camera.position.add(tmp.want.copy(p.pos).sub(prev.current));
        }
        c.target.copy(p.pos);
        c.update();
      }
    }
    // Never under the ground.
    if (view !== "fpv") {
      const floor = terrain.surface(-camera.position.z, camera.position.x) + 0.4;
      if (camera.position.y < floor) camera.position.y = floor;
    }
    prev.current.copy(p.pos);
    fresh.current = false;
  });

  return <OrbitControls ref={controls} enabled={view === "orbit"} enableDamping dampingFactor={0.12} enablePan={false} minDistance={size * 1.5} maxDistance={600} />;
}

function Atmosphere({ onEnv }: { onEnv: (t: THREE.Texture) => void }) {
  const { gl, scene } = useThree();
  useEffect(() => {
    gl.toneMapping = THREE.ACESFilmicToneMapping;
    gl.toneMappingExposure = 0.62;
    const pmrem = new THREE.PMREMGenerator(gl);
    const env = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    scene.environment = env;
    scene.environmentIntensity = 0.35;
    onEnv(env);
    return () => {
      scene.environment = null;
      env.dispose();
      pmrem.dispose();
    };
  }, [gl, scene, onEnv]);
  return null;
}

export default function FlightWorld(props: FlightWorldProps) {
  const g = GRAPHICS[props.graphics];
  const pose = useRef<Pose>({ pos: new THREE.Vector3(), quat: new THREE.Quaternion(), yaw: 0, ground: 0, throttle: 0, armed: false, seq: 0 });
  const [env, setEnv] = useState<THREE.Texture | null>(null);
  const onEnv = useCallback((t: THREE.Texture) => setEnv(t), []);
  const size = props.airframe.diagonalM + props.airframe.propDiaM;
  const trees = props.graphics === "low" ? 1500 : props.graphics === "medium" ? 3500 : 7000;
  return (
    <Canvas shadows={g.shadows} dpr={g.dpr} camera={{ fov: 55, near: 0.06, far: 40000, position: [4, 3, 6] }} gl={{ logarithmicDepthBuffer: true, antialias: true }}>
      <Sky distance={300000} sunPosition={SUN} turbidity={2.6} rayleigh={0.85} mieCoefficient={0.004} mieDirectionalG={0.8} />
      <fog attach="fog" args={["#b7cbdd", 500, 10500]} />
      <Atmosphere onEnv={onEnv} />
      <hemisphereLight args={["#d5e6ff", "#6a7446", 0.85]} />
      <Ground terrain={props.terrain} shadows={g.shadows} />
      <Trees terrain={props.terrain} shadows={g.shadows} max={trees} />
      <Clouds wind={props.wind} />
      <HomeBase wind={props.wind} />
      <Route terrain={props.terrain} route={props.route} takeoffAlt={props.takeoffAlt} ending={props.ending} pose={pose} fenceRadius={props.fenceRadius} />
      <WindStreaks wind={props.wind} pose={pose} />
      <Flight {...props} pose={pose} env={env} shadows={g.shadows} />
      <CameraRig view={props.view} pose={pose} terrain={props.terrain} size={size} />
    </Canvas>
  );
}
