# ria-wfststore

A [LuciadRIA](https://dev.luciad.com/) `Store` implementation that adds real WFS-T (Web Feature
Service – Transactional) support — read, write, and collaborative locked editing — on top of
LuciadRIA's own, read-only `WFSFeatureStore`.

## Install

```
npm install ria-wfststore
```

Peer dependency: LuciadRIA `>=2024.1` (see [Requirements](#requirements)).

## Quick example

`WFSTFeatureStore` is a drop-in LuciadRIA `Store` — wire it up like any other, then edit the layer
through RIA's own edit controllers (see the LuciadRIA "Create and Edit" sample for that part):

```typescript
import { WFSTFeatureStore } from "ria-wfststore";
import { FeatureModel } from "@luciad/ria/model/feature/FeatureModel";
import { FeatureLayer } from "@luciad/ria/view/feature/FeatureLayer";

const store = await WFSTFeatureStore.createFromURL_WFST(url, typeName);
const model = new FeatureModel(store, { reference: store.getReference() });
const layer = new FeatureLayer(model, { label: "My WFS-T layer", editable: true });
```

That's enough to get add/update/delete working against any WFS-T service. Read on for
collaborative locked editing, GML/3D/Circle-Arc support, and everything else this library adds.

## Why choose ria-wfststore

- **A drop-in RIA `Store`.** Interchangeable with any other LuciadRIA `Store` — plug it into a
  `FeatureModel`/`FeatureLayer` and get `add`/`put`/`remove` for free, alongside the
  `query`/`queryByRids` it inherits from RIA's own `WFSFeatureStore`.
- **GML encode *and* decode, not just decode.** LuciadRIA's own `GMLCodec` can only decode GML —
  its `encode()` throws. This library's `AdvancedGMLCodec` adds a real encoder on top of it, so
  you can write GML-based WFS-T transactions without hand-rolling XML, in both GML 3.1.1 and 3.2.
- **Real 3D support, not a 2D-plus-Z afterthought.** Coordinates with a Z value are detected
  automatically and encoded correctly, with an explicit `mode3D` override when you need to force
  2D or 3D output regardless of the input. Verified against real-world 3D CRS edge cases, not just
  a happy path.
- **Encodes geometries GeoJSON can't represent.** `Circle` and `Arc` are encoded directly as
  `gml:CircleByCenterPoint`/`gml:ArcByCenterPoint` — RIA's own `GeoJsonCodec` throws outright on
  these shapes, so any GeoJSON-intermediate approach can't support them at all.
- **Schema-aware, not just "send and hope."** Every write is validated against the feature type's
  own `DescribeFeatureType` schema before it's sent — incompatible geometry types are rejected
  immediately, and incomplete properties trigger a callback instead of a malformed request.
- **A safety net against servers that lie about success.** Some WFS-T servers (confirmed against
  a real LuciadFusion deployment) accept a Circle/Arc write and report success, then silently
  degrade the geometry into something unreadable on the very next read. This library re-queries
  and verifies circular geometries round-trip correctly before reporting success back to you —
  opt-out via `verifyCircularGeometryRoundTrip: false` if you don't need it.
- **Built for collaborative, locked editing**, not just single-user CRUD — acquire a lock on a set
  of features, edit them locally without touching the server, and commit or discard the whole
  change set atomically. Locks persist across page reloads and expire automatically.
- **Automatic axis-order handling.** Whether a service's CRS declares lon/lat or lat/lon axis
  order, geometry is written in the order the server actually expects — no manual axis-swapping
  code in your application.
- **Handles secured services.** Custom request headers (Basic Auth, bearer tokens, etc.) flow
  through both capabilities discovery and every subsequent request, so WFS-T layers behind
  authentication work like any other.
- **Verified against a real server, not mocks.** The test suite runs against a real, disposable
  GeoServer + PostGIS stack (see [`docker/`](docker/README.md)), and every encoder capability is
  round-tripped through LuciadRIA's own real, unmocked `decode()` — not just checked structurally.
- **Fully documented public API.** Every exported class, method, and option carries TSDoc, so your
  IDE surfaces real guidance on hover — not just a type signature.

## Features

**Core WFS-T operations**
- Capabilities detection (`WFSCapabilitiesExtended.fromURL`) — inspect a service's `GetCapabilities`
  response and find out whether WFS-T is supported at all, and which operations are available.
- Full CRUD (`add`, `put`, `putProperties`, `remove`) on top of RIA's own `query`/`queryByRids`.
- Convenience factories (`createFromURL_WFST`/`createFromCapabilities_WFST`) that derive service
  URLs, output format, supported HTTP methods, and working CRS directly from capabilities.

**Geometry encoding**
- Real GML encode *and* decode via `AdvancedGMLCodec`, in GML 3.1.1 or 3.2.
- 2D and 3D geometry, auto-detected per feature or forced explicitly via `mode3D`.
- Direct `Circle`/`Arc` encoding as their proper GML curve segments.
- Schema-driven geometry wrapping (`GMLFeatureEncoder`) — a single geometry is automatically
  wrapped into the `Multi*` structure a feature type's schema declares, and GeoJSON-style type
  names are remapped to their GML schema equivalents (e.g. `MultiPolygon` → `MultiSurface`).

**Collaborative editing**
- `getFeatureWithLock`/`lockFeatures`/`commitLockTransaction` on `WFSTFeatureStore`.
- `WFSTFeatureLockStore` — a local, in-memory working copy that mirrors locked features so a user
  can edit them without touching the server until the whole change set is committed or discarded.
- `WFSTFeatureLocksStorage` — persists locks in `localStorage` (surviving page reloads), with
  search/pagination for listing active locks and an automatic background loop that expires and
  cleans up stale ones.

**Robustness**
- Schema-compatibility validation before every write.
- Circle/Arc round-trip verification after write, catching servers that silently degrade the
  geometry (opt-out available).
- Automatic axis-order (lon/lat vs lat/lon) handling per the target CRS.
- Secured WFS-T layers — custom request headers honored for capabilities discovery and every
  request.

**Extensibility**
- `WFSTDelegateScreenHelper` — a simple hook a host application extends to route store errors,
  warnings, and confirmations into its own UI instead of the console.

## More usage examples

### Check whether the service actually supports WFS-T

```typescript
import { WFSCapabilitiesExtended, WFSCapabilitiesExtendedResult } from "ria-wfststore";

WFSCapabilitiesExtended.fromURL(url, options).then(({ wfsCapabilities, wfstCapabilities }: WFSCapabilitiesExtendedResult) => {
    const wfstCapable = wfstCapabilities.WFSTCapable;
    const wfstOperations = wfstCapabilities.WFSTOperations;
}).catch((err) => {
    console.error("Failed to fetch WFS capabilities:", err);
});
```

### Collaborative, lock-based editing

Use `WFSTFeatureLockStore` when several users might edit the same features concurrently, and you
want edits to happen locally until the whole change set is explicitly committed:

```typescript
import { WFSTFeatureLockStore } from "ria-wfststore";

// Acquire a lock on the features you want to edit
const lockItem = await store.getFeatureWithLock({ rids: ["feature.1", "feature.2"], expiry: 10 });

// Build a local editing store from it - edits happen here, not on the server, until committed
const lockStore = new WFSTFeatureLockStore(lockItem);
const model = new FeatureModel(lockStore, { reference: lockStore.getReference() });
const layer = new FeatureLayer(model, { label: "My locked WFS-T layer", editable: true });

// ... user edits the layer through RIA's edit controllers as usual ...

// When done, commit (or simply discard lockItem/lockStore to abandon) the whole change set
const result = await store.commitLockTransaction(lockItem);
```

## Demo applications

Three reference React + Vite applications exercise the library end to end against a real WFS-T
service, all sharing the same UI (connecting to a service and inspecting its capabilities,
browsing/managing layers, drawing and editing features with a context menu, editing properties
through a form, and the full lock-based collaborative editing flow — listing available locks,
editing a held lock's features, and committing or cancelling the change set) while each wires the
store differently:

- [`demo/`](demo/) — the baseline app, using RIA's own `GeoJsonCodec` (JSON output).
- [`demo-gml/`](demo-gml/) — the same app wired to `AdvancedGMLCodec` (GML output), showcasing full
  GML round-tripping and native `Circle`/`Arc`/curve geometry that JSON can't represent.
- [`demo-3d/`](demo-3d/) — the same app wired for 3D geometry editing.

To run a demo:
```
cd demo
npm install
npm run dev
```
(substitute `demo-gml` or `demo-3d` for the other variants)

## Development

### Build

This is the source that produces the published npm package:
```
npm install
npm run build
```
Then publish the package to npm or another registry.

### Test

Tests run with vitest, against a real WFS-T server. A disposable local one (PostGIS + GeoServer)
is provided under [`docker/`](docker/README.md) — start it, then run the suite:
```
docker compose -f docker/docker-compose.yml up -d
npm run test
```
See [docker/README.md](docker/README.md) for details on the local server (layers, credentials,
resetting state). No browser test is available at the moment.

### Typecheck

```
npm run typecheck
```

## Requirements

- LuciadRIA `2024.1` or higher (place it on a local npm repository, e.g. Verdaccio, if it isn't
  published publicly).
- An ES6 or TypeScript-capable transpiler.

## License

ISC
