import type { LinkStatus } from "../../state/linkStore";

export interface StatusView {
  label: string;
  tone: "idle" | "accent" | "ok" | "warn" | "danger";
  live: boolean;
}

export const LINK_STATUS: Record<LinkStatus, StatusView> = {
  idle: { label: "No aircraft linked", tone: "idle", live: false },
  selecting: { label: "Choosing a port", tone: "accent", live: true },
  opening: { label: "Opening port", tone: "accent", live: true },
  listening: { label: "Waiting for heartbeat", tone: "accent", live: true },
  "no-heartbeat": { label: "No heartbeat", tone: "warn", live: false },
  connected: { label: "Connected", tone: "ok", live: true },
  stale: { label: "Telemetry stale", tone: "warn", live: false },
  lost: { label: "Link lost", tone: "danger", live: false },
  error: { label: "Connection failed", tone: "danger", live: false },
};

/** Telemetry older than this is shown dimmed and flagged as stale. */
export const TELEMETRY_STALE_MS = 3000;
