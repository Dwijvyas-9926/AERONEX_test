export function BrandMark({ className = "brand-mark" }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 32 32" aria-hidden="true">
      <rect width="32" height="32" rx="7" fill="#1d150e" />
      <circle cx="16" cy="16" r="10.5" fill="none" stroke="#7d6836" strokeWidth="1.4" />
      <path d="M8.5 22 L16 8 L23.5 22" fill="none" stroke="#d8a648" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M12 17 H20" stroke="#d8a648" strokeWidth="2.4" strokeLinecap="round" />
      <circle cx="16" cy="8" r="1.9" fill="#f0c879" />
    </svg>
  );
}
