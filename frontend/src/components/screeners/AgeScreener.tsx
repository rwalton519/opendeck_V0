import { useEffect, useRef } from "react";
import { MIN_AGE } from "./screenerConfig";
import { useScreenerModal } from "./useScreenerModal";
import styles from "./Screeners.module.css";

interface AgeScreenerProps {
  onYes: () => void;
  onNo: () => void;
}

/**
 * Pseudo-screener #1: a fully translucent layer over the landing page with
 * nothing but a centered "Are you 18+?" prompt and Yes / No boxes.
 * Deliberately has no close button and no Escape handling - it can only be
 * answered.
 */
export function AgeScreener({ onYes, onNo }: AgeScreenerProps) {
  const layerRef = useRef<HTMLDivElement>(null);
  const yesRef = useRef<HTMLButtonElement>(null);
  useScreenerModal(layerRef);

  useEffect(() => {
    yesRef.current?.focus();
  }, []);

  return (
    <div ref={layerRef} className={styles.ageLayer} role="dialog" aria-modal="true" aria-labelledby="age-screener-q">
      <div className={styles.ageContent}>
        <h2 id="age-screener-q" className={styles.ageQuestion}>
          Are you {MIN_AGE}+?
        </h2>
        <div className={styles.ageChoices}>
          <button ref={yesRef} type="button" className={styles.ageChoice} onClick={onYes}>
            Yes
          </button>
          <button type="button" className={styles.ageChoice} onClick={onNo}>
            No
          </button>
        </div>
      </div>
    </div>
  );
}
