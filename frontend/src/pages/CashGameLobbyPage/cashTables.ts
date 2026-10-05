import { DEFAULT_CASH_TABLE_ID } from "../../types/cashgame";

/**
 * Cash-game lobby table list - the single place that decides how many boxes the
 * lobby shows and which table each one opens.
 *
 * Table 1 is the original table (id = DEFAULT_CASH_TABLE_ID, "main") and stays
 * at plain "/cash-game". Tables 2..N live at "/cash-game/table-N". The backend
 * creates a table lazily the first time a non-numeric id is requested
 * (CashGameManager.resolveTableId), so adding a table is just raising the count.
 */
export const CASH_TABLE_COUNT = 5;

export interface CashTableEntry {
  number: number;
  label: string;
  tableId: string;
  /** Route the lobby box links to. */
  to: string;
}

function tableIdFor(number: number): string {
  return number === 1 ? DEFAULT_CASH_TABLE_ID : `table-${number}`;
}

export const CASH_TABLES: CashTableEntry[] = Array.from({ length: CASH_TABLE_COUNT }, (_, i) => {
  const number = i + 1;
  const tableId = tableIdFor(number);
  return {
    number,
    label: `Table ${number}`,
    tableId,
    to: number === 1 ? "/cash-game" : `/cash-game/${tableId}`,
  };
});

/** "Table 3" for "table-3", "Table 1" for the default id; falls back to the raw id. */
export function cashTableLabel(tableId: string): string {
  return CASH_TABLES.find((t) => t.tableId === tableId)?.label ?? tableId;
}
