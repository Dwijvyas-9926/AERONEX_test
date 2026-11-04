import { useFrame } from "@react-three/fiber";
import { useMemo, useRef, type MutableRefObject } from "react";
import * as THREE from "three";

/*
  Default virtual quadcopter, built procedurally so the app has a polished
  aircraft with no external assets. Body frame follows rendering/frames.ts:
  nose along -Z, right along +X, up along +Y. Dimensions approximate a
  550 mm-class X frame with 10-inch props (Avion's class of airframe).
*/

const ARM = 0.275; // centre to motor axis, metres
const PROP_R = 0.127;

export interface QuadcopterProps {
  /** Prop speed in rad/s, read every frame (not a React prop, so it never re-renders). */
  spin?: MutableRefObject<number>;
  /** Show the translucent motion disc behind each prop. */
  discs?: boolean;
  castShadow?: boolean;
}

// Motor layout for quad X: [x, z, direction]. FR and RL spin CCW (+1), FL and RR spin CW (-1).
const MOTORS: [number, number, 1 | -1][] = [
  [ARM * Math.SQRT1_2, -ARM * Math.SQRT1_2, 1],
  [-ARM * Math.SQRT1_2, ARM * Math.SQRT1_2, 1],
  [-ARM * Math.SQRT1_2, -ARM * Math.SQRT1_2, -1],
  [ARM * Math.SQRT1_2, ARM * Math.SQRT1_2, -1],
];

function useMaterials() {
  return useMemo(
    () => ({
      carbon: new THREE.MeshStandardMaterial({ color: "#201812", roughness: 0.38, metalness: 0.25 }),
      carbonEdge: new THREE.MeshStandardMaterial({ color: "#302419", roughness: 0.5, metalness: 0.2 }),
      shell: new THREE.MeshStandardMaterial({ color: "#e9ddc5", roughness: 0.42, metalness: 0.05 }),
      shellDark: new THREE.MeshStandardMaterial({ color: "#9c8a6e", roughness: 0.5, metalness: 0.1 }),
      accent: new THREE.MeshStandardMaterial({ color: "#d8a648", roughness: 0.35, emissive: "#6e4a12", emissiveIntensity: 0.55 }),
      motor: new THREE.MeshStandardMaterial({ color: "#564a3b", roughness: 0.22, metalness: 0.9 }),
      motorDark: new THREE.MeshStandardMaterial({ color: "#1a140e", roughness: 0.5, metalness: 0.6 }),
      prop: new THREE.MeshStandardMaterial({ color: "#140f0a", roughness: 0.7, metalness: 0 }),
      disc: new THREE.MeshBasicMaterial({ color: "#c7b48f", transparent: true, opacity: 0.07, depthWrite: false, side: THREE.DoubleSide }),
      battery: new THREE.MeshStandardMaterial({ color: "#2a2017", roughness: 0.7 }),
      lens: new THREE.MeshStandardMaterial({ color: "#0a0806", roughness: 0.05, metalness: 0.9 }),
      red: new THREE.MeshBasicMaterial({ color: "#ff3b3b" }),
      green: new THREE.MeshBasicMaterial({ color: "#3dff8a" }),
      white: new THREE.MeshBasicMaterial({ color: "#ffffff" }),
      gpsTop: new THREE.MeshStandardMaterial({ color: "#cf9a44", roughness: 0.5 }),
    }),
    [],
  );
}

function Prop({ dir, spin, discs, m }: { dir: 1 | -1; spin?: MutableRefObject<number>; discs: boolean; m: ReturnType<typeof useMaterials> }) {
  const ref = useRef<THREE.Group>(null);
  useFrame((_, dt) => {
    if (ref.current && spin) ref.current.rotation.y += dir * spin.current * Math.min(dt, 0.05);
  });
  return (
    <group>
      <group ref={ref}>
        {[1, -1].map((s) => (
          <mesh key={s} material={m.prop} position={[(s * PROP_R) / 2, 0, 0]} rotation={[s * dir * 0.2, 0, 0]} castShadow>
            <boxGeometry args={[PROP_R * 0.96, 0.003, 0.016]} />
          </mesh>
        ))}
        <mesh material={m.motorDark}>
          <cylinderGeometry args={[0.009, 0.009, 0.012, 12]} />
        </mesh>
      </group>
      {discs && (
        <mesh material={m.disc} rotation={[-Math.PI / 2, 0, 0]}>
          <circleGeometry args={[PROP_R, 40]} />
        </mesh>
      )}
    </group>
  );
}

