# The app container runs through `docker run`, not Compose

`ember.service` starts the `ember-app` container with a plain `docker run` in `ops/start.sh`, joined to the network of the Compose project that runs only `ember-postgres` (`ops/compose.local.yml`). Moving the app into that Compose project was considered and rejected: it would make the setup easier to read and change nothing else, while the switch would recreate the live database container. Keep the split unless a change needs more than readability.
