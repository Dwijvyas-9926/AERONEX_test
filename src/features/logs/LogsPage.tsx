import { PhaseBanner, PlanList } from "../../components/ui/PlannedModule";

export function LogsPage() {
  return (
    <div className="page-pad">
      <header className="page-head">
        <div>
          <h1>Flight Logs</h1>
          <p>Open a flight log after landing and see what the aircraft experienced.</p>
        </div>
      </header>
      <PhaseBanner phase={7} title="Planned after the first milestone">
        Log parsing runs in the browser, so logs never leave your computer.
      </PhaseBanner>
      <div style={{ maxWidth: 820 }}>
        <PlanList
          items={[
            { title: "ArduPilot .bin and PX4 .ulg", detail: "Drop a dataflash or ULog file and browse every message type it contains." },
            { title: "Health checks", detail: "Vibration and clipping, battery sag, GPS quality, EKF innovations and attitude tracking error, each with a plain-language verdict." },
            { title: "Charts that line up", detail: "Synchronised plots with mode changes and events marked on the timeline." },
            { title: "Replay on the twin", detail: "Play the flight back on the digital twin in the simulator world." },
          ]}
        />
      </div>
    </div>
  );
}
