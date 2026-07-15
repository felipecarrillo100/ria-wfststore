-- Backing table for the password-protected wfst_secured:secured_features layer (see
-- docker/bootstrap/bootstrap.sh). Kept in the same geodata database as the other scratch
-- tables - it's the GeoServer workspace/datastore/ACL rule that enforces the password
-- protection, not the table itself.
CREATE TABLE IF NOT EXISTS secured_features (
  id          serial PRIMARY KEY,
  label       text,
  geom        geometry(Geometry, 4326)
);

CREATE INDEX IF NOT EXISTS secured_features_geom_idx ON secured_features USING GIST (geom);
