# Persistent WFS-T demo server (ria-3d-shape-editor)

A separate, **persistent** PostGIS + GeoServer stack for manually exercising `ria-3d-shape-editor`
against a real WFS-T backend from `demo-3d/` - kept entirely independent from `docker/` (the
disposable stack `npm run test` uses), so running the automated test suite (including a full
`docker compose down -v && up -d` reset of that stack) never touches this one, and vice versa.

## Start it

```
docker compose -f docker-demo3d/docker-compose.yml up -d
```

GeoServer admin UI: http://localhost:8093/geoserver/web/ (`admin` / `geoserver`, see `.env`).

## What gets created

Workspace `demo3d`, PostGIS datastore `geodata`, one WFS-T layer:

* **`demo3d:edit3d_features`** (`id`, `label`, `geom` - `geometry(GeometryZ, 4326)`, strictly 3D)
  with anonymous read+write enabled.

Data in this table is **not** truncated on startup (unlike `docker/`'s scratch tables) - both
Postgres and GeoServer's own data directory are backed by named Docker volumes
(`docker-demo3d_postgis_data`, `docker-demo3d_geoserver_data`), so edits made while running the
demo survive container restarts (`docker compose restart` / a plain `up -d` after stopping) and
even a `docker compose down` without `-v`.

## Resetting to a clean state

Only do this deliberately - it deletes everything in this stack (and only this stack; it has no
effect on `docker/`):
```
docker compose -f docker-demo3d/docker-compose.yml down -v
docker compose -f docker-demo3d/docker-compose.yml up -d
```

## Notes

* Uses a different GeoServer port (`8093`) and workspace name (`demo3d`) than the test stack's
  `8092`/`wfst_test`, so both can run simultaneously with no conflict.
* Same anonymous-write-ACL caveat as `docker/`: don't expose this stack beyond localhost.
