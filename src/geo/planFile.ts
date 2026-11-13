import type { MissionItem } from "../sim/autopilot";

/*
  Plans as files.

  The format is the plain-text waypoint list that Mission Planner,
  QGroundControl and MAVProxy all read and write: a header line, then one
  mission item per line, twelve tab-separated fields. A plan saved here opens
  in those tools, and a mission made in them opens here.

      QGC WPL 110
      index  current  frame  command  p1  p2  p3  p4  lat  lon  alt  autocontinue
*/
const HEADER = "QGC WPL 110";

const f = (v: number, places: number) => (Number.isInteger(v) ? String(v) : v.toFixed(places).replace(/\.?0+$/, ""));

export function toWaypointFile(items: MissionItem[]): string {
  const rows = items.map((it, i) => [i, i === 0 ? 1 : 0, it.frame, it.command, f(it.p1, 6), f(it.p2, 6), f(it.p3, 6), f(it.p4, 6), (it.x / 1e7).toFixed(7), (it.y / 1e7).toFixed(7), f(it.z, 3), 1].join("\t"));
  return `${HEADER}\n${rows.join("\n")}\n`;
}

/** Reads a waypoint file. Throws, in words for the reader, when it is not one. */
export function fromWaypointFile(text: string): MissionItem[] {
  const lines = text
    .replace(/^﻿/, "")
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  if (!lines.length || !/^QGC WPL \d+/.test(lines[0])) {
    throw new Error(text.trimStart().startsWith("{") ? "This looks like a QGroundControl .plan file. In QGroundControl, save the mission as a .waypoints file instead and open that." : "This is not a waypoint file: the first line should read QGC WPL 110.");
  }
  const items: MissionItem[] = [];
  for (const [k, line] of lines.slice(1).entries()) {
    const c = line.split(/\s+/).map(Number);
    if (c.length < 11 || c.slice(0, 11).some((v) => !Number.isFinite(v))) throw new Error(`Line ${k + 2} of the file cannot be read as a mission item.`);
    if (Math.abs(c[8]) > 90 || Math.abs(c[9]) > 180) throw new Error(`Line ${k + 2} has a position that is not on the Earth.`);
    items.push({ seq: items.length, frame: c[2], command: c[3], p1: c[4], p2: c[5], p3: c[6], p4: c[7], x: Math.round(c[8] * 1e7), y: Math.round(c[9] * 1e7), z: c[10] });
  }
  if (!items.length) throw new Error("The file holds no mission items.");
  return items;
}

/** Hands a text file to the browser to save. */
export function saveText(name: string, text: string) {
  const url = URL.createObjectURL(new Blob([text], { type: "text/plain" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.append(a);
  a.click();
  a.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}
