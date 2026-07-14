-- Dedicated scratch table for WFS-T lock-flow tests (getFeatureWithLock /
-- WFSTFeatureLockStore / commitLockTransaction), kept separate from
-- test_features so plain CRUD tests and lock-flow tests never race on the
-- same rows in the same live GeoServer layer.
CREATE TABLE IF NOT EXISTS lock_features (
  id          serial PRIMARY KEY,
  label       text,
  geom        geometry(Geometry, 4326)
);

CREATE INDEX IF NOT EXISTS lock_features_geom_idx ON lock_features USING GIST (geom);
