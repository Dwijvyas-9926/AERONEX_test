import { useEffect, useRef } from "react";
import { notify } from "../state/notifyStore";
import { useLink, type LinkStatus } from "../state/linkStore";

/** Surface link state transitions as notifications, wherever the user is in the app. */
export function useLinkNotifications() {
  const status = useLink((s) => s.status);
  const vehicle = useLink((s) => s.vehicle);
  const error = useLink((s) => s.error);
  const prev = useRef<LinkStatus>(status);
  // What was linked before this change, so "disconnected" can say what stopped.
  const wasVirtual = useRef(false);

  useEffect(() => {
    const p = prev.current;
    prev.current = status;
    const virtualBefore = wasVirtual.current;
    wasVirtual.current = useLink.getState().virtual;
    if (p === status) return;
    if (status === "connected" && p !== "stale") {
      const { vehicle: v, virtual } = useLink.getState();
      if (virtual) notify("info", "Virtual aircraft linked", "Every reading from now on is simulated. No real flight controller is connected.");
      else notify("success", "Aircraft connected", v ? `${v.typeLabel} running ${v.firmwareLabel}, system ${v.sysid}.` : undefined);
    } else if (status === "connected" && p === "stale") {
      notify("info", "Heartbeats resumed");
    } else if (status === "stale") {
      notify("warn", "Telemetry stale", "No heartbeat for 3 seconds. Values on screen are no longer current.");
    } else if (status === "no-heartbeat") {
      notify("warn", "No heartbeat yet", "The port is open but no autopilot heartbeat has arrived. Check the baud rate.");
    } else if (status === "lost") {
      notify("error", "Connection lost", error?.detail);
    } else if (status === "error" && error) {
      notify("error", error.title, error.detail);
    } else if (status === "idle" && (p === "connected" || p === "stale" || p === "no-heartbeat" || p === "listening")) {
      notify("info", "Disconnected", virtualBefore ? "The virtual aircraft has stopped." : "The serial port has been closed.");
    }
  }, [status, error, vehicle]);
}
