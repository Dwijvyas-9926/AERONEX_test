import { CloudDownload, Home as HomeIcon, Layers, LocateFixed, Maximize, Minus, Mountain, Navigation, Plus, WifiOff, X } from "lucide-react";
import maplibregl, { type GeoJSONSource, type Map as MlMap, type Marker, type StyleSpecification } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { useEffect, useRef, useState } from "react";
import { covers, sampleDem } from "../../geo/elevation";
import { parseLatLon, tilesIn, tileUrl, toGlobal, toLocal, type LatLon } from "../../geo/geo";
import { ELEVATION, IMAGERY, imageryById, imageryUrl, KEPT } from "../../geo/sources";
import { clearKept, keptCount, keptFetch, saveTiles } from "../../geo/tileCache";
import { useHomeSource } from "../../services/link/homeFollow";
import { useLink } from "../../state/linkStore";
import { useDem, useMapPrefs } from "../../state/mapStore";
import { notify } from "../../state/notifyStore";

/*
  The route on a real map: a satellite picture over measured ground.

  Everything the plan holds is in metres from home, so this converts at the
  edge, on the way in and on the way out. Waypoints and home are dragged
  where the old map had number boxes; the aircraft, when one is linked, is
  drawn where its own GPS says it is.

  The picture is evidence of where things are, not of what is in the way: it
  may be years old, and the ground heights know nothing of trees or wires.
*/
export interface RealMapProps {
  home: LatLon;
  route: { id: string; n: number; e: number; label: string; tag?: string }[];
  closeRoute?: boolean;
  /** A second path, such as a predicted flight. */
  ghost?: { n: number; e: number }[];
  fenceRadius?: number | null;
  mark?: { n: number; e: number; label: string; tone: "ok" | "bad" } | null;
  /** Where the route comes closest to the ground, when that is worth showing. */
  low?: { n: number; e: number; clear: number } | null;
  wind?: { speed: number; fromDeg: number } | null;
  /** Home cannot be moved: an aircraft is flying from it. */
  homeLocked?: boolean;
  onPick?: (n: number, e: number) => void;
  onMovePoint?: (id: string, n: number, e: number) => void;
  onMoveHome?: (to: LatLon) => void;
}

const kept = (url: string) => url.replace("https://", KEPT);

let protocolReady = false;
function registerProtocol() {
  if (protocolReady) return;
  protocolReady = true;
  // Tiles from open sources go through the app's own store, so they survive the field.
  maplibregl.addProtocol("aeronex", async (params, abort) => {
    const res = await keptFetch(`https://${params.url.slice(KEPT.length)}`, abort.signal);
    if (!res.ok) throw new Error(`Tile ${res.status}`);
    return { data: await res.arrayBuffer() };
  });
}

type Shape = Parameters<GeoJSONSource["setData"]>[0];
const EMPTY = { type: "FeatureCollection" as const, features: [] };
const line = (pts: LatLon[]) => ({ type: "Feature" as const, properties: {}, geometry: { type: "LineString" as const, coordinates: pts.map((p) => [p.lon, p.lat]) } });

function baseStyle(): StyleSpecification {
  const dem = { type: "raster-dem" as const, tiles: [kept(ELEVATION.url)], tileSize: ELEVATION.tileSize, maxzoom: ELEVATION.maxZoom, encoding: "terrarium" as const };
  return {
    version: 8,
    sources: {
      // One for the 3D ground and one for the shading, as the library advises.
      dem,
      shade: dem,
      fence: { type: "geojson", data: EMPTY },
      route: { type: "geojson", data: EMPTY },
      ghost: { type: "geojson", data: EMPTY },
      track: { type: "geojson", data: EMPTY },
    },
    layers: [
      { id: "bg", type: "background", paint: { "background-color": "#1d1a14" } },
      { id: "shade", type: "hillshade", source: "shade", paint: { "hillshade-exaggeration": 0.4, "hillshade-shadow-color": "#0c0a06", "hillshade-highlight-color": "#fff6dc", "hillshade-accent-color": "#201a10" } },
      { id: "fence", type: "line", source: "fence", paint: { "line-color": "#e07b33", "line-width": 2, "line-dasharray": [3, 2] } },
      { id: "route-edge", type: "line", source: "route", layout: { "line-cap": "round", "line-join": "round" }, paint: { "line-color": "#120c08", "line-width": 6, "line-opacity": 0.75 } },
      { id: "route", type: "line", source: "route", layout: { "line-cap": "round", "line-join": "round" }, paint: { "line-color": "#f0c060", "line-width": 3 } },
      { id: "ghost", type: "line", source: "ghost", paint: { "line-color": "#d9b3e6", "line-width": 2.5, "line-dasharray": [2, 1.5] } },
      { id: "track", type: "line", source: "track", paint: { "line-color": "#ffffff", "line-width": 2 } },
    ],
  };
}

