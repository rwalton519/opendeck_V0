# Fairness verification & hand backtesting — not included in this public version

The "Backtest your hand" feature and the browser-side fairness verifiers are part of OpenDeck's proprietary commit–reveal shuffle protocol (the subject of a provisional patent application), so they are **excluded from this public repository**. Removed with them:

- the verifier implementations that lived in this folder (seeded deterministic shuffle and cut, re-implemented client-side),
- the Backtest page (`frontend/src/pages/BacktestPage/`),
- the fairness API client (`frontend/src/api/fairness.ts`) and types (`frontend/src/types/fairness.ts`),
- the backend practice-game router and its backing model.

The protocol is described at a high level in the project README. The live product at opendeck.ca runs the full feature.
