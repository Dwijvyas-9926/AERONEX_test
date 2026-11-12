/*
  Ask the Doctor — Anthropic client (bring-your-own-key).

  Calls the Anthropic Messages API directly from the browser using the user's
  own key, with streaming. No AERONEX backend is involved; the key never leaves
  the user's browser except in the request to Anthropic. The system prompt and
  a live snapshot of the connected drone (buildDroneContext) are what make the
  answers specific and verifiable.
*/

import type { Telemetry, VehicleIdentity } from "../../state/linkStore";
import { buildSystemPrompt } from "./droneKnowledge";
import type { Finding } from "./diagnostics";

const ANTHROPIC_URL = "https://api.anthropic.com/v1/messages";
const ANTHROPIC_VERSION = "2023-06-01";

export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

export interface AskOptions {
  apiKey: string;
  model: string;
  messages: ChatMessage[];
  context: string | null;
  onDelta: (text: string) => void;
  signal?: AbortSignal;
}

const fresh = (at: number | undefined, now: number) => at != null && now - at < 6000;
const n1 = (v: number) => v.toFixed(1);
const n2 = (v: number) => v.toFixed(2);

/** Compact, human-readable snapshot of the live vehicle for grounding. */
export function buildDroneContext(args: {
  vehicle: VehicleIdentity | null | undefined;
  armed: boolean;
  findings: Finding[];
  telemetry: Telemetry;
  params: Record<string, number>;
}): string | null {
  const { vehicle, armed, findings, telemetry: t, params } = args;
  if (!vehicle) return null;
  const now = Date.now();
  const lines: string[] = [];

  lines.push(`Vehicle: ${vehicle.firmwareLabel ?? "ArduPilot"} (system ${vehicle.sysid ?? "?"}), ${armed ? "ARMED" : "disarmed"}.`);

  const issues = findings.filter((f) => f.severity !== "ok");
  if (findings.length) {
    if (issues.length) {
      lines.push(`Doctor findings (issues): ${issues.map((f) => `[${f.severity}] ${f.title}${f.metric ? ` (${f.metric})` : ""}`).join("; ")}.`);
    } else {
      lines.push(`Doctor findings: all checks passing.`);
    }
  }

  const live: string[] = [];
  if (t.vibration && fresh(t.vibration.at, now)) {
    const v = t.vibration.value;
    live.push(`vibration peak ${n1(Math.max(v.x, v.y, v.z))} m/s² (x${n1(v.x)}/y${n1(v.y)}/z${n1(v.z)}), clipping ${v.clip0 + v.clip1 + v.clip2}`);
  }
  if (t.ekf && fresh(t.ekf.at, now)) {
    const e = t.ekf.value;
    live.push(`EKF variances compass ${n2(e.compass)}, velocity ${n2(e.velVar)}, posH ${n2(e.posHoriz)}, posV ${n2(e.posVert)}`);
  }
  if (t.gps && fresh(t.gps.at, now)) {
    const g = t.gps.value;
    live.push(`GPS fix ${g.fixType}, ${g.satellites ?? "?"} sats, HDOP ${g.hdop != null ? n1(g.hdop) : "?"}`);
  }
  if (t.battery && fresh(t.battery.at, now) && t.battery.value.voltage != null) {
    const b = t.battery.value;
    live.push(`battery ${n2(b.voltage!)} V${b.current != null ? `, ${n1(b.current)} A` : ""}${b.remaining != null ? `, ${b.remaining}%` : ""}`);
  }
  if (t.attitude && fresh(t.attitude.at, now)) {
    const a = t.attitude.value;
    live.push(`attitude roll ${n1((a.roll * 180) / Math.PI)}°, pitch ${n1((a.pitch * 180) / Math.PI)}°`);
  }
  if (live.length) lines.push(`Live telemetry: ${live.join("; ")}.`);

  const PARAM_KEYS = ["FRAME_CLASS", "FRAME_TYPE", "MOT_THST_HOVER", "FS_EKF_THRESH", "COMPASS_USE", "ARMING_CHECK", "BATT_MONITOR", "ATC_RAT_RLL_P", "ATC_RAT_RLL_D", "ATC_RAT_PIT_P", "ATC_ANG_RLL_P"];
  const shown = PARAM_KEYS.filter((k) => params[k] !== undefined).map((k) => `${k}=${params[k]}`);
  if (shown.length) lines.push(`Selected parameters: ${shown.join(", ")}.`);

  return lines.join("\n");
}

/**
 * Stream a reply from Anthropic. Calls onDelta with text chunks and resolves
 * with the full text. Throws an Error with a friendly message on failure.
 */
export async function askDoctor(opts: AskOptions): Promise<string> {
  const system = buildSystemPrompt({ context: opts.context });

  let res: Response;
  try {
    res = await fetch(ANTHROPIC_URL, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": opts.apiKey,
        "anthropic-version": ANTHROPIC_VERSION,
        "anthropic-dangerous-direct-browser-access": "true",
      },
      body: JSON.stringify({
        model: opts.model,
        max_tokens: 1200,
        system,
        messages: opts.messages.map((m) => ({ role: m.role, content: m.content })),
        stream: true,
      }),
      signal: opts.signal,
    });
  } catch (e) {
    if ((e as Error).name === "AbortError") throw e;
    throw new Error("Couldn't reach Anthropic. Check your internet connection.");
  }

  if (!res.ok || !res.body) {
    let msg = `Request failed (HTTP ${res.status}).`;
    try {
      const body = await res.json();
      const detail = body?.error?.message as string | undefined;
      if (res.status === 401) msg = "Your API key was rejected (401). Check it in Settings.";
      else if (res.status === 404 && detail?.toLowerCase().includes("model")) msg = `Model "${opts.model}" isn't available on your account. Choose a different model in Settings.`;
      else if (res.status === 429) msg = "Rate limited by Anthropic (429). Wait a moment and try again.";
      else if (detail) msg = detail;
    } catch {
      /* non-JSON error body */
    }
    throw new Error(msg);
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let full = "";

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const events = buffer.split("\n\n");
    buffer = events.pop() ?? "";
    for (const evt of events) {
      const dataLine = evt.split("\n").find((l) => l.startsWith("data:"));
      if (!dataLine) continue;
      const json = dataLine.slice(5).trim();
      if (!json || json === "[DONE]") continue;
      let parsed: { type?: string; delta?: { type?: string; text?: string }; error?: { message?: string } };
      try {
        parsed = JSON.parse(json);
      } catch {
        continue;
      }
      if (parsed.type === "error") throw new Error(parsed.error?.message ?? "The model returned an error.");
      if (parsed.type === "content_block_delta" && parsed.delta?.type === "text_delta" && parsed.delta.text) {
        full += parsed.delta.text;
        opts.onDelta(parsed.delta.text);
      }
    }
  }
  return full;
}
