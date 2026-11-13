/*
  Where the map pictures and the ground heights come from.

  There is no free, sharp, worldwide satellite picture that an app may simply
  use: the detailed ones (Esri, MapTiler, Mapbox, Google) all need an account
  and a key, and limit what may be stored. So the map works out of the box on
  open data, and takes the user's own key when they want a sharper picture.

  `keep` says whether tiles from a source may be saved on this computer for
  use without the internet. It is true only where the licence allows it.
*/
export type KeyKind = "maptiler";

export interface ImagerySource {
  id: string;
  name: string;
  /** One line for the picker: what it shows and what it costs. */
  detail: string;
  /** Tile address with {z} {x} {y}, and {key} where one is needed. */
  url: string;
  tileSize: number;
  maxZoom: number;
  attribution: string;
  needsKey?: KeyKind;
  keep: boolean;
}

export const IMAGERY: ImagerySource[] = [
  {
    id: "s2-2016",
    name: "Satellite, open licence",
    detail: "Sentinel-2, 10 m detail: fields, roads, rivers and woods, not single trees. No account needed, and areas can be saved for the field.",
    url: "https://tiles.maps.eox.at/wmts/1.0.0/s2cloudless_3857/default/g/{z}/{y}/{x}.jpg",
    tileSize: 256,
    maxZoom: 14,
    attribution: '<a href="https://s2maps.eu" target="_blank" rel="noreferrer">Sentinel-2 cloudless</a> by EOX IT Services GmbH (contains modified Copernicus Sentinel data 2016 &amp; 2017)',
    keep: true,
  },
  {
    id: "s2-2024",
    name: "Satellite, 2024 (non-commercial use)",
    detail: "The same 10 m picture, eight years newer. Free for non-commercial use only.",
    url: "https://tiles.maps.eox.at/wmts/1.0.0/s2cloudless-2024_3857/default/g/{z}/{y}/{x}.jpg",
    tileSize: 256,
    maxZoom: 14,
    attribution: '<a href="https://s2maps.eu" target="_blank" rel="noreferrer">Sentinel-2 cloudless</a> by EOX IT Services GmbH (contains modified Copernicus Sentinel data 2024)',
    keep: true,
  },
  {
    id: "osm",
    name: "Street map",
    detail: "OpenStreetMap: roads, buildings and place names. Needs the internet; its servers do not allow saving areas.",
    url: "https://tile.openstreetmap.org/{z}/{x}/{y}.png",
    tileSize: 256,
    maxZoom: 19,
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">OpenStreetMap</a> contributors',
    keep: false,
  },
  {
    id: "esri",
    name: "Sharp satellite (Esri World Imagery)",
    detail: "Detail down to buildings and single trees in most towns. No key needed to try it. Esri expects a published app to use an Esri account, and does not allow saving areas.",
    url: "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
    tileSize: 256,
    maxZoom: 19,
    attribution: 'Powered by <a href="https://www.esri.com" target="_blank" rel="noreferrer">Esri</a> | Esri, Maxar, Earthstar Geographics, and the GIS User Community',
    keep: false,
  },
  {
    id: "maptiler",
    name: "Sharp satellite (your MapTiler key)",
    detail: "Detail down to single trees and buildings. Needs a free MapTiler account and its key; their free plan is for non-commercial use and stops for the month at its limit.",
    url: "https://api.maptiler.com/tiles/satellite-v2/{z}/{x}/{y}.jpg?key={key}",
    tileSize: 512,
    maxZoom: 20,
    attribution: '&copy; <a href="https://www.maptiler.com/copyright/" target="_blank" rel="noreferrer">MapTiler</a> &copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">OpenStreetMap</a> contributors',
    needsKey: "maptiler",
    keep: false,
  },
  {
    id: "custom",
    name: "Another provider (paste a tile address)",
    detail: "Any map that serves standard tiles, such as Esri or your own server. Paste its address with {z}, {x} and {y} in it, key included.",
    url: "",
    tileSize: 256,
    maxZoom: 19,
    attribution: "Map tiles from the address you entered",
    keep: false,
  },
];

export const imageryById = (id: string) => IMAGERY.find((s) => s.id === id) ?? IMAGERY[0];

/** The tile address to use, or null while a key or an address is still missing. */
export function imageryUrl(src: ImagerySource, keys: Partial<Record<KeyKind, string>>, custom: string): string | null {
  if (src.id === "custom") {
    const u = custom.trim();
    return /^https:\/\/.+\{z\}.+/.test(u) && u.includes("{x}") && u.includes("{y}") ? u : null;
  }
  if (src.needsKey) {
    const k = keys[src.needsKey]?.trim();
    return k ? src.url.replace("{key}", encodeURIComponent(k)) : null;
  }
  return src.url;
}

/**
 * Ground heights: the open "Terrain Tiles" set on Amazon's public data
 * programme. No account or key, worldwide, and free to keep.
 */
export const ELEVATION = {
  url: "https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png",
  tileSize: 256,
  /** Finer than this the tiles only repeat the same 30 m survey. */
  maxZoom: 13,
  attribution:
    'Ground heights: <a href="https://registry.opendata.aws/terrain-tiles/" target="_blank" rel="noreferrer">Terrain Tiles</a> (Mapzen; SRTM, 3DEP, EU-DEM and other public surveys)',
};

/** Tile addresses that go through the app's own store, so they work offline. */
export const KEPT = "aeronex://";
