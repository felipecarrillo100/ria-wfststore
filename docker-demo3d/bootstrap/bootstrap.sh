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

publish_featuretype "edit3d_features" "ria-3d-shape-editor persistent demo layer"

log "Granting anonymous write access to $WORKSPACE layers (default GeoServer ACL restricts writes to admin roles)"
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
grant_anonymous_write "edit3d_features"

# Deliberately NO truncate step here, unlike docker/bootstrap/bootstrap.sh - this stack is meant
# to persist real edited data across restarts while running the demo, not reset on every startup.

log "Bootstrap complete: $WORKSPACE:edit3d_features is ready as a persistent WFS-T layer."
