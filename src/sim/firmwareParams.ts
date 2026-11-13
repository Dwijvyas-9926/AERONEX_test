import { PARAM_DEFS, type Params } from "./params";

/*
  Parameters by the names this app thinks in.

  ArduCopter 4.7 renamed many of its parameters and changed their units from
  centimetres and centidegrees to metres and degrees: RTL_ALT (cm) became
  RTL_ALT_M (m), WPNAV_SPEED (cm/s) became WP_SPD (m/s), and so on. The
  model here, and everything built on it (the return-home height in the route
  profile, flight times, the plan check), uses the older names.

  Without this, an aircraft on 4.7 would report none of the names the app
  looks for, and the app would quietly fall back on its own defaults: it
  would draw the return home at 15 m when the aircraft would fly it at
  whatever RTL_ALT_M says. So settings read from an aircraft pass through
  here first.

  The table is ArduPilot's own: each entry mirrors a line of the conversion
  tables in the 4.7 source ("RTL_ALT moved to RTL_ALT_M", scaled by 0.01),
  run backwards. `by` is what the new value is multiplied by to give the old.
*/
const RENAMED: Record<string, { old: string; by: number }> = {
  // AC_WPNav: scaled by 0.01
  WP_SPD: { old: "WPNAV_SPEED", by: 100 },
  WP_SPD_UP: { old: "WPNAV_SPEED_UP", by: 100 },
  WP_SPD_DN: { old: "WPNAV_SPEED_DN", by: 100 },
  WP_ACC: { old: "WPNAV_ACCEL", by: 100 },
  WP_RADIUS_M: { old: "WPNAV_RADIUS", by: 100 },
  LOIT_SPEED_MS: { old: "LOIT_SPEED", by: 100 },
  // Copter: scaled by 0.01
  PILOT_SPD_UP: { old: "PILOT_SPEED_UP", by: 100 },
  RTL_ALT_M: { old: "RTL_ALT", by: 100 },
  RTL_SPEED_MS: { old: "RTL_SPEED", by: 100 },
  RTL_ALT_FINAL_M: { old: "RTL_ALT_FINAL", by: 100 },
  LAND_SPD_MS: { old: "LAND_SPEED", by: 100 },
  LAND_ALT_LOW_M: { old: "LAND_ALT_LOW", by: 100 },
  // AC_AttitudeControl: centidegrees to degrees
  ATC_ANGLE_MAX: { old: "ANGLE_MAX", by: 100 },
  ATC_ACC_R_MAX: { old: "ATC_ACCEL_R_MAX", by: 100 },
  ATC_ACC_P_MAX: { old: "ATC_ACCEL_P_MAX", by: 100 },
  ATC_ACC_Y_MAX: { old: "ATC_ACCEL_Y_MAX", by: 100 },
  // AC_PosControl: renamed; the vertical acceleration gains were also scaled by 0.1
  PSC_NE_POS_P: { old: "PSC_POSXY_P", by: 1 },
  PSC_NE_VEL_P: { old: "PSC_VELXY_P", by: 1 },
  PSC_NE_VEL_I: { old: "PSC_VELXY_I", by: 1 },
  PSC_NE_VEL_D: { old: "PSC_VELXY_D", by: 1 },
  PSC_D_POS_P: { old: "PSC_POSZ_P", by: 1 },
  PSC_D_VEL_P: { old: "PSC_VELZ_P", by: 1 },
  PSC_D_ACC_P: { old: "PSC_ACCZ_P", by: 10 },
  PSC_D_ACC_I: { old: "PSC_ACCZ_I", by: 10 },
  // GCS
  MAV_SYSID: { old: "SYSID_THISMAV", by: 1 },
};

/**
 * The same settings with the older names added wherever the aircraft uses the
 * newer ones. A name the aircraft does report under its old form is left
 * alone, so firmware before 4.7 passes through unchanged.
 */
export function withOlderNames(values: Record<string, number>): Record<string, number> {
  const out = { ...values };
  for (const [now, { old, by }] of Object.entries(RENAMED)) {
    const v = values[now];
    if (Number.isFinite(v) && !Number.isFinite(values[old])) out[old] = v * by;
  }
  // 4.7 lists the arming checks to skip, where older firmware listed the ones to run.
  if (Number.isFinite(values.ARMING_SKIPCHK) && !Number.isFinite(values.ARMING_CHECK)) out.ARMING_CHECK = values.ARMING_SKIPCHK === -1 ? 0 : 1;
  return out;
}

/** True when these settings came from firmware that uses the newer names. */
export const usesNewerNames = (values: Record<string, number>) => Number.isFinite(values.WP_SPD) || Number.isFinite(values.RTL_ALT_M);

/** The parameters the app models, out of a set read from a real aircraft, under the app's names and units. */
export function modelledParams(values: Record<string, number> | undefined): Params {
  const out: Params = {};
  if (!values) return out;
  const named = withOlderNames(values);
  for (const d of PARAM_DEFS) if (Number.isFinite(named[d.name])) out[d.name] = named[d.name];
  return out;
}
