# Changelog

## 0.1.1

Bug-fix release. No public method signatures or options change.

### Fixed

- **Property values are now XML-escaped in WFS-T requests.** Before, a value such as `A&B <b>x</b>` was parsed as XML: GeoServer stored `A&B`, and a crafted value could add elements to the transaction. `rid`, `typeName` and `lockId` are escaped too.
- **Lock editing no longer loses a geometry change.** In a `WFSTFeatureLockStore`, editing a feature's geometry and then its properties marked the pending edit as properties-only, so `commitLockTransaction` sent the new properties but not the new geometry. `putProperties()` now also keeps the working copy's current geometry, even if the feature passed in carries an older shape.
- **`add()`, `put()` and `putProperties()` no longer hang** when the feature type's `DescribeFeatureType` request fails (non-200 or network error). They now resolve `null`, like other failures. `loadFeatureDescription()` resolves `null` on a network error instead of never settling.
- **`queryByRids()` and `get()` work on stores created without a `codec`.** For example, `WFSTFeatureStore.createFromURL_WFST(url, typeName)` with no options. Before, both resolved `null` on such a store, and so did the Circle/Arc round-trip check after `add()`/`put()`. `queryByRids()` now runs on RIA's own `query()` with an id filter, so it decodes the same way RIA does for that store. It also no longer caps results at 500 features.
- **Lock ids are read correctly when the server uses another XML prefix.** `getFeatureWithLock()`/`lockFeatures()` now find the lock id when the response uses a prefix other than `wfs:`, or a default namespace.
- Minor fixes:
  - the `LockFeature` request's closing tag;
  - `GMLFeatureEncoder`'s `wrapToMultiSurface` default;
  - the `GMLGeometryTypeKey` type;
  - the separator used when merging `Accept` headers.

### Changed

- **`credentials: true` now sends cookies on cross-origin WFS-T requests.** It maps to fetch credentials `"include"`, the same mapping RIA uses for its own reads on the store (before: `"same-origin"`). `false` now maps to `"same-origin"` (before: `"omit"`). If you set `credentials: true` against a cross-origin server, that server must allow credentialed CORS requests. RIA's own reads already required this.

### Upgrade notes

- Locks saved in the browser's `localStorage` by an earlier version may already carry a wrong properties-only flag. This release can't repair them. Commit or cancel those locks and lock the features again.
