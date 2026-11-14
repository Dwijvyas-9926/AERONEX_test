import { PARAM_DEFS, type Params } from "./params";
import { withOlderNames } from "../mavlink/paramNames";

export { withOlderNames, usesNewerNames } from "../mavlink/paramNames";

/* The names and units are mapped in mavlink/paramNames, shared with every page that reads settings. */

/** The parameters the app models, out of a set read from a real aircraft, under the app's names and units. */
export function modelledParams(values: Record<string, number> | undefined): Params {
  const out: Params = {};
  if (!values) return out;
  const named = withOlderNames(values);
  for (const d of PARAM_DEFS) if (Number.isFinite(named[d.name])) out[d.name] = named[d.name];
  return out;
}
