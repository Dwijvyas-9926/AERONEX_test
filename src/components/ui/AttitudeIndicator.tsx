/** Compact attitude indicator driven by props (degrees). For live telemetry panels. */
export function AttitudeIndicator({ roll, pitch, size = 132, stale = false }: { roll: number; pitch: number; size?: number; stale?: boolean }) {
  const r = size / 2;
  const ppd = size / 50;
  const id = `ai-${size}`;
  return (
    <svg width={size} height={size} viewBox={`${-r} ${-r} ${size} ${size}`} role="img" aria-label={`Roll ${roll.toFixed(1)} degrees, pitch ${pitch.toFixed(1)} degrees`} style={{ opacity: stale ? 0.45 : 1, transition: "opacity 300ms" }}>
      <defs>
        <clipPath id={id}>
          <circle r={r - 2} />
        </clipPath>
      </defs>
      <g clipPath={`url(#${id})`}>
        <g transform={`rotate(${-roll}) translate(0 ${pitch * ppd})`}>
          <rect x={-size * 2} y={-size * 2} width={size * 4} height={size * 2} fill="#c9dced" />
          <rect x={-size * 2} y={0} width={size * 4} height={size * 2} fill="#c8bca4" />
          <line x1={-size} x2={size} y1={0} y2={0} stroke="#14213d" strokeWidth={1.5} />
          {[-20, -10, 10, 20].map((d) => (
            <line key={d} x1={-14} x2={14} y1={-d * ppd} y2={-d * ppd} stroke="#14213d" strokeOpacity={0.45} />
          ))}
        </g>
      </g>
      <g stroke="#a8470f" strokeWidth={2.5} strokeLinecap="round" fill="none">
        <path d={`M${-r * 0.55} 0 H${-r * 0.2} L${-r * 0.12} 6`} />
        <path d={`M${r * 0.55} 0 H${r * 0.2} L${r * 0.12} 6`} />
      </g>
      <circle r={2.5} fill="#a8470f" />
      <circle r={r - 1} fill="none" stroke="rgba(20,33,61,0.22)" strokeWidth={2} />
    </svg>
  );
}
