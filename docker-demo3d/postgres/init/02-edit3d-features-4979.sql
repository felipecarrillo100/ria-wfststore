-- Persistent WFS-T table for testing a true-3D geographic CRS (EPSG:4979: lat/lon/ellipsoidal
-- height) end-to-end through GeoServer, as a side-by-side comparison against edit3d_features
-- (EPSG:4326, nominally 2D). Strictly-3D-typed geometry column, same reasoning as
-- 01-edit3d-features.sql.
CREATE TABLE IF NOT EXISTS edit3d_features_4979 (
  id          serial PRIMARY KEY,
  label       text,
  geom        geometry(GeometryZ, 4979)
);

CREATE INDEX IF NOT EXISTS edit3d_features_4979_geom_idx ON edit3d_features_4979 USING GIST (geom);
