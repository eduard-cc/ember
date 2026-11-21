<h1>
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="docs/brand/ember-dark.png" />
    <img src="docs/brand/ember-light.png" alt="Ember" width="193" height="49" />
  </picture>
</h1>

A local-first mobile workout tracker with inspectable history, editable templates, and a separate privately hosted API. It keeps history imported from Strong exports with its source cells; the app itself has no import flow.

| Path                 | What                                                                               |
| -------------------- | ---------------------------------------------------------------------------------- |
| `apps/web`           | The React PWA; setup, checks and docs in `apps/web/README.md`                      |
| `apps/api`           | The NestJS sync API; setup, secrets and owner mode in `apps/api/README.md`         |
| `packages/contracts` | The documents and sync API both apps share (`packages/contracts/README.md`)        |
| `ops`                | Deploy, backup and host-setup scripts, and how the live app runs (`ops/README.md`) |
| `docs`               | Topics that span both apps: CI and the production image (`docs/ci-and-images.md`)  |

Each app has its own `package.json`, lockfile and checks; run npm inside it (`npm --prefix apps/web …`). The Node major is in `.nvmrc`.

## License

View only; see `LICENSE`. Third-party catalog content keeps its own licenses.
