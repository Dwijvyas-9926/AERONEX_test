import { useCallback, useState } from "react";
import { commandLink } from "../../services/link/commandLink";
import { useLink } from "../../state/linkStore";
import { confirmAction, notify } from "../../state/notifyStore";

/*
  Staged parameter edits. Changes are held locally until the operator explicitly
  uploads them — the UI never writes to the vehicle on its own. Upload writes each
  changed parameter and keeps any that failed so they stay flagged as unsaved.

  A value that is not a finite number is never sent. On an armed aircraft every
  upload is confirmed first: a parameter takes effect the moment it is written,
  in the air as much as on the ground.
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
    const bad = entries.filter(([, v]) => !Number.isFinite(v)).map(([n]) => n);
    if (bad.length) {
      notify("error", "Not uploaded", `${bad.join(", ")} ${bad.length === 1 ? "is" : "are"} not a number. Correct ${bad.length === 1 ? "it" : "them"} and upload again.`);
      return;
    }
    if (useLink.getState().vehicle?.armed) {
      const ok = await confirmAction({
        title: "Upload to an armed aircraft?",
        body: `The aircraft is armed. ${entries.length === 1 ? "This change takes" : `These ${entries.length} changes take`} effect the moment ${entries.length === 1 ? "it is" : "they are"} written, in flight too. A wrong value can make it hard to control. Upload only if you are ready to take over on the radio.`,
        confirmLabel: "Upload while armed",
        tone: "danger",
      });
      if (!ok) return;
    }
    setUploading(true);
    const failed: Record<string, number> = {};
    for (const [name, value] of entries) {
      try {
        await commandLink.setParam(name, value, 4000, true);
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
