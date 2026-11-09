import { Box, Download, FileCode2, Hammer, Package, Scissors } from "lucide-react";
import { useMemo } from "react";
import { notify } from "../../../state/notifyStore";
import { buildBOM, buildRecipe } from "../bom";
import { planSheets, toDXF, toSVG } from "../exporters";
import { type FrameDesign } from "../geometry";
import { toSTLParts } from "../solid";
import { useStudio } from "../store";
import { worstSeverity, type Finding } from "../validate";

/*
  Export.

  Downloads are built in the browser from the same geometry the preview draws.
  Nothing is uploaded and nothing is fetched, so the studio works offline and
  the user's design never leaves their machine.
*/

function download(name: string, data: string | ArrayBuffer, mime: string) {
  const blob = new Blob([data as BlobPart], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  // Revoking immediately can cancel the download in some browsers; one frame
  // of grace is enough and the object is released either way.
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

const slug = (d: FrameDesign) =>
  `aeronex-${d.spec.propIn}in-${d.spec.layout}-${Math.round(d.wheelbaseMm)}mm`.replace(/[^a-z0-9-]/gi, "");

export function ExportPanel({ design: d, findings }: { design: FrameDesign; findings: Finding[] }) {
  const sheetWidthMm = useStudio((s) => s.sheetWidthMm);
  const setSheetWidth = useStudio((s) => s.setSheetWidth);
  const labelParts = useStudio((s) => s.labelParts);
  const setLabelParts = useStudio((s) => s.setLabelParts);

  const isCut = d.material.method === "cut";
  // One sheet per thickness: arms and plates are not cut from the same stock.
  const sheets = useMemo(() => planSheets(d.profiles, { sheetWidthMm, labels: labelParts }), [d.profiles, sheetWidthMm, labelParts]);
  const bom = useMemo(() => buildBOM(d), [d]);
  const recipe = useMemo(() => buildRecipe(d), [d]);

  const blocked = worstSeverity(findings) === "error";

  const saveDxf = () => {
    for (const s of sheets) download(`${slug(d)}-${s.thicknessMm}mm.dxf`, toDXF(s.nest, { labels: labelParts }), "application/dxf");
    notify(
      "success",
      sheets.length > 1 ? `${sheets.length} DXF files saved` : "DXF saved",
      `One file per thickness — ${sheets.map((s) => `${s.thicknessMm} mm`).join(" and ")} — each 1:1 in millimetres.`,
    );
  };
  const saveSvg = () => {
    for (const s of sheets) download(`${slug(d)}-${s.thicknessMm}mm.svg`, toSVG(s.nest, { labels: labelParts }), "image/svg+xml");
    notify("success", "SVG saved", "Same drawings as the DXFs, for checking in a browser.");
  };
  const saveStl = () => {
    const parts = toSTLParts(d.profiles);
    for (const p of parts) download(`${slug(d)}-${p.filename}`, p.data, "model/stl");
    notify("success", `${parts.length} STL files saved`, "One file per part. Print the arms on edge — see the build notes.");
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
              <button className="fs-xcard primary" onClick={saveDxf}>
                <Scissors />
                <b>DXF R12 × {sheets.length}</b>
                <small>Universal CAM format, 1:1 mm. One file per thickness.</small>
                <Download className="fs-xcard-go" />
              </button>
              <button className="fs-xcard" onClick={saveSvg}>
                <FileCode2 />
                <b>SVG</b>
                <small>Browser-checkable, hobby-laser friendly.</small>
                <Download className="fs-xcard-go" />
              </button>
            </>
          ) : (
            <>
              <button className="fs-xcard primary" onClick={saveStl}>
                <Box />
                <b>STL × {d.profiles.length}</b>
                <small>One solid per part, at the thickness the solver chose.</small>
                <Download className="fs-xcard-go" />
              </button>
              <button className="fs-xcard" onClick={saveDxf}>
                <Scissors />
                <b>DXF R12</b>
                <small>If you would rather cut the plates than print them.</small>
                <Download className="fs-xcard-go" />
              </button>
            </>
          )}
        </div>

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
