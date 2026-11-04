import { PhaseBanner, PlanList } from "../../components/ui/PlannedModule";

export function MissionPlanningPage() {
  return (
    <div className="page-pad">
      <header className="page-head">
        <div>
          <h1>Mission Planning</h1>
          <p>Plan where the aircraft goes and what it does there, then rehearse it in the simulator before uploading.</p>
        </div>
      </header>
      <PhaseBanner phase={7} title="Planned after the first milestone">
        It builds on the command layer (Phase 4) and the simulator (Phase 2), so missions can be tested virtually first.
      </PhaseBanner>
      <div style={{ maxWidth: 820 }}>
        <PlanList
          items={[
            { title: "Waypoint missions", detail: "Draw on a map, set altitude and speed per leg, and upload with MAVLink mission protocol acknowledgements." },
            { title: "Survey grids", detail: "Area coverage with overlap and camera footprint for mapping." },
            { title: "Relief delivery", detail: "Fly to a drop zone, hand over to the companion computer's vision approach, release the payload and return, with operator confirmation steps." },
            { title: "Geofences and rally points", detail: "Inclusion and exclusion zones uploaded alongside the mission." },
            { title: "Simulator rehearsal", detail: "Run the same mission against the virtual aircraft before it touches real hardware." },
          ]}
        />
      </div>
    </div>
  );
}
