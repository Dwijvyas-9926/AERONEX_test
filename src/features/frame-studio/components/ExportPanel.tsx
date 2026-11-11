import { Box, Download, FileArchive, FileCode2, Hammer, Package, Printer, Scissors } from "lucide-react";
import { useMemo, useState } from "react";
import { notify } from "../../../state/notifyStore";
import { useActiveProfile } from "../../../state/profileStore";
import { buildBOM, buildRecipe } from "../bom";
import { planSheets, toDXF, toSVG } from "../exporters";
import { type FrameDesign } from "../geometry";
import { buildManifest, exportSlug, type ManifestFile } from "../manifest";
import { toSTLParts } from "../solid";
import { useStudio } from "../store";
import { worstSeverity, type Finding } from "../validate";
import { PAGE_SIZES, pageSizeById, planPrint, toPrintSVG } from "../printsheet";
import { zip, type ZipEntry } from "../zip";

/*
  Export.

  Downloads are built in the browser from the same geometry the preview draws.
  Nothing is uploaded and nothing is fetched, so the studio works offline and
  the user's design never leaves their machine.

  Everything leaves as one archive. A frame is never a single file — a cut
  design is one drawing per stock thickness, a printed one is a solid per part
  — and firing off four separate downloads scatters them through the Downloads
  folder with nothing to say they belong together. The archive keeps the set
  intact and carries the build notes with it.
*/