function dot(cls: string, label: string, tag?: string): HTMLDivElement {
  const el = document.createElement("div");
  el.className = cls;
  const b = document.createElement("b");
  b.textContent = label;
  el.append(b);
  if (tag) {
    const s = document.createElement("span");
    s.textContent = tag;
    el.append(s);
  }
  // A click on a marker is not a click on the map.
  el.addEventListener("click", (e) => e.stopPropagation());
  return el;
}

export default function RealMap(props: RealMapProps) {
  const { home, route, closeRoute, ghost, fenceRadius, mark, low, wind, homeLocked } = props;
  const box = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MlMap | null>(null);
  const latest = useRef(props);
  latest.current = props;
  const marks = useRef(new Map<string, Marker>());
  const homeMark = useRef<Marker | null>(null);
  const extra = useRef<{ mark: Marker | null; low: Marker | null; ac: Marker | null }>({ mark: null, low: null, ac: null });
  const trail = useRef<LatLon[]>([]);
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState<string | null>(null);
  const [panel, setPanel] = useState(false);
  const [pointer, setPointer] = useState<LatLon | null>(null);
  const [online, setOnline] = useState(typeof navigator === "undefined" ? true : navigator.onLine);
  const [saved, setSaved] = useState(0);
  const [saving, setSaving] = useState<{ done: number; total: number } | null>(null);
  const [goto, setGoto] = useState("");
  // The next click on the map puts home there, instead of adding a waypoint.
  const [placing, setPlacing] = useState(false);
  const placingRef = useRef(false);
  placingRef.current = placing;
  const stopSave = useRef<AbortController | null>(null);

  const prefs = useMapPrefs();
  const src = imageryById(prefs.imagery);
  const url = imageryUrl(src, prefs.keys, prefs.customUrl);
  const patch = useDem((s) => s.patch);
  const linked = useLink((s) => s.status === "connected");
  const virtual = useLink((s) => s.virtual);
  const pos = useLink((s) => s.telemetry.position?.value);
  const hudHeading = useLink((s) => s.telemetry.hud?.value.heading);
  const sats = useLink((s) => s.telemetry.gps?.value.satellites ?? null);
  const homeFrom = useHomeSource((h) => h.source);
  const taken = useHomeSource((h) => h.taken);

  /** Home, the route and whatever else is drawn, as a box to fit the view to. */
  const fit = (animate = true) => {
    const map = mapRef.current;
    if (!map) return;
    const p = latest.current;
    const b = new maplibregl.LngLatBounds();
    const see = (n: number, e: number) => {
      const g = toGlobal(p.home, n, e);
      b.extend([g.lon, g.lat]);
    };
    // Never closer than a few fields, so home alone still shows its surroundings.
    see(350, 350);
    see(-350, -350);
    p.route.forEach((r) => see(r.n, r.e));
    p.ghost?.forEach((r) => see(r.n, r.e));
    if (p.mark) see(p.mark.n, p.mark.e);
    map.fitBounds(b, { padding: 64, maxZoom: 16, duration: animate ? 500 : 0 });
  };

  /* ------------------------------------------------------------- the map */
  useEffect(() => {
    if (!box.current) return;
    registerProtocol();
    let map: MlMap;
    try {
      map = new maplibregl.Map({
        container: box.current,
        style: baseStyle(),
        center: [latest.current.home.lon, latest.current.home.lat],
        zoom: 15,
        maxPitch: 75,
        // The ground heights are used whatever picture is shown, so they are always credited.
        attributionControl: { compact: false, customAttribution: ELEVATION.attribution },
        // The picture is all there is to see: no need to keep drawing copies of the world.
        renderWorldCopies: false,
      });
    } catch (e) {
      setFailed((e as Error).message || "This browser could not start the map.");
      return;
    }
    mapRef.current = map;
    map.addControl(new maplibregl.ScaleControl({ unit: "metric", maxWidth: 120 }), "top-left");
    map.dragRotate.enable();
    map.on("load", () => {
      fit(false);
      setReady(true);
    });
    map.on("click", (ev) => {
      const p = latest.current;
      if (placingRef.current) {
        setPlacing(false);
        p.onMoveHome?.({ lat: ev.lngLat.lat, lon: ev.lngLat.lng });
        return;
      }
      if (!p.onPick) return;
      const l = toLocal(p.home, ev.lngLat.lat, ev.lngLat.lng);
      p.onPick(l.n, l.e);
    });
    let last = 0;
    map.on("mousemove", (ev) => {
      const now = performance.now();
      if (now - last < 80) return;
      last = now;
      setPointer({ lat: ev.lngLat.lat, lon: ev.lngLat.lng });
    });
    map.on("mouseout", () => setPointer(null));
    const esc = (ev: KeyboardEvent) => ev.key === "Escape" && setPlacing(false);
    window.addEventListener("keydown", esc);
    const on = () => setOnline(true);
    const off = () => setOnline(false);
    window.addEventListener("online", on);
    window.addEventListener("offline", off);
    const sized = new ResizeObserver(() => map.resize());
    sized.observe(box.current);
    void keptCount().then(setSaved);
    const held = marks.current;
    const others = extra.current;
    return () => {
      window.removeEventListener("keydown", esc);
      window.removeEventListener("online", on);
      window.removeEventListener("offline", off);
      sized.disconnect();
      stopSave.current?.abort();
      held.clear();
      homeMark.current = null;
      others.mark = others.low = others.ac = null;
      mapRef.current = null;
      map.remove();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* ---------------------------------------------------------- the picture */
  useEffect(() => {
    const map = mapRef.current;
    if (!ready || !map) return;
    if (map.getLayer("imagery")) map.removeLayer("imagery");
    if (map.getSource("imagery")) map.removeSource("imagery");
    if (!url) return;
    map.addSource("imagery", { type: "raster", tiles: [src.keep ? kept(url) : url], tileSize: src.tileSize, maxzoom: src.maxZoom, attribution: src.attribution });
    map.addLayer({ id: "imagery", type: "raster", source: "imagery", paint: { "raster-fade-duration": 150 } }, "shade");
  }, [ready, url, src]);

  useEffect(() => {
    const map = mapRef.current;
    if (!ready || !map) return;
    map.setLayoutProperty("shade", "visibility", prefs.shading ? "visible" : "none");
  }, [ready, prefs.shading]);

  useEffect(() => {
    const map = mapRef.current;
    if (!ready || !map) return;
    map.setTerrain(prefs.relief3d ? { source: "dem", exaggeration: 1 } : null);
    map.easeTo({ pitch: prefs.relief3d ? 58 : 0, bearing: prefs.relief3d ? map.getBearing() : 0, duration: 600 });
  }, [ready, prefs.relief3d]);

  /* ------------------------------------------------------------ the plan */
  useEffect(() => {
    const map = mapRef.current;
    if (!ready || !map) return;
    const g = (p: { n: number; e: number }) => toGlobal(home, p.n, p.e);
    const set = (id: string, data: unknown) => (map.getSource(id) as GeoJSONSource | undefined)?.setData(data as Shape);

    const pts = [home, ...route.map(g), ...(closeRoute && route.length ? [home] : [])];
    set("route", pts.length > 1 ? line(pts) : EMPTY);
    set("ghost", ghost && ghost.length > 1 ? line(ghost.map(g)) : EMPTY);
    if (fenceRadius) {
      const ring: LatLon[] = [];
      for (let a = 0; a <= 360; a += 5) ring.push(toGlobal(home, fenceRadius * Math.cos((a * Math.PI) / 180), fenceRadius * Math.sin((a * Math.PI) / 180)));
      set("fence", line(ring));
    } else set("fence", EMPTY);

    // Home.
    if (!homeMark.current) {
      const m = new maplibregl.Marker({ element: dot("rmap-home", "H"), draggable: true }).setLngLat([home.lon, home.lat]).addTo(map);
      m.on("dragend", () => {
        const at = m.getLngLat();
        latest.current.onMoveHome?.({ lat: at.lat, lon: at.lng });
      });
      homeMark.current = m;
    }
    homeMark.current.setLngLat([home.lon, home.lat]);
    homeMark.current.setDraggable(!!props.onMoveHome && !homeLocked);
    homeMark.current.getElement().title = homeFrom === "aircraft" ? "Home: the aircraft's GPS position. It follows the aircraft while it is linked." : homeLocked ? "Home: the aircraft is flying from here" : "Home. Drag to move it; the waypoints stay where they are.";

    // Waypoints: keep the markers that are still wanted, so a drag is not cut short.
    const want = new Set(route.map((r) => r.id));
    for (const [id, m] of marks.current) {
      if (!want.has(id)) {
        m.remove();
        marks.current.delete(id);
      }
    }
    for (const r of route) {
      const at = g(r);
      let m = marks.current.get(r.id);
      const sig = `${r.label}|${r.tag ?? ""}`;
      if (m && m.getElement().dataset.sig !== sig) {
        m.remove();
        m = undefined;
      }
      if (!m) {
        const el = dot("rmap-wp", r.label, r.tag);
        el.dataset.sig = sig;
        el.title = `Waypoint ${r.label}. Drag to move it.`;
        const made = new maplibregl.Marker({ element: el, draggable: !!props.onMovePoint }).setLngLat([at.lon, at.lat]).addTo(map);
        made.on("dragend", () => {
          const p = latest.current;
          const ll = made.getLngLat();
          const l = toLocal(p.home, ll.lat, ll.lng);
          p.onMovePoint?.(r.id, l.n, l.e);
        });
        marks.current.set(r.id, made);
        m = made;
      }
      m.setLngLat([at.lon, at.lat]);
    }

    const place = (key: "mark" | "low", cls: string, label: string | null, where: { n: number; e: number } | null | undefined) => {
      extra.current[key]?.remove();
      extra.current[key] = null;
      if (!where || !label) return;
      const at = g(where);
      extra.current[key] = new maplibregl.Marker({ element: dot(cls, "", label) }).setLngLat([at.lon, at.lat]).addTo(map);
    };
    place("mark", `rmap-mark ${mark?.tone ?? "ok"}`, mark?.label ?? null, mark);
    place("low", "rmap-low", low ? (low.clear < 0 ? `${Math.round(-low.clear)} m into the ground` : `${Math.round(low.clear)} m clear`) : null, low);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, home, route, closeRoute, ghost, fenceRadius, mark, low, homeLocked, homeFrom, !!props.onMoveHome, !!props.onMovePoint]);

  // Home has just been taken from an aircraft's GPS: show it.
  useEffect(() => {
    const map = mapRef.current;
    if (!ready || !map || !taken) return;
    const h = latest.current.home;
    if (!map.getBounds().contains([h.lon, h.lat])) fit(false);
    setPlacing(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, taken]);

  // Home moved a long way (a new field, or the aircraft's own position): go there.
  const lastHome = useRef(home);
  useEffect(() => {
    const was = lastHome.current;
    lastHome.current = home;
    const moved = toLocal(was, home.lat, home.lon);
    if (ready && Math.hypot(moved.n, moved.e) > 1500) fit(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, home]);

  /* -------------------------------------------------------- the aircraft */
  useEffect(() => {
    const map = mapRef.current;
    if (!ready || !map) return;
    const has = linked && pos && (pos.lat !== 0 || pos.lon !== 0);
    if (!has) {
      extra.current.ac?.remove();
      extra.current.ac = null;
      if (trail.current.length) {
        trail.current = [];
        (map.getSource("track") as GeoJSONSource | undefined)?.setData(EMPTY);
      }
      return;
    }
    if (!extra.current.ac) {
      const el = document.createElement("div");
      el.className = `rmap-ac${virtual ? " virtual" : ""}`;
      el.innerHTML = '<svg viewBox="-12 -12 24 24" aria-hidden="true"><path d="M0,-10 L7,8 L0,4 L-7,8 Z"/></svg>';
      el.title = virtual ? "The virtual aircraft" : "Your aircraft, where its GPS says it is";
      extra.current.ac = new maplibregl.Marker({ element: el, rotationAlignment: "map", pitchAlignment: "map" }).setLngLat([pos.lon, pos.lat]).addTo(map);
    }
    extra.current.ac.setLngLat([pos.lon, pos.lat]);
    extra.current.ac.setRotation(pos.heading ?? hudHeading ?? 0);
    const t = trail.current;
    const prev = t[t.length - 1];
    if (!prev || Math.abs(prev.lat - pos.lat) + Math.abs(prev.lon - pos.lon) > 2e-6) {
      t.push({ lat: pos.lat, lon: pos.lon });
      if (t.length > 2000) t.splice(0, t.length - 2000);
      if (t.length > 1) (map.getSource("track") as GeoJSONSource | undefined)?.setData(line(t) as Shape);
    }
  }, [ready, linked, virtual, pos, hudHeading]);

  /* ------------------------------------------------------------- actions */
  const zoom = (by: number) => mapRef.current?.easeTo({ zoom: mapRef.current.getZoom() + by, duration: 250 });

  const toMe = () => {
    if (!navigator.geolocation) return notify("warn", "This browser cannot tell where it is");
    navigator.geolocation.getCurrentPosition(
      (p) => mapRef.current?.flyTo({ center: [p.coords.longitude, p.coords.latitude], zoom: 16 }),
      () => notify("warn", "Your location is not available", "Allow location for this page in the browser, or type the coordinates in Layers."),
      { enableHighAccuracy: true, timeout: 10000 },
    );
  };

  const go = () => {
    const at = parseLatLon(goto);
    if (!at) return notify("warn", "That is not a place", "Type a latitude and a longitude, such as 23.0225, 72.5714.");
    mapRef.current?.flyTo({ center: [at.lon, at.lat], zoom: 16 });
  };

  const saveArea = async () => {
    const map = mapRef.current;
    if (!map) return;
    const b = map.getBounds();
    const area = { west: b.getWest(), south: b.getSouth(), east: b.getEast(), north: b.getNorth() };
    const z = Math.floor(map.getZoom());
    const urls: string[] = [];
    // The ground heights always; the picture where its licence allows keeping it.
    for (let k = Math.max(6, Math.min(11, z - 2)); k <= ELEVATION.maxZoom; k++) for (const t of tilesIn(area, k)) urls.push(tileUrl(ELEVATION.url, t));
    if (src.keep && url) for (let k = Math.max(0, z - 2); k <= Math.min(src.maxZoom, z + 2); k++) for (const t of tilesIn(area, k)) urls.push(tileUrl(url, t));
    if (urls.length > 3000) return notify("warn", "That is too large an area to save at once", `It would be ${urls.length.toLocaleString()} map tiles. Zoom in to the field you will fly from and save that.`);
    const stop = new AbortController();
    stopSave.current = stop;
    setSaving({ done: 0, total: urls.length });
    const failedCount = await saveTiles(urls, (done, total) => setSaving({ done, total }), stop.signal);
    stopSave.current = null;
    setSaving(null);
    setSaved(await keptCount());
    if (stop.signal.aborted) return;
    if (failedCount) notify("warn", "Some of the area could not be saved", `${failedCount} of ${urls.length} tiles did not arrive. Check the connection and save again; what arrived is kept.`);
    else notify("success", "Area saved", src.keep ? "The picture and the ground heights for this view now work without the internet." : `The ground heights are saved. The ${src.name.toLowerCase()} picture cannot be: its provider does not allow it.`);
  };

  const ground = pointer && patch && covers(patch, home, 0) ? (() => {
    const l = toLocal(home, pointer.lat, pointer.lon);
    return Math.abs(l.n) <= patch.half && Math.abs(l.e) <= patch.half ? sampleDem(patch, l.n, l.e) : null;
  })() : null;

  const hasAircraft = linked && !!pos && (pos.lat !== 0 || pos.lon !== 0);

  if (failed) {
    return (
      <div className="rmap rmap-failed">
        <p>
          <strong>The map could not start.</strong> It needs WebGL, which this browser or computer has turned off. {failed}
        </p>
        <p>The practice field above works without it.</p>
      </div>
    );
  }

  return (
    <div className={`rmap${props.onPick ? " pickable" : ""}`}>
      <div ref={box} className="rmap-canvas" role="application" aria-label="Map of the route. Click to add a waypoint; drag a marker to move it." />

      <div className="rmap-tools" role="group" aria-label="Map controls">
        <button onClick={() => zoom(1)} aria-label="Zoom in" title="Zoom in"><Plus /></button>
        <button onClick={() => zoom(-1)} aria-label="Zoom out" title="Zoom out"><Minus /></button>
        <button onClick={() => fit()} aria-label="Fit the route" title="Fit the route"><Maximize /></button>
        <button onClick={() => prefs.set("relief3d", !prefs.relief3d)} aria-pressed={prefs.relief3d} aria-label="3D ground" title="Tilt the map and raise the ground"><Mountain /></button>
        {props.onMoveHome && !homeLocked && (
          <button onClick={() => setPlacing(!placing)} aria-pressed={placing} aria-label="Put home here" title="Put home here: then click the map where the aircraft will take off"><HomeIcon /></button>
        )}
        {hasAircraft ? (
          <button onClick={() => mapRef.current?.flyTo({ center: [pos!.lon, pos!.lat], zoom: Math.max(16, mapRef.current.getZoom()) })} aria-label="Go to the aircraft" title="Go to the aircraft, where its GPS says it is"><Navigation /></button>
        ) : (
          <button onClick={toMe} aria-label="Go to this computer's location" title={linked && !virtual ? "The aircraft has no GPS position yet. This goes to this computer's location instead." : "Go to this computer's location. Link an aircraft and this goes to the aircraft instead."}><LocateFixed /></button>
        )}
        <button onClick={() => setPanel(!panel)} aria-pressed={panel} aria-label="Layers and offline maps" title="Layers and offline maps"><Layers /></button>
      </div>

      {panel && (
        <div className="rmap-panel" role="dialog" aria-label="Layers and offline maps">
          <div className="rmap-panel-head">
            <strong>Map</strong>
            <button className="icon-btn" aria-label="Close" onClick={() => setPanel(false)}><X /></button>
          </div>
          <label className="field">
            <span>Picture</span>
            <select className="select" value={src.id} onChange={(e) => prefs.set("imagery", e.target.value)}>
              {IMAGERY.map((s) => (
                <option key={s.id} value={s.id}>{s.name}</option>
              ))}
            </select>
            <small>{src.detail}</small>
          </label>
          {src.needsKey && (
            <label className="field">
              <span>MapTiler key</span>
              <input className="input" type="password" autoComplete="off" value={prefs.keys[src.needsKey] ?? ""} onChange={(e) => prefs.set("keys", { ...prefs.keys, [src.needsKey!]: e.target.value })} placeholder="Paste the key from your MapTiler account" />
              <small>Kept in this browser only, and sent only to MapTiler.</small>
            </label>
          )}
          {src.id === "custom" && (
            <label className="field">
              <span>Tile address</span>
              <input className="input" value={prefs.customUrl} onChange={(e) => prefs.set("customUrl", e.target.value)} placeholder="https://…/{z}/{x}/{y}.jpg" />
              <small>Must start with https and contain {"{z}"}, {"{x}"} and {"{y}"}. Check the provider's terms allow it.</small>
            </label>
          )}
          <label className="sim-check">
            <input type="checkbox" checked={prefs.shading} onChange={(e) => prefs.set("shading", e.target.checked)} />
            <span><strong>Shade the slopes</strong><small>Shows the shape of the land on the flat map.</small></span>
          </label>
          <div className="rmap-goto">
            <label className="field">
              <span>Go to coordinates</span>
              <input className="input" value={goto} onChange={(e) => setGoto(e.target.value)} onKeyDown={(e) => e.key === "Enter" && go()} placeholder="23.0225, 72.5714" />
            </label>
            <button className="btn btn-sm" onClick={go}>Go</button>
          </div>
          <div className="rmap-offline">
            <strong>For the field, without internet</strong>
            <small>Saves what this view shows, and closer, on this computer. Move and zoom to the place you will fly from first.</small>
            {saving ? (
              <div className="rmap-saving">
                <progress value={saving.done} max={saving.total} />
                <span>{saving.done} of {saving.total}</span>
                <button className="btn btn-sm" onClick={() => stopSave.current?.abort()}>Stop</button>
              </div>
            ) : (
              <button className="btn btn-sm" onClick={saveArea} disabled={!online}><CloudDownload /> Save this area</button>
            )}
            <small className="rmap-kept">
              {saved ? `${saved.toLocaleString()} map tiles are saved on this computer.` : "Nothing saved yet."}{" "}
              {saved > 0 && !saving && (
                <button className="link-btn" onClick={() => void clearKept().then(() => setSaved(0))}>Remove them</button>
              )}
            </small>
          </div>
        </div>
      )}

      {placing && (
        <div className="rmap-note placing">
          Click the map where the aircraft will take off. The waypoints stay where they are. <button className="link-btn" onClick={() => setPlacing(false)}>Cancel</button>
        </div>
      )}
      {!url && !placing && (
        <div className="rmap-note">
          {src.needsKey ? "This picture needs your MapTiler key." : "This picture needs a tile address."} <button className="link-btn" onClick={() => setPanel(true)}>Open Layers</button>
        </div>
      )}
      {!online && (
        <div className="rmap-note offline"><WifiOff /> No internet: only saved areas are shown.</div>
      )}

      <div className="fmap-legend rmap-legend">
        {pointer ? (
          <span className="num">{pointer.lat.toFixed(5)}, {pointer.lon.toFixed(5)}{ground != null ? `, ground ${Math.round(ground)} m` : ""}</span>
        ) : (
          <span className={homeFrom === "waiting" ? "rmap-wait" : undefined}>
            {homeFrom === "aircraft"
              ? `Home is the aircraft's GPS position${sats !== null ? ` (${sats} satellites)` : ""}: ${home.lat.toFixed(5)}, ${home.lon.toFixed(5)}`
              : homeFrom === "waiting"
                ? `Waiting for the aircraft's GPS${sats !== null ? ` (${sats} satellites so far)` : ""}. Home is still where you placed it.`
                : `Home ${home.lat.toFixed(5)}, ${home.lon.toFixed(5)}`}
          </span>
        )}
        {wind && wind.speed > 0 && (
          <span><i className="fmap-wind" style={{ transform: `rotate(${wind.fromDeg + 180}deg)` }} aria-hidden /> Wind {wind.speed.toFixed(0)} m/s from {Math.round(wind.fromDeg)}°</span>
        )}
        <span className="fmap-hint">{placing ? "Click to put home there. Esc cancels." : props.onPick ? "Click to add a waypoint. Drag a marker to move it." : "Scroll to zoom, drag to move."}</span>
      </div>
    </div>
  );
}
