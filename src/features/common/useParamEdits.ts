import { useCallback, useState } from "react";
import { commandLink } from "../../services/link/commandLink";

/*
  Staged parameter edits. Changes are held locally until the operator explicitly
  uploads them — the UI never writes to the vehicle on its own. Upload writes each
  changed parameter and keeps any that failed so they stay flagged as unsaved.
*/

export function useParamEdits() {
  const [edits, setEdits] = useState<Record<string, number>>({});
  const [uploading, setUploading] = useState(false);

  const setEdit = useCallback((name: string, value: number) => setEdits((e) => ({ ...e, [name]: value })), []);
  const clearEdit = useCallback((name: string) => setEdits((e) => { const n = { ...e }; delete n[name]; return n; }), []);
  const revert = useCallback(() => setEdits({}), []);

  const upload = useCallback(async () => {
    const entries = Object.entries(edits);
    if (!entries.length) return;
    setUploading(true);
    const failed: Record<string, number> = {};
    for (const [name, value] of entries) {
      try {
        await commandLink.setParam(name, value);
      } catch {
        failed[name] = value;
      }
    }
    setEdits(failed);
    setUploading(false);
  }, [edits]);

  return { edits, setEdit, clearEdit, revert, upload, uploading, count: Object.keys(edits).length };
}

export type ParamEdits = ReturnType<typeof useParamEdits>;
