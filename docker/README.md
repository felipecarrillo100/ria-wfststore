# Local WFS-T test server

A disposable PostGIS + GeoServer stack used by `npm run test` (see `src/WFSTFeatureStore.test.ts`
and `src/WFSCapabilitiesExtended.test.ts`) instead of a shared/internal GeoServer instance.

## Start it

```
docker compose -f docker/docker-compose.yml up -d
```

First run pulls images and can take a minute or two. `docker compose ps` should end with `postgis`
and `geoserver` healthy, and `states-loader` / `geoserver-bootstrap` exited with code `0`.

GeoServer admin UI: http://localhost:8081/geoserver/web/ (`admin` / `geoserver`, see `docker/.env`).

## What gets created

Workspace `wfst_test`, PostGIS datastore `geodata`, and two WFS-T layers:

* **`wfst_test:states`** — the 51 US states from LuciadRIA's `sampledata/states.json`, read-only in
  practice (nothing deletes/inserts into it), used for query/read tests.
* **`wfst_test:test_features`** — an empty scratch table (`id`, `label`, `geom`) with anonymous
  read+write enabled, used for insert/update/delete tests. Kept intentionally narrow: see the
  comment in `docker/postgres/init/01-test-features.sql` — the client requires every non-geometry
  column GeoServer advertises to be supplied on insert/update, so extra columns (e.g. a
  `created_at` timestamp) break writes unless tests are updated to set them too.

`docker/bootstrap/bootstrap.sh` does this over the GeoServer REST API and is idempotent — safe to
re-run.

## Resetting to a clean state

The stack has no named volumes, so a full reset is:
```
docker compose -f docker/docker-compose.yml down -v
docker compose -f docker/docker-compose.yml up -d
```
This reloads all 51 states and empties `test_features` again. The bootstrap script also truncates
`test_features` on every startup, so a plain `up` (without `down` first) also starts with an empty
scratch table even if the containers were left running.

## Notes

* GeoServer's default security ACL restricts writes to admin roles; the bootstrap script grants
  anonymous read+write specifically on the two `wfst_test` layers. Don't expose this stack beyond
  localhost.
* `postgis/postgis` has no arm64 build, so this uses `imresamu/postgis` (a multi-arch drop-in) on
  Apple Silicon / arm64 hosts.