export function Quadcopter({ spin, discs = true, castShadow = true }: QuadcopterProps) {
  const m = useMaterials();
  const strobe = useRef<THREE.Group>(null);
  useFrame(({ clock }) => {
    if (strobe.current) strobe.current.visible = clock.elapsedTime % 1.2 < 0.08;
  });

  return (
    <group>
      {/* Centre plates: octagonal carbon sandwich */}
      {[0.018, -0.012].map((y) => (
        <mesh key={y} material={m.carbon} position={[0, y, 0]} rotation={[0, Math.PI / 8, 0]} castShadow={castShadow}>
          <cylinderGeometry args={[0.105, 0.105, 0.005, 8]} />
        </mesh>
      ))}
      {/* Standoffs */}
      {[0, 1, 2, 3].map((i) => {
        const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
        return (
          <mesh key={i} material={m.carbonEdge} position={[Math.cos(a) * 0.075, 0.003, Math.sin(a) * 0.075]}>
            <cylinderGeometry args={[0.004, 0.004, 0.03, 8]} />
          </mesh>
        );
      })}

      {/* Arms */}
      {MOTORS.map(([x, z], i) => (
        <mesh
          key={i}
          material={m.carbon}
          position={[x / 2, 0.003, z / 2]}
          rotation={[Math.PI / 2, 0, Math.atan2(x, -z)]}
          castShadow={castShadow}
        >
          <cylinderGeometry args={[0.011, 0.011, ARM, 14]} />
        </mesh>
      ))}

      {/* Canopy over the avionics */}
      <group position={[0, 0.026, 0.005]}>
        <mesh material={m.shell} scale={[0.078, 0.036, 0.13]} castShadow={castShadow}>
          <sphereGeometry args={[1, 32, 20, 0, Math.PI * 2, 0, Math.PI / 2]} />
        </mesh>
        <mesh material={m.accent} position={[0, 0.025, -0.004]} scale={[0.008, 0.012, 0.115]}>
          <sphereGeometry args={[1, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2]} />
        </mesh>
        <mesh material={m.shellDark} position={[0, 0.001, 0]} scale={[0.087, 0.004, 0.127]}>
          <cylinderGeometry args={[1, 1, 1, 32]} />
        </mesh>
      </group>

      {/* GPS mast at the rear */}
      <group position={[0, 0.026, 0.07]}>
        <mesh material={m.carbonEdge} position={[0, 0.05, 0]}>
          <cylinderGeometry args={[0.004, 0.004, 0.1, 8]} />
        </mesh>
        <mesh material={m.shellDark} position={[0, 0.104, 0]} castShadow={castShadow}>
          <cylinderGeometry args={[0.026, 0.026, 0.01, 24]} />
        </mesh>
        <mesh material={m.gpsTop} position={[0, 0.111, 0]}>
          <cylinderGeometry args={[0.012, 0.012, 0.003, 16]} />
        </mesh>
      </group>

      {/* Battery under the frame */}
      <mesh material={m.battery} position={[0, -0.04, 0.005]} castShadow={castShadow}>
        <boxGeometry args={[0.055, 0.045, 0.15]} />
      </mesh>
      <mesh material={m.accent} position={[0, -0.04, -0.0705]}>
        <boxGeometry args={[0.04, 0.012, 0.002]} />
      </mesh>

      {/* Forward depth camera */}
      <group position={[0, -0.022, -0.115]} rotation={[-0.25, 0, 0]}>
        <mesh material={m.motorDark}>
          <boxGeometry args={[0.1, 0.026, 0.026]} />
        </mesh>
        {[-0.034, 0, 0.034].map((x) => (
          <mesh key={x} material={m.lens} position={[x, 0, -0.0135]} rotation={[Math.PI / 2, 0, 0]}>
            <cylinderGeometry args={[0.0065, 0.0065, 0.002, 16]} />
          </mesh>
        ))}
      </group>

      {/* Payload release hook */}
      <mesh material={m.shellDark} position={[0, -0.075, 0.005]}>
        <boxGeometry args={[0.02, 0.025, 0.03]} />
      </mesh>

      {/* Landing gear: two skids */}
      {[-1, 1].map((s) => (
        <group key={s} position={[s * 0.075, -0.015, 0]}>
          {[-0.06, 0.06].map((z) => (
            <mesh key={z} material={m.carbon} position={[s * 0.02, -0.07, z]} rotation={[0, 0, s * 0.28]}>
              <cylinderGeometry args={[0.005, 0.005, 0.15, 8]} />
            </mesh>
          ))}
          <mesh material={m.carbon} position={[s * 0.04, -0.142, 0]} rotation={[Math.PI / 2, 0, 0]}>
            <cylinderGeometry args={[0.006, 0.006, 0.22, 10]} />
          </mesh>
        </group>
      ))}

      {/* Motors, props and nav lights */}
      {MOTORS.map(([x, z, dir], i) => (
        <group key={i} position={[x, 0.003, z]}>
          <mesh material={m.motorDark} position={[0, 0.012, 0]} castShadow={castShadow}>
            <cylinderGeometry args={[0.022, 0.024, 0.014, 24]} />
          </mesh>
          <mesh material={m.motor} position={[0, 0.03, 0]} castShadow={castShadow}>
            <cylinderGeometry args={[0.021, 0.022, 0.022, 28]} />
          </mesh>
          <mesh material={m.motorDark} position={[0, 0.042, 0]}>
            <cylinderGeometry args={[0.012, 0.016, 0.004, 20]} />
          </mesh>
          <group position={[0, 0.05, 0]}>
            <Prop dir={dir} spin={spin} discs={discs} m={m} />
          </group>
          {/* Port red, starboard green on the front arms */}
          {i === 2 && (
            <mesh material={m.red} position={[0, -0.012, 0]}>
              <sphereGeometry args={[0.007, 10, 8]} />
            </mesh>
          )}
          {i === 0 && (
            <mesh material={m.green} position={[0, -0.012, 0]}>
              <sphereGeometry args={[0.007, 10, 8]} />
            </mesh>
          )}
        </group>
      ))}
      <group ref={strobe}>
        {MOTORS.filter(([, z]) => z > 0).map(([x, z], i) => (
          <mesh key={i} material={m.white} position={[x, -0.009, z]}>
            <sphereGeometry args={[0.008, 10, 8]} />
          </mesh>
        ))}
      </group>
    </group>
  );
}
