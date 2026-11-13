import { useState, type InputHTMLAttributes } from "react";

/*
  A number box that lets the reader type.

  A box that forces every keystroke into range cannot be used: with a floor of
  2, typing "10" becomes 2 at the "1", and then "20". Here the text is the
  reader's own until they leave the box. A number inside the range takes
  effect at once; anything else waits, and on leaving is pulled into range,
  or put back if it was not a number at all.
*/
interface Props extends Omit<InputHTMLAttributes<HTMLInputElement>, "value" | "onChange" | "min" | "max" | "type"> {
  value: number;
  onChange: (v: number) => void;
  min?: number;
  max?: number;
}

export function NumInput({ value, onChange, min = -Infinity, max = Infinity, onBlur, onKeyDown, ...rest }: Props) {
  const [draft, setDraft] = useState<string | null>(null);
  const read = (text: string) => (text.trim() === "" ? NaN : Number(text));
  const off = draft !== null && !(read(draft) >= min && read(draft) <= max);
  return (
    <input
      {...rest}
      type="number"
      inputMode="decimal"
      min={Number.isFinite(min) ? min : undefined}
      max={Number.isFinite(max) ? max : undefined}
      value={draft ?? (Number.isFinite(value) ? String(value) : "")}
      aria-invalid={off || undefined}
      title={off && Number.isFinite(min) && Number.isFinite(max) ? `Between ${min} and ${max}` : rest.title}
      onChange={(e) => {
        const text = e.target.value;
        setDraft(text);
        const v = read(text);
        if (v >= min && v <= max) onChange(v);
      }}
      onBlur={(e) => {
        if (draft !== null) {
          const v = read(draft);
          if (Number.isFinite(v)) {
            const kept = Math.max(min, Math.min(max, v));
            if (kept !== value) onChange(kept);
          }
          setDraft(null);
        }
        onBlur?.(e);
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter") e.currentTarget.blur();
        onKeyDown?.(e);
      }}
    />
  );
}
