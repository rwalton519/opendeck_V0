import styles from "./UnverifiedPage.module.css";

/**
 * opendeck.ca/unverified - where "No" on the age screener lands.
 * Intentionally nothing but a white screen and a cartoonish frown. Mounted as
 * a standalone route (no AppShell) and statically imported in App.tsx so there
 * is no dark "Loading..." flash before the white page appears.
 */
export function UnverifiedPage() {
  return (
    <div className={styles.page} role="img" aria-label="Frowning face">
      🙁
    </div>
  );
}
