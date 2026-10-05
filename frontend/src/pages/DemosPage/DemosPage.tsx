import { ScreenerTiles } from "../../components/ui/ScreenerTiles";
import { BrandFooter } from "../../components/layout/BrandFooter";

/**
 * opendeck.ca/demos - hub for the three no-account demo pages.
 * These are standalone static pages in public/ (not SPA routes), so they use
 * hard navigation. Trailing slashes avoid depending on the nginx 301 rules
 * for the bare paths (see deploy/nginx/opendeck-webapp.conf).
 */
export function DemosPage() {
  return (
    <>
      <ScreenerTiles
        eyebrow="Demo"
        heading="No account needed"
        tiles={[
          { label: "CASH GAME DEMO", caption: "9 seats, $500 play-money stacks", to: "/cashgame-demo/", hardNav: true },
          { label: "HEADS UP (DEMO)", caption: "1-on-1, $500 play-money stacks", to: "/heads-up/", hardNav: true },
          {
            label: "RANDOM SHUFFLE TEST TABLE",
            caption: "Verifiable seeds and commit hashes",
            to: "/RNG-shuffle-tester/",
            hardNav: true,
          },
        ]}
        backTo="/"
      />
      <BrandFooter />
    </>
  );
}
