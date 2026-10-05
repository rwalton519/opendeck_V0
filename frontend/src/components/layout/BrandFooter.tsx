import styles from "./BrandFooter.module.css";

/**
 * SoverraAI mark - a portmanteau of Sovereign + Era + AI, so the symbol
 * reads as three simple strokes rather than a literal logo:
 *   - the ring: an "era" - a closed, continuous cycle
 *   - the ascending chevron inside it: "sovereign" - a peak/apex, authority rising
 *   - the small node at the apex: "AI" - a single point of intelligence/signal
 * Kept to plain strokes on a transparent background (currentColor) so it
 * drops into any surface at any size without carrying its own color.
 */
function SoverraMark() {
  return (
    <svg
      className={styles.markIcon}
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
    >
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="1.4" />
      <path
        d="M7.5 14.5L12 8.5L16.5 14.5"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle cx="12" cy="8.5" r="1.15" fill="currentColor" />
    </svg>
  );
}

export function BrandFooter() {
  return (
    <footer className={styles.footer}>
      <span className={styles.markWrap}>
        <SoverraMark />
      </span>
      <span className={styles.wordmark}>by SoverraAI</span>
    </footer>
  );
}