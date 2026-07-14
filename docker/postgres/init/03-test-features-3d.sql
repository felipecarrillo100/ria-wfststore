-- Dedicated 3D scratch table, kept separate from test_features rather than widening that
-- column's dimensionality. Verified empirically: a PostGIS typed geometry column is either
-- strictly 2D (geometry(Geometry, 4326), what test_features uses) or strictly 3D
-- (geometry(GeometryZ, 4326), here) - never both. Inserting a Z geometry into the 2D-typed
-- column fails ("Geometry has Z dimension but column does not"), and inserting a 2D geometry
-- into a GeometryZ-typed column fails the same way in reverse. Mixing dimensionalities in one
-- table would require a fully untyped `geometry` column (no typmod at all), which would also
-- have widened test_features away from its existing, already-relied-upon 2D-only contract -
-- a separate table avoids that entirely.
CREATE TABLE IF NOT EXISTS test_features_3d (
  id          serial PRIMARY KEY,
  label       text,
  geom        geometry(GeometryZ, 4326)
);

CREATE INDEX IF NOT EXISTS test_features_3d_geom_idx ON test_features_3d USING GIST (geom);
