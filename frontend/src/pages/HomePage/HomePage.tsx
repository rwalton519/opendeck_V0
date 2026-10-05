import { ScreenerTiles } from "../../components/ui/ScreenerTiles";
import { BrandFooter } from "../../components/layout/BrandFooter";
import { LandingScreeners } from "../../components/screeners/LandingScreeners";

/**
 * Screener #1: LIVE (real-money) vs DEMO (play-money / fairness tools).
 * LIVE -> /live (CASH GAMES | TOURNAMENTS); DEMO -> /demos.
 *
 * <LandingScreeners /> layers the age prompt and the email/sign-in prompt over
 * this page (see components/screeners/LandingScreeners.tsx).
 */
export function HomePage() {
  return (
    <>
      <LandingScreeners />
      <ScreenerTiles
        eyebrow="Provably fair, seat to seat"
        tiles={[
          { label: "LIVE", caption: "Real-money tables", to: "/live" },
          { label: "DEMO", caption: "Play-money & fairness tools", to: "/demos" },
        ]}
      />
      <BrandFooter />
    </>
  );
}
