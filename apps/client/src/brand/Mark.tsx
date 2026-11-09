/**
 * The Foundation mark: an F laid in masonry (apps/client/assets/foundation-icon.svg, the app icon).
 * Drawn in `currentColor`, so it takes the room's blue by default and any tone it's set in.
 */
export function Mark({ size = 30, className }: { size?: number; className?: string }) {
  return (
    <svg className={className} width={size} height={size} viewBox="128 128 768 768" fill="currentColor" aria-hidden style={{ color: "var(--color-pulse)" }}>
      <rect x="200" y="128" width="392" height="176" rx="12" />
      <rect x="636" y="128" width="188" height="176" rx="12" />
      <rect x="200" y="348" width="248" height="240" rx="12" />
      <rect x="492" y="436" width="232" height="152" rx="12" />
      <rect x="200" y="632" width="248" height="264" rx="12" />
    </svg>
  );
}