function download(name: string, blob: Blob) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  // Revoking immediately can cancel the download in some browsers; one frame
  // of grace is enough and the object is released either way.
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function ExportPanel({ design: d, findings }: { design: FrameDesign; findings: Finding[] }) {
  const sheetWidthMm = useStudio((s) => s.sheetWidthMm);
  const setSheetWidth = useStudio((s) => s.setSheetWidth);
  const labelParts = useStudio((s) => s.labelParts);
  const setLabelParts = useStudio((s) => s.setLabelParts);
  const pageSizeId = useStudio((s) => s.pageSizeId);
  const setPageSize = useStudio((s) => s.setPageSize);
  const profile = useActiveProfile();

  const isCut = d.material.method === "cut";
  // One sheet per thickness: arms and plates are not cut from the same stock.
  const sheets = useMemo(() => planSheets(d.profiles, { sheetWidthMm, labels: labelParts }), [d.profiles, sheetWidthMm, labelParts]);
  const bom = useMemo(() => buildBOM(d), [d]);
  const recipe = useMemo(() => buildRecipe(d), [d]);
  const printPlan = useMemo(() => planPrint(d, pageSizeById(pageSizeId)), [d, pageSizeId]);

  const blocked = worstSeverity(findings) === "error";
  const vehicleName = profile?.name?.trim() || "Untitled airframe";
  const stem = exportSlug(profile?.name, d);
  const [busy, setBusy] = useState<string | null>(null);

  /** Bundle the given files with a manifest and hand the archive to the browser. */
  const save = async (
    kind: string,
    holds: "drawings" | "solids",
    name: string,
    files: (ZipEntry & ManifestFile)[],
    blurb: string,
  ) => {
    if (busy) return;
    setBusy(kind);
    try {
      const readme = buildManifest({
        vehicleName,
        design: d,
        kind: holds,
        files: files.map(({ name: n, detail }) => ({ name: n, detail })),
        bom,
        recipe,
      });
      const archive = await zip([
        ...files.map(({ path, data }) => ({ path, data })),
        { path: "README.txt", data: readme },
      ]);
      download(name, archive);
      notify("success", `${name} saved`, blurb);
    } catch (err) {
      notify(
        "error",
        "Export failed",
        err instanceof Error ? err.message : "The archive could not be built. Try again, or reload the page.",
      );
    } finally {
      setBusy(null);
    }
  };

  const sheetFiles = (ext: string, render: (s: (typeof sheets)[number]) => string) =>
    sheets.map((s) => {
      const path = `${stem}-${s.thicknessMm}mm.${ext}`;
      return {
        path,
        name: path,
        data: render(s),
        detail: `${s.partNames.join(", ")} — cut from ${s.thicknessMm} mm stock. Needs ${Math.ceil(s.nest.widthMm)} × ${Math.ceil(s.nest.heightMm)} mm of sheet.`,
      };
    });

  const saveDxf = () =>
    save(
      "dxf",
      "drawings",
      `${stem}-dxf.zip`,
      sheetFiles("dxf", (s) => toDXF(s.nest, { labels: labelParts })),
      `${sheets.length} drawing${sheets.length > 1 ? "s" : ""} — one per stock thickness — plus the build notes.`,
    );

  const saveSvg = () =>
    save(
      "svg",
      "drawings",
      `${stem}-svg.zip`,
      sheetFiles("svg", (s) => toSVG(s.nest, { labels: labelParts })),
      "The same drawings as the DXFs, openable in a browser.",
    );

  const savePrint = () => {
    const page = pageSizeById(pageSizeId);
    const plan = planPrint(d, page);
    return save(
      "print",
      "drawings",
      `${stem}-check-sheet.zip`,
      plan.tiles.map((t, i) => {
        const path = `${stem}-check-${String(i + 1).padStart(2, "0")}.svg`;
        return {
          path,
          name: path,
          data: toPrintSVG(d, plan, t, vehicleName),
          detail:
            plan.tiles.length > 1
              ? `Page ${i + 1} of ${plan.tiles.length} — column ${t.col + 1}, row ${t.row + 1}. Trim to the crop marks and tape to its neighbours.`
              : `The whole frame on one ${page.name} sheet.`,
        };
      }),
      `${plan.tiles.length} ${page.name} page${plan.tiles.length > 1 ? "s" : ""}. Print at 100%, check the ruler, then lay your parts on it.`,
    );
  };

  const saveStl = () => {
    const parts = toSTLParts(d.profiles);
    return save(
      "stl",
      "solids",
      `${stem}-stl.zip`,
      parts.map((p) => {
        const path = `${stem}-${p.filename}`;
        return {
          path,
          name: path,
          data: new Uint8Array(p.data),
          detail: `${p.name} — print ${p.qty}, ${p.thicknessMm} mm thick. Already oriented flat on the bed.`,
        };
      }),
      `${parts.length} solid${parts.length > 1 ? "s" : ""}, one per part, plus the printer settings.`,
    );
  };

  return (
    <div className="fs-export">
      {blocked && (
        <div className="callout danger">
          <span>
            <strong>This design has errors.</strong> You can still export it, but fix what the review panel lists first — the
            files describe the frame exactly as drawn, faults included.
          </span>
        </div>
      )}

      {sheets.some((s) => s.nest.oversized.length > 0) && (
        <div className="callout warn">
          <span>
            <strong>
              {sheets.flatMap((s) => s.nest.oversized).join(", ")} will not fit on a {sheetWidthMm} mm sheet.
            </strong>{" "}
            The layout is still drawn, but it runs past the stock — pick a wider sheet before ordering.
          </span>
        </div>
      )}

      <section className="fs-xsec">
        <header>
          <h4>{isCut ? "Cutting files" : "Print files"}</h4>
          <p>
            {isCut
              ? "Send the DXF to a laser, router or waterjet service. The SVG is the same drawing for checking in a browser."
              : "One STL per part, in millimetres. The DXF is still useful if you would rather have the plates cut."}
          </p>
        </header>

        <div className="fs-xgrid">
          {isCut ? (
            <>
              <button className="fs-xcard primary" onClick={saveDxf} disabled={busy !== null}>
                <Scissors />
                <b>DXF R12 × {sheets.length}</b>
                <small>Universal CAM format, 1:1 mm. One drawing per thickness.</small>
                <Download className="fs-xcard-go" />
              </button>
              <button className="fs-xcard" onClick={saveSvg} disabled={busy !== null}>
                <FileCode2 />
                <b>SVG × {sheets.length}</b>
                <small>Browser-checkable, hobby-laser friendly.</small>
                <Download className="fs-xcard-go" />
              </button>
            </>
          ) : (
            <>
              <button className="fs-xcard primary" onClick={saveStl} disabled={busy !== null}>
                <Box />
                <b>STL × {d.profiles.length}</b>
                <small>One solid per part, at the thickness the solver chose.</small>
                <Download className="fs-xcard-go" />
              </button>
              <button className="fs-xcard" onClick={saveDxf} disabled={busy !== null}>
                <Scissors />
                <b>DXF R12 × {sheets.length}</b>
                <small>If you would rather cut the plates than print them.</small>
                <Download className="fs-xcard-go" />
              </button>
            </>
          )}
        </div>

        <div className="fs-xcheck">
          <button className="fs-xcard wide" onClick={savePrint} disabled={busy !== null}>
            <Printer />
            <b>Print &amp; check sheet</b>
            <small>
              The frame at 1:1 on paper. Lay your real motors, stack and battery on it and find the mistakes before you
              pay for a cut — the cheapest check there is.
            </small>
            <Download className="fs-xcard-go" />
          </button>
          <label className="field">
            <span>Paper</span>
            <select className="select" value={pageSizeId} onChange={(e) => setPageSize(e.target.value)}>
              {PAGE_SIZES.map((p) => (
                <option key={p.id} value={p.id}>{p.name} — {p.widthMm} × {p.heightMm} mm</option>
              ))}
            </select>
            <small>{printPlan.tiles.length} page{printPlan.tiles.length === 1 ? "" : "s"} at 1:1.</small>
          </label>
        </div>

        <p className="fs-xzip">
          <FileArchive size={14} />
          <span>
            Downloads as one archive — <code>{stem}-{isCut ? "dxf" : "stl"}.zip</code> — named after{" "}
            {profile ? (
              <>
                your active vehicle, <strong>{vehicleName}</strong>
              </>
            ) : (
              "the design, since no vehicle profile is active"
            )}
            . Every part is inside, with a <code>README.txt</code> holding the material, the bolts to order and the
            build notes.
          </span>
        </p>

        <div className="fs-xopts">
          <label className="field">
            <span>Sheet width</span>
            <select className="select" value={sheetWidthMm} onChange={(e) => setSheetWidth(Number(e.target.value))}>
              {[200, 250, 300, 400, 500, 600].map((w) => (
                <option key={w} value={w}>{w} mm</option>
              ))}
            </select>
            <small>Parts wrap to a new row past this width.</small>
          </label>
          <label className="fs-check">
            <input type="checkbox" checked={labelParts} onChange={(e) => setLabelParts(e.target.checked)} />
            <span>Write part names on a separate layer</span>
          </label>
          <ul className="fs-xsheets">
            {sheets.map((s) => (
              <li key={s.thicknessMm}>
                <b>{s.thicknessMm} mm</b>
                <span>{s.partNames.join(", ")}</span>
                <i>{Math.ceil(s.nest.widthMm)} × {Math.ceil(s.nest.heightMm)} mm · {Math.round(s.nest.utilisation * 100)}%</i>
              </li>
            ))}
          </ul>
        </div>
      </section>

      <section className="fs-xsec">
        <header>
          <h4><Package size={16} /> What to order</h4>
          <p>Bolt lengths are worked out from the stack each one passes through, which is the easiest thing to get wrong.</p>
        </header>
        <table className="fs-bom">
          <tbody>
            {bom.map((l, i) => (
              <tr key={i}>
                <td className="fs-bom-qty">{l.qty}×</td>
                <td>
                  <b>{l.item}</b>
                  <small>{l.purpose}</small>
                  {l.note && <em>{l.note}</em>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section className="fs-xsec">
        <header>
          <h4><Hammer size={16} /> Making it</h4>
          <p>{isCut ? "What to tell the cutting service, and what to check when it arrives." : "Printer settings that decide whether the arms survive a crash."}</p>
        </header>
        <ol className="fs-recipe">
          {recipe.map((s, i) => (
            <li key={i}>
              <b>{s.title}</b>
              <p>{s.detail}</p>
            </li>
          ))}
        </ol>
      </section>
    </div>
  );
}
