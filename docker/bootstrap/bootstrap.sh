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

# GeoServer's global numDecimals defaults to 4 - fine for coarse WMS previews, but a real
# disaster for small, real-world-scale WFS-T features: at this latitude 4 decimal degrees is
# ~10m of rounding error, easily larger than a building-sized shape, independently per vertex -
# enough to visibly distort a small polygon/line on every read-back despite the geometry being
# stored at full precision. Confirmed against the docker-demo3d stack: this exact setting was
# the root cause of a live "committed shape looks different after reload" bug. Raised globally
# here so every fresh reset of this disposable stack starts with it fixed, not just the one
# persistent stack where it was first found.
#
# Fetch-modify-PUT-back the *whole* settings document (via jq), not a partial one: a partial
# PUT here (confirmed the hard way) silently drops fields the response body didn't mention -
# including `charset`, whose absence makes GeoServer's own GetCapabilities throw
# "IllegalArgumentException: Null charset name" and take the whole WFS service down.
log "Raising GeoServer's global numDecimals (default 4) to avoid visible coordinate rounding on small features"
current_settings="$(curl -sf -u "$AUTH" "$GS_URL/rest/settings.json")"
updated_settings="$(echo "$current_settings" | jq '.global.settings.numDecimals = 9')"
curl -sf -u "$AUTH" -X PUT -H "Content-Type: application/json" \
  -d "$updated_settings" \
  "$GS_URL/rest/settings"

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

SECURED_WORKSPACE="wfst_secured"
SECURED_DATASTORE="geodata_secured"
SECURED_ROLE="WFST_SECURED_ROLE"
SECURED_USER="wfst_secured_user"
SECURED_PASSWORD="wfst_secured_pass"

log "Setting up password-protected workspace $SECURED_WORKSPACE (see docker/README.md)"

if [ "$(http_status "$GS_URL/rest/workspaces/$SECURED_WORKSPACE.json")" != "200" ]; then
  log "Creating workspace $SECURED_WORKSPACE"
  curl -sf -u "$AUTH" -X POST -H "Content-Type: application/json" \
    -d "{\"workspace\":{\"name\":\"$SECURED_WORKSPACE\"}}" \
    "$GS_URL/rest/workspaces"
else
  log "Workspace $SECURED_WORKSPACE already exists"
fi

if [ "$(http_status "$GS_URL/rest/workspaces/$SECURED_WORKSPACE/datastores/$SECURED_DATASTORE.json")" != "200" ]; then
  log "Creating datastore $SECURED_DATASTORE (same $PGDATABASE database as $DATASTORE)"
  curl -sf -u "$AUTH" -X POST -H "Content-Type: application/json" -d @- \
    "$GS_URL/rest/workspaces/$SECURED_WORKSPACE/datastores" <<JSON
{
  "dataStore": {
    "name": "$SECURED_DATASTORE",
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
  log "Datastore $SECURED_DATASTORE already exists"
fi

if [ "$(http_status "$GS_URL/rest/workspaces/$SECURED_WORKSPACE/datastores/$SECURED_DATASTORE/featuretypes/secured_features.json")" != "200" ]; then
  log "Publishing featuretype secured_features"
  curl -sf -u "$AUTH" -X POST -H "Content-Type: application/json" \
    -d "{\"featureType\":{\"name\":\"secured_features\",\"nativeName\":\"secured_features\",\"title\":\"Password-protected scratch layer\",\"srs\":\"EPSG:4326\",\"enabled\":true}}" \
    "$GS_URL/rest/workspaces/$SECURED_WORKSPACE/datastores/$SECURED_DATASTORE/featuretypes"
else
  log "Featuretype secured_features already published"
fi

if curl -sf -u "$AUTH" "$GS_URL/rest/security/roles.json" | grep -q "\"$SECURED_ROLE\""; then
  log "Role $SECURED_ROLE already exists"
else
  log "Creating role $SECURED_ROLE"
  curl -sf -u "$AUTH" -X POST "$GS_URL/rest/security/roles/role/$SECURED_ROLE"
fi

if curl -sf -u "$AUTH" "$GS_URL/rest/security/usergroup/users.json" | grep -q "\"userName\":\"$SECURED_USER\""; then
  log "User $SECURED_USER already exists"
else
  log "Creating user $SECURED_USER"
  curl -sf -u "$AUTH" -X POST -H "Content-Type: application/json" \
    -d "{\"user\":{\"userName\":\"$SECURED_USER\",\"password\":\"$SECURED_PASSWORD\",\"enabled\":true}}" \
    "$GS_URL/rest/security/usergroup/users"
fi

if curl -sf -u "$AUTH" "$GS_URL/rest/security/roles/user/$SECURED_USER.json" | grep -q "\"$SECURED_ROLE\""; then
  log "Role $SECURED_ROLE already associated with $SECURED_USER"
else
  log "Associating role $SECURED_ROLE with user $SECURED_USER"
  curl -sf -u "$AUTH" -X POST "$GS_URL/rest/security/roles/role/$SECURED_ROLE/user/$SECURED_USER"
fi

log "Restricting $SECURED_WORKSPACE.secured_features to role $SECURED_ROLE (read + write) - this workspace is kept entirely separate from $WORKSPACE so this ACL rule can never affect the anonymous-access layers above"
set_secured_acl_rule() {
  local mode="$1" # r or w
  local acl_json
  acl_json="$(curl -sf -u "$AUTH" "$GS_URL/rest/security/acl/layers.json")"
  local method=POST
  if echo "$acl_json" | grep -q "\"$SECURED_WORKSPACE.secured_features.$mode\""; then
    method=PUT
  fi
  curl -sf -u "$AUTH" -X "$method" -H "Content-Type: application/json" \
    -d "{\"$SECURED_WORKSPACE.secured_features.$mode\":\"$SECURED_ROLE\"}" \
    "$GS_URL/rest/security/acl/layers"
}
set_secured_acl_rule "r"
set_secured_acl_rule "w"

log "Truncating scratch tables so they always start empty"
psql -c "TRUNCATE TABLE test_features RESTART IDENTITY;"
psql -c "TRUNCATE TABLE lock_features RESTART IDENTITY;"
psql -c "TRUNCATE TABLE test_features_3d RESTART IDENTITY;"
psql -c "TRUNCATE TABLE secured_features RESTART IDENTITY;"

log "Bootstrap complete: $WORKSPACE:states, $WORKSPACE:test_features, $WORKSPACE:lock_features, $WORKSPACE:test_features_3d and $SECURED_WORKSPACE:secured_features (password-protected) are ready as WFS-T layers."
