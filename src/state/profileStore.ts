import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import type { VehicleProfile } from "../vehicle/types";

const uid = () => (crypto.randomUUID ? crypto.randomUUID() : `p-${Date.now()}-${Math.random().toString(36).slice(2)}`);

function seedProfile(): VehicleProfile {
  const t = Date.now();
  return {
    id: uid(),
    name: "Avion",
    frame: "quad-x",
    firmware: "unsure",
    board: "pixhawk-2.4.8",
    massGrams: null,
    diagonalMm: null,
    notes: "",
    model: { source: "default" },
    createdAt: t,
    updatedAt: t,
  };
}

interface ProfileState {
  profiles: VehicleProfile[];
  activeId: string | null;
  create: (p?: Partial<VehicleProfile>) => VehicleProfile;
  update: (id: string, patch: Partial<Omit<VehicleProfile, "id" | "createdAt">>) => void;
  duplicate: (id: string) => VehicleProfile | null;
  remove: (id: string) => void;
  setActive: (id: string) => void;
}

export const useProfiles = create<ProfileState>()(
  persist(
    (set, get) => {
      const first = seedProfile();
      return {
        profiles: [first],
        activeId: first.id,
        create: (p = {}) => {
          const t = Date.now();
          const prof: VehicleProfile = { ...seedProfile(), name: "New aircraft", ...p, id: uid(), createdAt: t, updatedAt: t };
          set((s) => ({ profiles: [...s.profiles, prof], activeId: prof.id }));
          return prof;
        },
        update: (id, patch) =>
          set((s) => ({ profiles: s.profiles.map((p) => (p.id === id ? { ...p, ...patch, updatedAt: Date.now() } : p)) })),
        duplicate: (id) => {
          const src = get().profiles.find((p) => p.id === id);
          if (!src) return null;
          const t = Date.now();
          const copy: VehicleProfile = { ...src, id: uid(), name: `${src.name} copy`, createdAt: t, updatedAt: t };
          set((s) => ({ profiles: [...s.profiles, copy] }));
          return copy;
        },
        remove: (id) =>
          set((s) => {
            const profiles = s.profiles.filter((p) => p.id !== id);
            return { profiles, activeId: s.activeId === id ? (profiles[0]?.id ?? null) : s.activeId };
          }),
        setActive: (id) => set({ activeId: id }),
      };
    },
    { name: "avion.profiles.v1", storage: createJSONStorage(() => localStorage), version: 1 },
  ),
);

export const useActiveProfile = () =>
  useProfiles((s) => s.profiles.find((p) => p.id === s.activeId) ?? null);
