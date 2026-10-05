# API documentation

- **`openapi.yaml`** — OpenAPI 3.0 spec covering all ~56 routes across auth, wallet
  (deposit/withdraw/crypto/Stripe Connect), tournaments, live cash-game play, the
  provably-fair RNG engine, KYC, and admin. Served live at `GET /docs` (Swagger UI) once
  the server is running, and as raw YAML at `GET /docs/openapi.yaml`.
- **`OpenDeck.postman_collection.json`** — generated directly from `openapi.yaml` via
  `openapi-to-postmanv2`, grouped into the same 9 folders as the spec's tags (Auth, Wallet,
  Tournaments, Cash Game, Provably-Fair RNG, Stripe Connect, KYC, Admin, Health). Import
  directly into Postman/Insomnia.
- **`OpenDeck.postman_environment.json`** — a starter local-dev environment (`baseUrl`,
  `adminToken`, `userId`). Import alongside the collection; set `adminToken` after calling
  `POST /admin/login`, since every `/admin/*` request other than login needs it as a Bearer
  token.

## Regenerating the Postman collection after editing openapi.yaml

```bash
npm install -g openapi-to-postmanv2
openapi2postmanv2 -s docs/api/openapi.yaml -o docs/api/OpenDeck.postman_collection.json -p
```

## Notes on coverage

Every route actually mounted in `server.js` is documented. A handful of the more
support/tooling-oriented admin endpoints (`/admin/force_seat`, `/admin/force_remove`,
`/admin/dashboard/*`) have intentionally lighter schemas (summary + auth requirement, no
full request/response body) since they're internal tooling rather than public API surface —
extend them if/when they need to be consumed by something other than the admin dashboard
itself.
