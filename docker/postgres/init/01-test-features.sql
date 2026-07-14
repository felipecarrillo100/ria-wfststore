CREATE EXTENSION IF NOT EXISTS postgis;

-- Kept intentionally narrow: the client (standardizeProperties in
-- src/libs/ParseWFSFeatureDescription.ts) requires every non-geometry attribute
-- GeoServer advertises in DescribeFeatureType to be present on the feature being
-- written, so this table only exposes "label" beyond the geometry and PK.
CREATE TABLE IF NOT EXISTS test_features (
  id          serial PRIMARY KEY,
  label       text,
  geom        geometry(Geometry, 4326)
);

CREATE INDEX IF NOT EXISTS test_features_geom_idx ON test_features USING GIST (geom);
