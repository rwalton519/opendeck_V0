import { GlassPanel } from "../../components/ui/GlassPanel";
import { BrandFooter } from "../../components/layout/BrandFooter";
import styles from "./CareersPage.module.css";

const roles = [
  {
    title: "Senior Cryptography Engineer",
    desc: "Design and refine the commit–reveal systems that power our provably fair gameplay. Ideal for someone who sees beauty in math — and knows how to weaponize it for transparency.",
  },
  {
    title: "Backend Systems Architect",
    desc: "Build the infrastructure that moves real money safely, instantly, and verifiably. Trust accounts, multi-rail payments, and high-integrity ledgers are your playground.",
  },
  {
    title: "Senior Flutter Engineer",
    desc: "Create a clean, modern, distraction-free poker experience. Material 3 mastery and a love for elegant UI are essential.",
  },
  {
    title: "Game Integrity Analyst",
    desc: "Monitor gameplay, detect anomalies, and ensure fairness at scale. You see patterns others miss.",
  },
];

export function CareersPage() {
  return (
    <div className={styles.page}>
      <section className={styles.hero}>
        <p className={styles.eyebrow}>Join us</p>
        <h1 className={styles.title}>Careers at SoverraAI</h1>
        <p className={styles.lede}>
          SoverraAI is built by people who believe trust should be engineered, not assumed. If that resonates
          with you, you might belong here.
        </p>
      </section>

      <section>
        <h2 className={styles.sectionTitle}>Open Roles</h2>
        <div className={styles.roleGrid}>
          {roles.map((r) => (
            <GlassPanel key={r.title} className={styles.roleCard}>
              <h3 className={styles.roleTitle}>{r.title}</h3>
              <p className={styles.roleDesc}>{r.desc}</p>
              <span className={styles.applyBtn}>Apply — Coming Soon</span>
            </GlassPanel>
          ))}
        </div>
      </section>

      <section className={styles.textSection}>
        <h2 className={styles.sectionTitle}>How We Work</h2>
        <p>
          We keep teams small, expectations high, and bureaucracy nonexistent. We value clarity, precision, and
          people who think independently.
        </p>
        <p>We don't hire often. When we do, it's because we found someone exceptional.</p>
      </section>

      <section className={styles.textSection}>
        <h2 className={styles.sectionTitle}>Interested?</h2>
        <p>Even if no role fits perfectly, we read every message from people who resonate with our mission.</p>
        <p>
          <strong>Email:</strong>{" "}
          <a className={styles.contactLink} href="mailto:info@soverraai.ca">
            info@soverraai.ca
          </a>
        </p>
      </section>

      <BrandFooter />
    </div>
  );
}
