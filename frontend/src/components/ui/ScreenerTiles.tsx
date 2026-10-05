import { Link } from "react-router-dom";
import styles from "./ScreenerTiles.module.css";

export interface ScreenerTile {
  label: string;
  /** Short caption under the label. */
  caption?: string;
  /** Destination. Client-side route unless `hardNav` is set. */
  to: string;
  /**
   * Set for standalone static pages served from public/ (cashgame-demo,
   * heads-up, RNG-shuffle-tester). Those are NOT SPA routes, so they need a
   * real browser navigation (<a href>) instead of react-router's <Link>.
   */
  hardNav?: boolean;
}

interface ScreenerTilesProps {
  eyebrow?: string;
  heading?: string;
  tiles: ScreenerTile[];
  /** Optional "back" link shown under the tiles. */
  backTo?: string;
  backLabel?: string;
}

/**
 * Shared layout for the LIVE/DEMO screener pages: large, centered, square,
 * gold-radiating tiles. Used by HomePage ("/"), LivePage ("/live") and
 * DemosPage ("/demos").
 */
export function ScreenerTiles({ eyebrow, heading, tiles, backTo, backLabel = "Back" }: ScreenerTilesProps) {
  return (
    <div className={styles.screener}>
      {(eyebrow || heading) && (
        <header className={styles.head}>
          {eyebrow && <p className={styles.eyebrow}>{eyebrow}</p>}
          {heading && <h1 className={styles.heading}>{heading}</h1>}
        </header>
      )}

      <nav className={styles.tiles} aria-label={heading ?? "Choose a destination"}>
        {tiles.map((t) => {
          const inner = (
            <>
              <span className={styles.label}>{t.label}</span>
              {t.caption && <span className={styles.caption}>{t.caption}</span>}
            </>
          );
          return t.hardNav ? (
            <a key={t.to} href={t.to} className={styles.tile}>
              {inner}
            </a>
          ) : (
            <Link key={t.to} to={t.to} className={styles.tile}>
              {inner}
            </Link>
          );
        })}
      </nav>

      {backTo && (
        <Link to={backTo} className={styles.back}>
          ← {backLabel}
        </Link>
      )}
    </div>
  );
}
