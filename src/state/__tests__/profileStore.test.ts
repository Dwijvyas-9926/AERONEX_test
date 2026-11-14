import { describe, expect, it, vi } from "vitest";

/* An imported 3D model is stored apart from its profile, under the profile's id. */

const stored = new Map<string, { bytes: ArrayBuffer; filename: string }>();
vi.mock("../../services/import/modelDB", () => ({
  idbAvailable: () => true,
  getModel: async (id: string) => stored.get(id),
  putModel: async (id: string, m: { bytes: ArrayBuffer; filename: string }) => void stored.set(id, m),
  deleteModel: async (id: string) => void stored.delete(id),
}));

describe("profiles with an imported model", () => {
  it("a duplicate gets its own copy of the model, and deleting a profile frees its model", async () => {
    const { useProfiles } = await import("../profileStore");
    const p = useProfiles.getState().create({ name: "Frame A" });
    useProfiles.getState().update(p.id, { model: { source: "imported", filename: "a.glb", format: "glb", sizeBytes: 3, importedAt: 1 } as never });
    stored.set(p.id, { bytes: new ArrayBuffer(3), filename: "a.glb" });

    const copy = useProfiles.getState().duplicate(p.id)!;
    await vi.waitFor(() => expect(stored.has(copy.id)).toBe(true));

    useProfiles.getState().remove(p.id);
    await vi.waitFor(() => expect(stored.has(p.id)).toBe(false));
    expect(stored.has(copy.id)).toBe(true);
  });
});
