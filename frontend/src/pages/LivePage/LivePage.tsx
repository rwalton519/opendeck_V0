import { ScreenerTiles } from "../../components/ui/ScreenerTiles";
import { BrandFooter } from "../../components/layout/BrandFooter";

/** Screener #2: choose between live cash games and tournaments. */
export function LivePage() {
  return (
    <>
      <ScreenerTiles
        eyebrow="Live"
        tiles={[
          { label: "CASH GAMES", caption: "Take a seat at a live table", to: "/cash-games" },
          { label: "TOURNAMENTS", caption: "Browse and register", to: "/tournaments" },
        ]}
        backTo="/"
      />
      <BrandFooter />
    </>
  );
}
