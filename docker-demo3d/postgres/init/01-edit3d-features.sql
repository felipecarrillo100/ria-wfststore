CREATE EXTENSION IF NOT EXISTS postgis;

-- Persistent WFS-T table for manual/demo-3d testing of ria-3d-shape-editor. Strictly-3D-typed
-- geometry column (geometry(GeometryZ, 4326)), not a generic untyped one - see the equivalent
-- comment in docker/postgres/init/03-test-features-3d.sql for why that distinction matters for
-- PostGIS/GeoServer to actually preserve Z through WFS-T.
CREATE TABLE IF NOT EXISTS edit3d_features (
  id          serial PRIMARY KEY,
  label       text,
  geom        geometry(GeometryZ, 4326)
);

CREATE INDEX IF NOT EXISTS edit3d_features_geom_idx ON edit3d_features USING GIST (geom);
