import { GlassPanel } from "../../components/ui/GlassPanel";
import { BrandFooter } from "../../components/layout/BrandFooter";
import styles from "./LegalPage.module.css";

const sections = [
  { id: "privacy", label: "Privacy Policy" },
  { id: "tos", label: "Terms of Service" },
  { id: "refunds", label: "Refund Policy" },
  { id: "responsible", label: "Responsible Gaming" },
  { id: "fairplay", label: "Fair-Play Transparency" },
];

export function LegalPage() {
  return (
    <div className={styles.page}>
      <div className={styles.layout}>
        <nav className={styles.sidebar}>
          <h2 className={styles.sidebarTitle}>Legal Center</h2>
          {sections.map((s) => (
            <a key={s.id} href={`#${s.id}`} className={styles.sidebarLink}>
              {s.label}
            </a>
          ))}
        </nav>

        <div className={styles.content}>
          {/* Privacy Policy */}
          <section id="privacy" className={styles.section}>
            <h1 className={styles.h1}>Privacy Policy</h1>
            <p className={styles.meta}>
              <strong>Last Updated:</strong> May 2026
              <br />
              <strong>Operated by:</strong> SoverraAI Ltd. (Corporation No. 1766283-1), Waterloo, Ontario, Canada
            </p>

            <h2 className={styles.h2}>Introduction</h2>
            <p>
              SoverraAI Ltd. ("SoverraAI", "we", "our", "us") is committed to protecting your privacy. This
              Privacy Policy explains what information we collect, how we use it, and your rights regarding your
              data.
            </p>

            <h2 className={styles.h2}>Information We Collect</h2>
            <p>
              <strong>Information You Provide:</strong> Email address, optional profile info.
            </p>
            <p>
              <strong>Automatically Collected:</strong> Device model, OS version, crash logs, diagnostics,
              gameplay logs.
            </p>
            <p>
              <strong>Not Collected:</strong> Government IDs, contacts, SMS/call logs, precise location, payment
              card numbers.
            </p>

            <h2 className={styles.h2}>How We Use Data</h2>
            <p>
              We use data for app functionality, support, fraud prevention, analytics, and fair-play
              verification. We do not sell or rent your data.
            </p>

            <h2 className={styles.h2}>Contact</h2>
            <p>
              Email: <a href="mailto:support@soverraai.ca">support@soverraai.ca</a>
            </p>
          </section>

          {/* Terms of Service */}
          <section id="tos" className={styles.section}>
            <h1 className={styles.h1}>Terms of Service</h1>
            <p className={styles.meta}>
              <strong>Last Updated:</strong> May 2026
            </p>

            <h2 className={styles.h2}>1. Acceptance of Terms</h2>
            <p>
              By creating an account or using the SoverraAI: OpenDeck Poker mobile application ("the App"), you
              agree to these Terms of Service ("Terms"). If you do not agree, you must discontinue use of the
              App.
            </p>

            <h2 className={styles.h2}>2. Company Information</h2>
            <p>
              SoverraAI: Transparent Poker is operated by SoverraAI Ltd., a Canadian-controlled corporation
              headquartered out of Waterloo, Ontario, Canada. Corporation Number: 1766283-1.
            </p>

            <h2 className={styles.h2}>3. Eligibility</h2>
            <p>
              You must be at least 18 years old to use the App. You are responsible for ensuring that your use
              of the App complies with local laws.
            </p>

            <h2 className={styles.h2}>4. User Accounts</h2>
            <p>
              You must provide accurate information when creating an account. You are responsible for
              maintaining the confidentiality of your login credentials. SoverraAI may suspend or terminate
              accounts for:
            </p>
            <ul>
              <li>Fraud</li>
              <li>Abuse</li>
              <li>Chargeback manipulation</li>
              <li>Violation of these Terms</li>
              <li>Attempts to interfere with the fairness or integrity of gameplay</li>
            </ul>

            <h2 className={styles.h2}>5. Deposits, Withdrawals, and User Balances</h2>
            <h3 className={styles.h3}>5.1 Supported Payment Methods</h3>
            <p>The App supports deposits and withdrawals through:</p>
            <ul>
              <li>ACH transfers</li>
              <li>Interac e-Transfers</li>
              <li>Credit and debit cards</li>
              <li>Crypto payments (including Monero)</li>
              <li>MoonPay and similar on-ramp services</li>
            </ul>
            <p>All transactions are processed through SoverraAI's backend systems.</p>

            <h3 className={styles.h3}>5.2 Trust-Account Structure</h3>
            <p>
              SoverraAI Ltd. maintains a segregated trust account with the Royal Bank of Canada (RBC) for the
              sole purpose of holding user balances.
            </p>
            <ul>
              <li>User funds are not corporate assets</li>
              <li>User funds are not commingled with operational accounts</li>
              <li>User funds remain the legal property of the user at all times</li>
              <li>SoverraAI acts as a trustee and operator, not a financial custodian</li>
            </ul>

            <h3 className={styles.h3}>5.3 Full Legal Liability for Registered User Deposits</h3>
            <p>SoverraAI Ltd. accepts full operational responsibility and legal liability for:</p>
            <ul>
              <li>Receiving user deposits</li>
              <li>Holding user balances in trust</li>
              <li>Processing withdrawals</li>
              <li>Maintaining accurate ledger records</li>
              <li>Ensuring funds are available for payout upon request</li>
            </ul>
            <p>SoverraAI is legally obligated to safeguard user balances and ensure they remain redeemable.</p>

            <h3 className={styles.h3}>5.4 Deposit Locks</h3>
            <p>Certain deposits may be temporarily locked for:</p>
            <ul>
              <li>Anti-fraud checks</li>
              <li>Payment processor clearance</li>
              <li>Compliance reviews</li>
              <li>Chargeback risk mitigation</li>
            </ul>
            <p>Locked funds remain the property of the user and are held in trust until released.</p>

            <h3 className={styles.h3}>5.5 Withdrawals</h3>
            <p>Users may request withdrawals at any time, subject to:</p>
            <ul>
              <li>Identity verification</li>
              <li>Anti-fraud checks</li>
              <li>Payment processor availability</li>
              <li>Compliance with applicable laws</li>
            </ul>
            <p>Withdrawals are paid from the segregated trust account.</p>

            <h3 className={styles.h3}>5.6 Crypto Transactions</h3>
            <p>Crypto deposits (including Monero) are:</p>
            <ul>
              <li>Irreversible</li>
              <li>Final once confirmed on the blockchain</li>
              <li>Refundable only in cases of processing error</li>
            </ul>
            <p>
              Withdrawals are sent to the wallet address provided by the user. SoverraAI is not responsible for
              incorrect or mistyped addresses.
            </p>

            <h2 className={styles.h2}>6. Refunds</h2>
            <p>Refunds for deposits may be issued when:</p>
            <ul>
              <li>A deposit was made in error</li>
              <li>A duplicate transaction occurred</li>
              <li>A payment processor error occurred</li>
              <li>A deposit was not credited properly</li>
              <li>A user requests a refund before funds are used in gameplay</li>
            </ul>
            <p>Refunds are returned to the original payment method whenever possible. Refunds are not issued for:</p>
            <ul>
              <li>Completed gameplay</li>
              <li>Losses incurred during gameplay</li>
              <li>User mistakes or misclicks</li>
            </ul>
            <p>See the Refund Policy for full details.</p>

            <h2 className={styles.h2}>7. Fair Play & Cryptographic Transparency</h2>
            <p>
              SoverraAI uses a commit–reveal cryptographic shuffle system to ensure provably fair gameplay. The
              system:
            </p>
            <ul>
              <li>Publishes a hashed commitment before each shuffle</li>
              <li>Reveals the seed after the hand</li>
              <li>Allows users to independently reproduce and verify the shuffle</li>
            </ul>
            <p>Users agree not to exploit, manipulate, or interfere with this system.</p>

            <h2 className={styles.h2}>8. Prohibited Conduct</h2>
            <p>You may not:</p>
            <ul>
              <li>Attempt to manipulate gameplay</li>
              <li>Interfere with the cryptographic shuffle</li>
              <li>Use bots, scripts, or automation</li>
              <li>Engage in fraud or chargeback abuse</li>
              <li>Reverse-engineer or tamper with the App</li>
              <li>Use the App for illegal activities</li>
            </ul>

            <h2 className={styles.h2}>9. Limitation of Liability</h2>
            <p>
              To the fullest extent permitted by law, SoverraAI Ltd. is not liable for loss of data, device
              damage, network outages, third-party payment processor failures, user mistakes, or incorrect
              crypto wallet addresses. However, SoverraAI remains fully liable for the safekeeping and payout of
              user deposits held in trust, as described in Section 5.
            </p>

            <h2 className={styles.h2}>10. Termination</h2>
            <p>
              SoverraAI may suspend or terminate accounts for violations of these Terms. Users may close their
              account at any time and request withdrawal of their remaining balance.
            </p>

            <h2 className={styles.h2}>11. Changes to Terms</h2>
            <p>We may update these Terms periodically. Continued use of the App constitutes acceptance of the updated Terms.</p>

            <h2 className={styles.h2}>12. Contact Information</h2>
            <p>
              For questions or support: <a href="mailto:support@soverraai.com">support@soverraai.com</a>
              <br />
              SoverraAI Ltd., Waterloo, Ontario, Canada
            </p>
          </section>

          {/* Refund Policy */}
          <section id="refunds" className={styles.section}>
            <h1 className={styles.h1}>Refund Policy</h1>
            <p className={styles.meta}>
              <strong>Last Updated:</strong> May 2026
            </p>

            <h2 className={styles.h2}>Refund Eligibility</h2>
            <p>
              Refunds may be issued for duplicate deposits, processor errors, or misapplied funds. Refunds are
              not issued for completed gameplay.
            </p>

            <h2 className={styles.h2}>Crypto Transactions</h2>
            <p>Crypto refunds apply only to processing errors.</p>

            <h2 className={styles.h2}>Contact</h2>
            <p>
              Email: <a href="mailto:support@soverraai.ca">support@soverraai.ca</a>
            </p>
          </section>

          {/* Responsible Gaming */}
          <section id="responsible" className={styles.section}>
            <h1 className={styles.h1}>Responsible Gaming</h1>
            <p className={styles.meta}>
              <strong>Last Updated:</strong> May 2026
              <br />
              <strong>Operated by:</strong> SoverraAI Ltd. (Corporation No. 1766283-1), Kitchener, Ontario,
              Canada
            </p>
            <p>
              SoverraAI Ltd. is committed to providing a safe, transparent, and responsible gaming environment.
              Our mission is to ensure that every user enjoys a fair, controlled, and informed experience while
              maintaining full ownership and control over their funds.
            </p>

            <h2 className={styles.h2}>1. Our Commitment to Fairness</h2>
            <p>
              SoverraAI: Transparent Poker is built on a cryptographically verifiable shuffle system that
              ensures every hand is provably fair. We believe responsible gaming begins with trust, and trust
              begins with transparency. Our commit–reveal randomness system allows players to:
            </p>
            <ul>
              <li>Verify every shuffle</li>
              <li>Reproduce deck order</li>
              <li>Confirm fairness independently</li>
              <li>Audit gameplay at any time</li>
            </ul>
            <p>This "glass-box" approach ensures no manipulation, rigging, or hidden advantage.</p>

            <h2 className={styles.h2}>2. User Control Over Funds</h2>
            <p>SoverraAI supports deposits and withdrawals through:</p>
            <ul>
              <li>ACH transfers</li>
              <li>Interac e-Transfers</li>
              <li>Credit and debit cards</li>
              <li>Crypto (including Monero)</li>
              <li>MoonPay and similar on-ramps</li>
            </ul>
            <p>
              All user funds are held in a segregated trust account with the Royal Bank of Canada (RBC). Funds
              remain the legal property of the user at all times. SoverraAI:
            </p>
            <ul>
              <li>Does not commingle user funds with corporate funds</li>
              <li>Does not lend, pledge, or rehypothecate user balances</li>
              <li>Accepts full operational responsibility and legal liability for safeguarding user deposits</li>
              <li>Ensures funds are always available for withdrawal</li>
            </ul>
            <p>This structure protects users and promotes responsible financial engagement.</p>

            <h2 className={styles.h2}>3. Play Responsibly</h2>
            <p>
              Poker is a game of skill, strategy, and probability — but it should always remain entertainment,
              not a financial burden. We encourage users to:
            </p>
            <ul>
              <li>Set personal limits</li>
              <li>Play within their means</li>
              <li>Take breaks during extended sessions</li>
              <li>Avoid chasing losses</li>
              <li>Monitor their emotional state while playing</li>
            </ul>
            <p>If gameplay stops being enjoyable, we strongly recommend stepping away.</p>

            <h2 className={styles.h2}>4. Self-Exclusion & Account Controls</h2>
            <p>Users may request:</p>
            <ul>
              <li>Temporary account suspension</li>
              <li>Permanent account closure</li>
              <li>Deposit limits</li>
              <li>Session reminders</li>
              <li>Cooling-off periods</li>
            </ul>
            <p>
              To request any of these controls, contact <a href="mailto:support@soverraai.com">support@soverraai.com</a>.
              We will process all responsible-gaming requests promptly and confidentially.
            </p>

            <h2 className={styles.h2}>5. Recognizing Problem Gaming</h2>
            <p>You may be at risk of problem gaming if you:</p>
            <ul>
              <li>Spend more money than intended</li>
              <li>Feel stress or anxiety related to gameplay</li>
              <li>Attempt to recover losses through more play</li>
              <li>Neglect responsibilities or relationships</li>
              <li>Hide or lie about your gaming activity</li>
            </ul>
            <p>If you recognize these signs, consider taking a break or seeking support.</p>

            <h2 className={styles.h2}>6. External Support Resources</h2>
            <ul>
              <li>ConnexOntario (Canada) — connexontario.ca</li>
              <li>Gamblers Anonymous — gamblersanonymous.org</li>
              <li>National Council on Problem Gambling — ncpgambling.org</li>
            </ul>
            <p>These services are independent and available 24/7.</p>

            <h2 className={styles.h2}>7. Underage Use</h2>
            <p>
              The App is strictly for users 18 years of age or older. We do not knowingly permit minors to
              create accounts or engage in gameplay.
            </p>

            <h2 className={styles.h2}>8. Transparency, Safety, and User Rights</h2>
            <p>
              SoverraAI is built on the principles of transparency, user ownership, fairness, financial safety,
              and informed decision-making. We continuously improve our systems to ensure a safe and responsible
              environment for all users.
            </p>
          </section>

          {/* Fair Play Transparency */}
          <section id="fairplay" className={styles.section}>
            <h1 className={styles.h1}>Fair-Play Transparency</h1>
            <p className={styles.meta}>
              <strong>Last Updated:</strong> May 2026
            </p>

            <h2 className={styles.h2}>How Commit–Reveal Works</h2>
            <ol>
              <li>The server generates a secret shuffle seed.</li>
              <li>A cryptographic hash (commitment) is published.</li>
              <li>The deck is shuffled deterministically.</li>
              <li>The seed is revealed after the hand.</li>
              <li>Anyone can verify the shuffle independently.</li>
            </ol>

            <h2 className={styles.h2}>Real-Time Indicators</h2>
            <GlassPanel className={styles.indicatorPanel}>Committed → Revealed → Verified</GlassPanel>
          </section>
        </div>
      </div>

      <BrandFooter />
    </div>
  );
}
