import { GlassPanel } from "../../components/ui/GlassPanel";
import { BrandFooter } from "../../components/layout/BrandFooter";
import styles from "./AboutPage.module.css";

export function AboutPage() {
  return (
    <div className={styles.page}>
      <section className={styles.hero}>
        <p className={styles.eyebrow}>Who we are</p>
        <h1 className={styles.title}>About SoverraAI</h1>
        <p className={styles.lede}>SoverraAI was founded on a simple idea: trust should be earned, not assumed.</p>
      </section>

      <section className={styles.intro}>
        <p>
          We build systems where fairness isn't hidden behind algorithms — it's exposed, verifiable, and undeniable.
          Where your funds remain yours. Where every shuffle can be proven. Where transparency isn't a feature —
          it's the foundation.
        </p>
        <p>
          We are engineers, cryptographers, and designers who believe that games should be honest, systems should
          be open, and users should always stay in control.
        </p>
        <p>SoverraAI is not just a platform. It's a new standard for digital trust.</p>
      </section>

      <section className={styles.skillSection}>
        <h2 className={styles.sectionTitle}>Poker: Skill or Chance?</h2>
        <GlassPanel className={styles.skillPanel}>
          <p className={styles.caseLine}>
            <strong>United States v. DiCristina (2012)</strong> — the landmark federal case that ruled Texas
            No-Limit Hold 'em is predominantly a game of skill rather than chance.
          </p>

          <h3 className={styles.subTitle}>The Ruling</h3>
          <p>
            In August 2012, Senior U.S. District Judge Jack B. Weinstein issued a 120-page opinion analyzing
            whether poker is gambling under federal law.
          </p>

          <h3 className={styles.subTitle}>The Skill Predominance Test</h3>
          <p>
            Judge Weinstein applied the "predominance test," which states that a game is gambling only if chance
            is the dominant factor in determining outcomes.
          </p>

          <h3 className={styles.subTitle}>The Evidence</h3>
          <p>
            Expert testimony from Dr. Randal Heeb — supported by statistical analysis of hundreds of millions of
            online poker hands — demonstrated that skilled players consistently outperform unskilled players over
            time.
          </p>

          <h3 className={styles.subTitle}>The Conclusion</h3>
          <p>Judge Weinstein concluded:</p>
          <blockquote className={styles.quote}>
            "The government's argument that poker is a game of chance is contradicted by a wealth of data...
            Expert poker players draw on an array of talents... Players can use these skills to win even if
            chance has not dealt them the better hand."
          </blockquote>
          <p>
            In short: <strong>Texas Hold 'em was ruled to be a game of skill.</strong>
          </p>
        </GlassPanel>
      </section>

      <BrandFooter />
    </div>
  );
}
