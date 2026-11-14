import { OrbitControls } from "@react-three/drei";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import type { OrbitControls as OrbitControlsImpl } from "three-stdlib";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { attitudeToEuler } from "../../rendering/frames";
import { Quadcopter } from "../../rendering/Quadcopter";
import { heightAt, RIVER_LEVEL, riverX } from "../../rendering/terrain";
import { GRAPHICS, type GraphicsPreset } from "../../state/settingsStore";
import { heroState, HOVER_ANCHOR, stepHero } from "./heroMotion";

const SKY_HORIZON = new THREE.Color("#e6e3da");
const FOG = new THREE.Color("#ece9e1");

/* ---------------- Sky dome: a pale daylight sky with a warm band low in the west ---------------- */
function Sky() {
  const mat = useMemo(
    () =>
      new THREE.ShaderMaterial({
        side: THREE.BackSide,
        depthWrite: false,
        fog: false,
        uniforms: {
          zenith: { value: new THREE.Color("#f4f6f7") },
          horizon: { value: SKY_HORIZON },
          glow: { value: new THREE.Color("#f0d9b8") },
          warm: { value: new THREE.Color("#e3c39a") },
        },
        vertexShader: `varying vec3 vDir; void main(){ vDir = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
        fragmentShader: `
          uniform vec3 zenith; uniform vec3 horizon; uniform vec3 glow; uniform vec3 warm;
          varying vec3 vDir;
          void main(){
            float h = clamp(vDir.y, -0.2, 1.0);
            vec3 c = mix(horizon, zenith, smoothstep(0.0, 0.55, h));
            float az = dot(normalize(vDir.xz + 1e-4), normalize(vec2(-0.6, -1.0)));
            float band = exp(-abs(h) * 14.0) * smoothstep(-0.2, 1.0, az);
            c += glow * band * 0.55 + warm * exp(-abs(h - 0.01) * 40.0) * smoothstep(0.3, 1.0, az) * 0.5;
            gl_FragColor = vec4(c, 1.0);
          }`,
      }),
    [],
  );
  return (
    <group>
      <mesh material={mat} renderOrder={-1}>
        <sphereGeometry args={[400, 32, 16]} />
      </mesh>
    </group>
  );
}

/* ---------------- Terrain with topographic contour lines ---------------- */
function Terrain() {
  const geom = useMemo(() => {
    const size = 420;
    const seg = 220;
    const g = new THREE.PlaneGeometry(size, size, seg, seg);
    g.rotateX(-Math.PI / 2);
    const p = g.attributes.position as THREE.BufferAttribute;
    for (let i = 0; i < p.count; i++) p.setY(i, heightAt(p.getX(i), p.getZ(i)));
    g.computeVertexNormals();
    return g;
  }, []);
  const mat = useMemo(
    () =>
      new THREE.ShaderMaterial({
        fog: true,
        extensions: { derivatives: true } as never,
        uniforms: THREE.UniformsUtils.merge([
          THREE.UniformsLib.fog,
          {
            low: { value: new THREE.Color("#b9bcb0") },
            high: { value: new THREE.Color("#e9e6dc") },
            line: { value: new THREE.Color("#14213d") },
            sun: { value: new THREE.Vector3(-0.5, 0.45, -0.75).normalize() },
          },
        ]),
        vertexShader: `
          #include <fog_pars_vertex>
          varying float vH; varying vec3 vN; varying vec3 vW;
          void main(){
            vec4 w = modelMatrix * vec4(position,1.0);
            vH = w.y; vN = normalize(mat3(modelMatrix) * normal); vW = w.xyz;
            vec4 mvPosition = viewMatrix * w;
            gl_Position = projectionMatrix * mvPosition;
            #include <fog_vertex>
          }`,
        fragmentShader: `
          #include <fog_pars_fragment>
          uniform vec3 low; uniform vec3 high; uniform vec3 line; uniform vec3 sun;
          varying float vH; varying vec3 vN; varying vec3 vW;
          float contour(float v, float spacing, float width){
            float f = abs(fract(v / spacing - 0.5) - 0.5) * spacing;
            float w = fwidth(v) * width;
            return 1.0 - smoothstep(0.0, w, f);
          }
          void main(){
            float t = smoothstep(-3.0, 26.0, vH);
            vec3 c = mix(low, high, t);
            float diff = clamp(dot(normalize(vN), sun), 0.0, 1.0);
            c *= 0.82 + diff * 0.28;
            float minor = contour(vH, 2.0, 1.0) * 0.16;
            float major = contour(vH, 10.0, 1.4) * 0.42;
            float slopeFade = smoothstep(0.15, 0.9, normalize(vN).y);
            c = mix(c, line, (minor + major) * slopeFade * 0.9);
            gl_FragColor = vec4(c, 1.0);
            #include <fog_fragment>
          }`,
      }),
    [],
  );
  return <mesh geometry={geom} material={mat} />;
}

/* ---------------- River surface ---------------- */
function River() {
  const geom = useMemo(() => {
    // A ribbon following the river centre line
    const pts: number[] = [];
    const idx: number[] = [];
    const n = 160;
    for (let i = 0; i <= n; i++) {
      const z = -210 + (i / n) * 420;
      const x = riverX(z);
      pts.push(x - 9, RIVER_LEVEL, z, x + 9, RIVER_LEVEL, z);
      if (i < n) {
        const a = i * 2;
        idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3);
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(pts, 3));
    g.setIndex(idx);
    return g;
  }, []);
  const mat = useMemo(
    () =>
      new THREE.ShaderMaterial({
        fog: true,
        transparent: true,
        uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, { time: { value: 0 } }]),
        vertexShader: `#include <fog_pars_vertex>
          varying vec3 vW;
          void main(){
            vec4 w = modelMatrix*vec4(position,1.0); vW=w.xyz;
            vec4 mvPosition = viewMatrix*w;
            gl_Position=projectionMatrix*mvPosition;
            #include <fog_vertex>
          }`,
        fragmentShader: `#include <fog_pars_fragment>
          uniform float time; varying vec3 vW;
          void main(){
            float ripple = sin(vW.z*0.9 - time*1.6 + sin(vW.x*0.7)*1.5) * sin(vW.x*1.3 + time*0.8);
            vec3 c = vec3(0.616,0.706,0.769) + vec3(0.16,0.16,0.14) * smoothstep(0.88, 1.0, ripple) * 0.35;
            gl_FragColor = vec4(c, 0.92);
            #include <fog_fragment>
          }`,
      }),
    [],
  );
  useFrame(({ clock }) => {
    mat.uniforms.time.value = clock.elapsedTime;
  });
  return <mesh geometry={geom} material={mat} />;
}

/* ---------------- Instanced conifers on the hillsides ---------------- */
function Forest() {
  const ref = useRef<THREE.InstancedMesh>(null);
  const count = 1100;
  useEffect(() => {
    const mesh = ref.current;
    if (!mesh) return;
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const s = new THREE.Vector3();
    const p = new THREE.Vector3();
    const col = new THREE.Color();
    let seed = 11;
    const rnd = () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646;
    let placed = 0;
    for (let tries = 0; placed < count && tries < count * 6; tries++) {
      const x = (rnd() - 0.5) * 300;
      const z = (rnd() - 0.5) * 300;
      if (Math.abs(x - riverX(z)) < 13) continue; // keep the banks clear
      if (Math.hypot(x - HOVER_ANCHOR.x, z - HOVER_ANCHOR.z) < 16) continue; // clearing under the aircraft
      const h = heightAt(x, z);
      const slope = Math.abs(heightAt(x + 1, z) - h) + Math.abs(heightAt(x, z + 1) - h);
      if (slope > 1.3) continue;
      const sc = 0.7 + rnd() * 0.9;
      p.set(x, h, z);
      s.set(sc, sc * (0.9 + rnd() * 0.5), sc);
      q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), rnd() * 6.28);
      m.compose(p, q, s);
      mesh.setMatrixAt(placed, m);
      col.setHSL(0.28 + rnd() * 0.04, 0.1, 0.26 + rnd() * 0.05);
      mesh.setColorAt(placed, col);
      placed++;
    }
    mesh.count = placed;
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  }, []);
  const geom = useMemo(() => {
    // Three stacked tiers read as a conifer rather than a spike
    const tiers = [
      [1.25, 2.2, 1.3],
      [0.95, 1.9, 2.4],
      [0.6, 1.6, 3.4],
    ].map(([r, h, y]) => {
      const c = new THREE.ConeGeometry(r, h, 7);
      c.translate(0, y, 0);
      return c;
    });
    const trunk = new THREE.CylinderGeometry(0.12, 0.16, 0.8, 5);
    trunk.translate(0, 0.4, 0);
    return mergeGeometries([trunk, ...tiers].map((g) => g.toNonIndexed()))!;
  }, []);
  return (
    <instancedMesh ref={ref} args={[geom, undefined, count]} frustumCulled={false}>
      <meshLambertMaterial />
    </instancedMesh>
  );
}

/* ---------------- Ground marker and altitude line under the aircraft ---------------- */
function GroundMarker() {
  const ring = useRef<THREE.Group>(null);
  const line = useRef<THREE.Mesh>(null);
  useFrame(() => {
    const s = heroState;
    if (ring.current) {
      ring.current.position.set(s.x, s.ground + 0.08, s.z);
      ring.current.rotation.y += 0.004;
    }
    if (line.current) {
      line.current.position.set(s.x, (s.y + s.ground) / 2 - 0.1, s.z);
      line.current.scale.y = Math.max(0.01, s.agl - 0.4);
    }
  });
  return (
    <>
      <group ref={ring}>
        <mesh rotation={[-Math.PI / 2, 0, 0]}>
          <ringGeometry args={[1.6, 1.68, 64]} />
          <meshBasicMaterial color="#a8470f" transparent opacity={0.7} fog={false} />
        </mesh>
        <mesh rotation={[-Math.PI / 2, 0, 0]}>
          <ringGeometry args={[0.55, 0.6, 48]} />
          <meshBasicMaterial color="#a8470f" transparent opacity={0.55} fog={false} />
        </mesh>
        {[0, 1, 2, 3].map((i) => (
          <mesh key={i} rotation={[-Math.PI / 2, 0, (i * Math.PI) / 2]} position={[0, 0, 0]}>
            <planeGeometry args={[0.05, 0.6]} />
            <meshBasicMaterial color="#a8470f" transparent opacity={0.6} fog={false} />
          </mesh>
        ))}
      </group>
      <mesh ref={line}>
        <cylinderGeometry args={[0.008, 0.008, 1, 6]} />
        <meshBasicMaterial color="#a8470f" transparent opacity={0.35} fog={false} />
      </mesh>
    </>
  );
}

/* ---------------- Aircraft and camera rig ---------------- */
function Rig({ animate }: { animate: boolean }) {
  const drone = useRef<THREE.Group>(null);
  const controls = useRef<OrbitControlsImpl>(null);
  const spin = useRef(animate ? 55 : 0);
  const { camera } = useThree();
  const prev = useRef(new THREE.Vector3());
  const idleSince = useRef(0);
  const t = useRef(4);
  const euler = useMemo(() => new THREE.Euler(), []);

  // Place everything before the first frame
  useEffect(() => {
    stepHero(t.current);
    const s = heroState;
    prev.current.set(s.x, s.y, s.z);
    camera.position.set(s.x + 1.25, s.y + 0.62, s.z + 1.6);
    controls.current?.target.set(s.x, s.y - 0.05, s.z);
    controls.current?.update();
  }, [camera]);

  useFrame((_, dt) => {
    if (animate) t.current += Math.min(dt, 0.05);
    const s = stepHero(t.current);
    if (drone.current) {
      drone.current.position.set(s.x, s.y, s.z);
      drone.current.rotation.copy(attitudeToEuler(s.roll, s.pitch, s.yaw, euler));
    }
    spin.current = animate ? 52 + s.climb * 30 : 0;

    // Camera follows the aircraft: translate by the aircraft's motion so orbit angle is preserved
    const c = controls.current;
    if (c) {
      const dx = s.x - prev.current.x;
      const dy = s.y - prev.current.y;
      const dz = s.z - prev.current.z;
      camera.position.x += dx;
      camera.position.y += dy;
      camera.position.z += dz;
      c.target.set(s.x, s.y - 0.05, s.z);
      // Resume the slow orbit a few seconds after the user lets go
      c.autoRotate = animate && performance.now() - idleSince.current > 5000;
      c.update();
    }
    prev.current.set(s.x, s.y, s.z);
  });

  return (
    <>
      <group ref={drone}>
        <Quadcopter spin={spin} />
      </group>
      <OrbitControls
        ref={controls}
        enablePan={false}
        enableDamping
        dampingFactor={0.08}
        minDistance={1.4}
        maxDistance={9}
        minPolarAngle={0.35}
        maxPolarAngle={1.75}
        autoRotateSpeed={-0.35}
        onStart={() => (idleSince.current = Infinity)}
        onEnd={() => (idleSince.current = performance.now())}
      />
    </>
  );
}

function Lights({ shadows }: { shadows: boolean }) {
  return (
    <>
      <hemisphereLight args={["#ffffff", "#6d7380", 1.1]} />
      <directionalLight position={[-30, 22, -45]} intensity={2.3} color="#fff6ea" castShadow={shadows} />
      <directionalLight position={[20, 12, 30]} intensity={0.7} color="#c9d6e8" />
      <ambientLight intensity={0.12} />
    </>
  );
}

export interface HeroSceneProps {
  animate: boolean;
  graphics: GraphicsPreset;
  onReady?: () => void;
}

export default function HeroScene({ animate, graphics, onReady }: HeroSceneProps) {
  const g = GRAPHICS[graphics];
  return (
    <Canvas
      dpr={g.dpr}
      gl={{ antialias: graphics !== "low", powerPreference: "high-performance" }}
      camera={{ fov: 38, near: 0.05, far: 900 }}
      frameloop={animate ? "always" : "demand"}
      onCreated={({ scene, gl, camera }) => {
        // Shift the image so the aircraft sits right of centre, clear of the headline
        (camera as THREE.PerspectiveCamera).filmOffset = -2.2;
        (camera as THREE.PerspectiveCamera).updateProjectionMatrix();
        scene.fog = new THREE.Fog(FOG, 60, 300);
        scene.background = SKY_HORIZON.clone();
        gl.toneMapping = THREE.ACESFilmicToneMapping;
        gl.toneMappingExposure = 1.05;
        onReady?.();
      }}
    >
      <Sky />
      <Lights shadows={false} />
      <Terrain />
      <River />
      <Forest />
      <GroundMarker />
      <Rig animate={animate} />
    </Canvas>
  );
}
