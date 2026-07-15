# ria-wfststore

A [LuciadRIA](https://dev.luciad.com/) `Store` implementation that adds real WFS-T (Web Feature Service - Transactional) support — read, write, and collaborative locked editing — on top of LuciadRIA's own, read-only `WFSFeatureStore`.

## Why use this library

- **A drop-in RIA `Store`.** `WFSTFeatureStore` is interchangeable with any other LuciadRIA `Store` — plug it into a `FeatureModel`/`FeatureLayer` like you would any other data source, and get add/update/delete for free.
- **GML encode *and* decode, not just decode.** LuciadRIA's own `GMLCodec` can only decode GML — its `encode()` method throws. This library's `AdvancedGMLCodec` adds a real encoder on top of it, so you can write GML-based WFS-T transactions without hand-rolling XML.
- **Real 3D support.** Coordinates with a Z value are detected automatically and encoded correctly, with an explicit override (`mode3D`) when you need to force 2D or 3D output regardless of the input.
- **Encodes geometries GeoJSON can't represent.** `Circle` and `Arc` are encoded directly as `gml:CircleByCenterPoint`/`gml:ArcByCenterPoint` — RIA's own `GeoJsonCodec` throws outright on these shapes, so a GeoJSON-intermediate approach can't support them at all.
- **Built for collaborative, locked editing**, not just single-user CRUD — acquire a lock on a feature, edit it locally without touching the server, and commit or cancel the whole change set atomically.
- **Handles secured services.** Custom request headers (Basic Auth, bearer tokens, etc.) flow through both capabilities discovery and every subsequent request, so WFS-T layers behind authentication work like any other.
- **Verified against a real server, not mocks.** The test suite runs against a real, disposable GeoServer + PostGIS stack (see [`docker/`](docker/README.md)), and every encoder capability is round-tripped through LuciadRIA's own real, unmocked `decode()` — not just checked structurally.

## What it provides

- **Capabilities detection** — `WFSCapabilitiesExtended.fromURL(...)` inspects a service's `GetCapabilities` response and tells you whether WFS-T is actually supported, and which operations are available.
- **Full CRUD** — `WFSTFeatureStore` provides `add`, `put`, `putProperties`, and `remove`, on top of the `query`/`queryByRids` it inherits from LuciadRIA's `WFSFeatureStore`.
- **Collaborative, lock-based editing** — `getFeatureWithLock`/`lockFeatures`/`commitLockTransaction` on `WFSTFeatureStore`, paired with `WFSTFeatureLockStore` (a local, in-memory store that mirrors the locked features so a user can edit them without touching the server until the whole change set is committed or cancelled) and `WFSTFeatureLocksStorage` (persists, lists, and expires held locks).
- **Real GML encode and decode** — `AdvancedGMLCodec` extends LuciadRIA's own `GMLCodec`, inheriting its decoder as-is and adding a genuine encoder, supporting both GML 3.1.1 and GML 3.2 output.
- **2D and 3D geometry support** — auto-detected per feature, or forced explicitly.
- **Direct `Circle`/`Arc` encoding** — geometries outside what the GeoJSON-intermediate encoding path can represent.
- **Secured WFS-T layers** — custom request headers (e.g. HTTP Basic Auth) are honored for both capabilities discovery and every read/write request.
- **Pluggable error/message handling** — `WFSTDelegateScreenHelper` is a simple hook a host application can extend to route store errors, warnings, and confirmations into its own UI instead of the console.

## Demo applications

Two reference React + Vite applications under [`demo/`](demo/) and [`demo-oldria/`](demo-oldria/) exercise the library end to end against a real WFS-T service:

- Connecting to a WFS-T service and inspecting its capabilities (`WFSConnectForm`).
- Browsing and managing layers on the map (`MapLayersComponent`).
- Drawing and editing features directly on the map, with a context menu for feature-level actions.
- Editing feature properties through a form (`EditFeaturePropertiesForm`).
- The complete lock-based collaborative editing flow: listing available locks (`ListAvailableWFSTFeatureLocksForm`), editing a held lock's features (`EditCurrentLockForm`/`EditWFSTFeaturesWithLockForm`), and committing or cancelling the change set.

`demo/` tracks the current LuciadRIA version; `demo-oldria/` is the same application pinned against an older LuciadRIA release, used to verify backward compatibility across versions.

To run a demo:
```
cd demo
npm install
npm run dev
```

## To build

This is the source code that produces a library delivered as an npm package. To build it:
```
npm install
npm run build
```
Then you can publish the package to npm or another repository.

## To test

Tests run using vitest, against a real WFS-T server. A disposable local one (PostGIS + GeoServer) is provided under [`docker/`](docker/README.md) — start it with `docker compose -f docker/docker-compose.yml up -d`, then run:
```
npm run test
```
See [docker/README.md](docker/README.md) for details on the local server (layers, credentials, resetting state). No browser test is available at the moment.

## To install in your project

```
npm install ria-wfststore
```

## To use in your project

`WFSTFeatureStore` works as any other LuciadRIA `Store` that supports read/write, so it's interchangeable with other stores — use it together with `FeatureModel` and `FeatureLayer`.

### Querying service capabilities

Start by checking whether the server actually supports WFS-T:

```typescript
WFSCapabilitiesExtended.fromURL(request, options).then(({wfsCapabilities, wfstCapabilities}: WFSCapabilitiesExtendedResult) => {
    const wfstCapable = wfstCapabilities.WFSTCapable;
    const wfstOperations = wfstCapabilities.WFSTOperations;
}).catch((err) => {
    handleHTTPErrors.handleError(err);
});
```

### Creating a simple WFS-T store

Use `WFSTFeatureStore` with `FeatureModel`/`FeatureLayer`, and wire it to LuciadRIA's edit controllers (see the LuciadRIA "Create and Edit" sample for that part):

```typescript
const store = await WFSTFeatureStore.createFromURL_WFST(url, typeName);
const model = new FeatureModel(store, {reference: store.getReference()});
const layer = new FeatureLayer(model, {label: "My WFS-T layer", editable: true});
```

### Creating a lock-based editing store

Use `WFSTFeatureLockStore` when you need collaborative, lock-protected editing instead of direct writes:

```typescript
const store = new WFSTFeatureLockStore({...options, serviceURL: "your-url"});
const model = new FeatureModel(store, {reference: store.getReference()});
const layer = new FeatureLayer(model, {label: "My locked WFS-T layer", editable: true});
```

## Requirements

- LuciadRIA 2024.1 or higher (place it on a local npm repository, e.g. Verdaccio, if it isn't published publicly).
- An ES6 or TypeScript-capable transpiler.
