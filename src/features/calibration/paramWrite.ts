import { useEffect } from "react";
import { commandLink } from "../../services/link/commandLink";
import { notify } from "../../state/notifyStore";

/* Request a fixed set of params once the vehicle can take commands. */
export function useRequireParams(names: string[], enabled: boolean) {
  const key = names.join(",");
  useEffect(() => {
    if (!enabled) return;
    void commandLink.requestParams(names);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, enabled]);
}

/**
 * Write one setting from a setup control, and say so if it is refused or
 * not confirmed. These controls write on every change, so they are disabled
 * while the aircraft is armed, and the command layer refuses the write too.
 */
export function writeParam(name: string, value: number) {
  commandLink.setParam(name, value).catch((e: Error) => notify("error", `${name} not saved`, e.message));
}

