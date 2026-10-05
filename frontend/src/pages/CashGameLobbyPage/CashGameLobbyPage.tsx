import { ScreenerTiles } from "../../components/ui/ScreenerTiles";
import { BrandFooter } from "../../components/layout/BrandFooter";
import { CASH_TABLES } from "./cashTables";

/**
 * Cash-game lobby (route: /cash-games). Same large, centered, gold-glow tiles
 * as the landing / LIVE screeners; each tile opens one cash-game table.
 */
export function CashGameLobbyPage() {
  return (
    <>
      <ScreenerTiles
        eyebrow="Cash games"
        heading="Choose a table"
        tiles={CASH_TABLES.map((t) => ({ label: t.label, to: t.to }))}
        backTo="/live"
        backLabel="Back to Live"
      />
      <BrandFooter />
    </>
  );
}
