# Client-side fairness verifiers — not included in this public version

The browser-side verifiers in this folder re-implement OpenDeck's proprietary commit–reveal shuffle (seeded deterministic shuffle and cut) so players can independently check a dealt deck. Because they mirror the patent-pending protocol, their implementations are **excluded from this public repository**.

The fairness API client (`frontend/src/api/fairness.ts`) and types (`frontend/src/types/fairness.ts`) remain, so the integration shape is visible; the verifier code itself is not published here.
