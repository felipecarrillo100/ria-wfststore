#!/bin/bash
set -euo pipefail

GS_URL="${GEOSERVER_URL}"
AUTH="${GEOSERVER_ADMIN_USER}:${GEOSERVER_ADMIN_PASSWORD}"
WORKSPACE="${GEOSERVER_WORKSPACE}"
DATASTORE="${GEOSERVER_DATASTORE}"

log() { echo "[bootstrap] $*"; }

http_status() {
  curl -s -o /dev/null -w "%{http_code}" -u "$AUTH" "$1"
}

log "Waiting for GeoServer REST API at $GS_URL ..."
attempt=0
until [ "$(http_status "$GS_URL/rest/about/version.json")" = "200" ]; do
  attempt=$((attempt + 1))
  if [ "$attempt" -ge 60 ]; then
    log "GeoServer REST API did not become available in time"
    exit 1
  fi
  sleep 2
done
log "GeoServer REST API is up."

if [ "$(http_status "$GS_URL/rest/workspaces/$WORKSPACE.json")" != "200" ]; then
  log "Creating workspace $WORKSPACE"
  curl -sf -u "$AUTH" -X POST -H "Content-Type: application/json" \
    -d "{\"workspace\":{\"name\":\"$WORKSPACE\"}}" \
    "$GS_URL/rest/workspaces"
else
  log "Workspace $WORKSPACE already exists"
fi

if [ "$(http_status "$GS_URL/rest/workspaces/$WORKSPACE/datastores/$DATASTORE.json")" != "200" ]; then
  log "Creating datastore $DATASTORE"
  curl -sf -u "$AUTH" -X POST -H "Content-Type: application/json" -d @- \
    "$GS_URL/rest/workspaces/$WORKSPACE/datastores" <<JSON
{
  "dataStore": {
    "name": "$DATASTORE",
    "connectionParameters": {
      "entry": [
        {"@key": "host", "\$": "postgis"},
        {"@key": "port", "\$": "5432"},
        {"@key": "database", "\$": "$PGDATABASE"},
        {"@key": "schema", "\$": "public"},
        {"@key": "user", "\$": "$PGUSER"},
        {"@key": "passwd", "\$": "$PGPASSWORD"},
        {"@key": "dbtype", "\$": "postgis"},
        {"@key": "validate connections", "\$": "true"}
      ]
    }
  }
}
JSON
else
  log "Datastore $DATASTORE already exists"
fi

publish_featuretype() {
  local name="$1"
  local title="$2"
  if [ "$(http_status "$GS_URL/rest/workspaces/$WORKSPACE/datastores/$DATASTORE/featuretypes/$name.json")" != "200" ]; then
    log "Publishing featuretype $name"
    curl -sf -u "$AUTH" -X POST -H "Content-Type: application/json" \
      -d "{\"featureType\":{\"name\":\"$name\",\"nativeName\":\"$name\",\"title\":\"$title\",\"srs\":\"EPSG:4326\",\"enabled\":true}}" \
      "$GS_URL/rest/workspaces/$WORKSPACE/datastores/$DATASTORE/featuretypes"
  else
    log "Featuretype $name already published"
  fi
}

publish_featuretype "states" "US States"
publish_featuretype "test_features" "Editable scratch layer"
publish_featuretype "lock_features" "Lock-flow scratch layer"
publish_featuretype "test_features_3d" "3D editable scratch layer"

log "Granting anonymous write access to $WORKSPACE layers (default GeoServer ACL restricts writes to admin roles)"
# This endpoint's PUT only updates rules that already exist ("Unknown rules" 409 otherwise),
# and POST only creates new ones ("Already existing rules" 409 otherwise) - so pick the verb
# per rule based on whether it's already present.
grant_anonymous_write() {
  local layer="$1"
  local acl_json
  acl_json="$(curl -sf -u "$AUTH" "$GS_URL/rest/security/acl/layers.json")"
  local method=POST
  if echo "$acl_json" | grep -q "\"$WORKSPACE.$layer.w\""; then
    method=PUT
  fi
  curl -sf -u "$AUTH" -X "$method" -H "Content-Type: application/json" \
    -d "{\"$WORKSPACE.$layer.w\":\"*\"}" \
    "$GS_URL/rest/security/acl/layers"
}
grant_anonymous_write "states"
grant_anonymous_write "test_features"
grant_anonymous_write "lock_features"
grant_anonymous_write "test_features_3d"

log "Truncating scratch tables so they always start empty"
psql -c "TRUNCATE TABLE test_features RESTART IDENTITY;"
psql -c "TRUNCATE TABLE lock_features RESTART IDENTITY;"
psql -c "TRUNCATE TABLE test_features_3d RESTART IDENTITY;"

log "Bootstrap complete: $WORKSPACE:states, $WORKSPACE:test_features, $WORKSPACE:lock_features and $WORKSPACE:test_features_3d are ready as WFS-T layers."
