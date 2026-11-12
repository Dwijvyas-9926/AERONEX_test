/*
  The AERONEX mark: a capital A crossed by a level line.

  The line is the horizon bar of an attitude indicator and the wings of an
  aircraft seen head-on, and it runs on past both legs of the letter so the
  mark reads as an aircraft sitting level before it reads as an initial. It is
  drawn as three solid shapes with no fine detail, which is what keeps it
  legible as a 16-pixel tab icon.

  The same geometry is in public/favicon.svg and the PNG icons beside it;
  change one and regenerate the others with scripts/brand-icons.cjs.
*/
const LEGS = "M11.5 53 L28.2 10 H35.8 L52.5 53 H44 L32 21.5 L20 53 Z";

interface Props {
  className?: string;
  /** "tile" is the app icon on its dark square; "glyph" is the mark alone. */
  variant?: "tile" | "glyph";
  /** Colour behind the mark, for the gap the level line cuts through the A. */
  ground?: string;
}

export function BrandMark({ className = "brand-mark", variant = "tile", ground = "#1b1410" }: Props) {
  return (
    <svg className={className} viewBox="0 0 64 64" aria-hidden="true">
      {variant === "tile" && <rect width="64" height="64" rx="14" fill={ground} />}
      <path d={LEGS} fill="#d8a648" />
      <path d="M4 40.5 H60" stroke={ground} strokeWidth="9.6" />
      <path d="M6.5 40.5 H57.5" stroke="#f2e8d6" strokeWidth="4.2" />
    </svg>
  );
}

/** Mark and name together, as they sit in the top-left of the app. */
export function BrandLockup() {
  return (
    <>
      <BrandMark />
      <span className="brand-name">
        AERONEX <span>Ground Station</span>
      </span>
    </>
  );
}
