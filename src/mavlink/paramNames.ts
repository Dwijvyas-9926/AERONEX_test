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
  whatever RTL_ALT_M says, its PID page would offer vertical gains the
  aircraft does not have, and its Doctor would never see arming checks
  turned off. So every page that reads or writes settings by name goes
  through here: the simulator, the planner, PID tuning and the Doctor.

  The table is ArduPilot's own: each entry mirrors a line of the conversion
  tables in the 4.7 source ("RTL_ALT moved to RTL_ALT_M", scaled by 0.01),
  run backwards. `by` is what the new value is multiplied by to give the old.
*/
export const RENAMED: Record<string, { old: string; by: number }> = {
  // AC_WPNav: scaled by 0.01
  WP_SPD: { old: "WPNAV_SPEED", by: 100 },
  WP_SPD_UP: { old: "WPNAV_SPEED_UP", by: 100 },
  WP_SPD_DN: { old: "WPNAV_SPEED_DN", by: 100 },
  WP_ACC: { old: "WPNAV_ACCEL", by: 100 },
  WP_RADIUS_M: { old: "WPNAV_RADIUS", by: 100 },
  WP_ACC_Z: { old: "WPNAV_ACCEL_Z", by: 100 },
  WP_JERK: { old: "WPNAV_JERK", by: 1 },
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

/**
 * The name this aircraft uses for a setting the app knows by its older name,
 * and the factor from the older units to the aircraft's: the value to write
 * is the older-unit value times `scale`. On firmware before 4.7 this is the
 * name itself, scale 1.
 */
export function firmwareName(older: string, values: Record<string, number>): { name: string; scale: number } {
  if (Number.isFinite(values[older])) return { name: older, scale: 1 };
  for (const [now, r] of Object.entries(RENAMED)) {
    if (r.old === older && (Number.isFinite(values[now]) || usesNewerNames(values))) return { name: now, scale: 1 / r.by };
  }
  return { name: older, scale: 1 };
}

/**
 * Whether the aircraft runs its arming checks: "all" when every check is on,
 * "some" when some are skipped, "none" when all are off; null when unknown.
 * Before 4.7 ARMING_CHECK listed the checks to run (1 = all, 0 = none); from
 * 4.7 ARMING_SKIPCHK lists those to skip (0 = none skipped, -1 = all).
 */
export function armingChecks(values: Record<string, number>): "all" | "some" | "none" | null {
  const skip = values.ARMING_SKIPCHK;
  if (Number.isFinite(skip)) return skip === 0 ? "all" : skip === -1 ? "none" : "some";
  const run = values.ARMING_CHECK;
  if (Number.isFinite(run)) return run === 0 ? "none" : (run & 1) === 1 ? "all" : "some";
  return null;
}
