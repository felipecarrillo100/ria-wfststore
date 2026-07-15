# Known issues

Internal notes on defects that are understood and reproducible, but deliberately not fixed yet — kept here rather than in the README so they don't read as a warning to someone evaluating whether to use the library.

## GML axis-swap baseline is wrong specifically for a literal `CRS:84` reference

**Status**: confirmed, reproducible, fix designed, not yet applied. Deferred because it does not affect the library's primary use case (see "Real-world impact" below).

### Symptom

Encoding a feature whose reference is exactly `"CRS:84"` and decoding it back via RIA's own, real `GMLCodec.decode()` returns the X/Y coordinates swapped. This affects every geometry type this library encodes through `encodeGeometryToGML.ts` (`Point`, `LineString`, `Polygon`, `Circle`, `Arc`, ...) whenever the *original* reference identifier is the literal string `"CRS:84"`.

### Root cause

`src/libs/gml/gml32/encodeGeometryToGML.ts`'s `needsSwapAxis(geometry.srsName)` computes its default swap decision from `geometry.srsName` — by the time it runs, this has already been rewritten by `normalizeSrsName()` (in `src/libs/gml/gml32/normalizeGMLGeometry.ts`), which turns `"CRS:84"` into `"urn:ogc:def:crs:EPSG:4326"`. That urn has a *different native axis order* (lat,lon) in RIA's own reference database than `CRS:84` itself (lon,lat), even though the two are geometrically equivalent CRSs.

Meanwhile, RIA's own decode path (`GMLCodecImpl.js`, shipped in `@luciad/ria`) never looks at the document's declared `srsName` once a caller passes an explicit `reference` option to `.decode()` — which is virtually always. It bases its default swap decision purely on the *caller-requested* reference identifier (e.g. `"CRS:84"`). So encode (keyed off the rewritten identifier) and decode (keyed off the original one) disagree specifically when `normalizeSrsName` has actually rewritten something — today, only for `CRS:84`.

Confirmed empirically (isolated round-trip scripts, not just source-reading): a plain 2D `Point` round-tripped through `AdvancedGMLCodec.encode()` → `AdvancedGMLCodec.decode()` on `CRS:84` comes back swapped; the identical round-trip using `EPSG:4326` directly (no rewrite involved) is correct. The existing `swapAxes` option cannot work around this on its own — it's evaluated against opposite baselines on each side, so no single value makes both agree (algebraically, `true XOR isMember` can never equal `isMember`).

### Real-world impact

Verified against the real, running docker GeoServer test stack: a standard WFS 2.0.0 `GetCapabilities` response declares its default CRS as `"urn:ogc:def:crs:EPSG::4326"` (note the double colon — GeoServer's own convention), **never** the literal string `"CRS:84"` that `normalizeSrsName` rewrites. `WFSTFeatureStore`'s capabilities-driven reference resolution (`getReferenceForWFS`) therefore never produces `"CRS:84"` in the primary, real-world usage path.

This bug only triggers when:
- a caller explicitly sets `options.reference` to `getReference("CRS:84")` (an override, not the capabilities-derived default), or
- a WFS server's own capabilities response genuinely declares `"CRS:84"` as its default SRS (uncommon for WFS 2.0.0/GeoServer; more plausible for some OGC API - Features backends or older WFS 1.0/1.1 servers), or
- `AdvancedGMLCodec`/`GMLFeatureEncoder` are used standalone with a manually-constructed `CRS:84` reference (which is what this project's own test suite does in several places, for convenience, not because it's realistic).

### Fix, already designed, ready to apply

Reuse `EncodeGeometryToGMLOptions.nativeCrsSwapAxis` — it already exists for exactly this purpose (today only used to pass a resolved decision down into recursive `MultiGeometry`/`GeometryCollection` calls).

1. `src/libs/gml/gml32/encodeGeometryToGML.ts`: change `function needsSwapAxis` to `export function needsSwapAxis`. No other change needed.
2. `src/libs/gml/gml32/encodeFeatureToGML.ts`: add `nativeCrsSwapAxis?: boolean;` to `EncodeFeatureToGMLOptions` (purely additive — the function already spreads `...options` into its `encodeGeometryToGML` call).
3. `src/libs/GMLFeatureEncoder.ts`: at the top of `encodeFeature(feature)`, compute `needsSwapAxis(feature.shape.reference.identifier)` (the *original*, pre-normalization identifier) and pass it through as `nativeCrsSwapAxis`.
4. `src/libs/gml/gml32/AdvancedGMLCodec.ts`: same, in `encodeFeatureInto` and `encodeShape`, using `feature.shape.reference.identifier` / `shape.reference.identifier` respectively.

No public constructor option or method signature needs to change.

### Test that will need its expectation corrected when this is picked up

`src/libs/gml/gml32/AdvancedGMLCodec.test.ts`, `describe('AdvancedGMLCodec 3D support')` → `'encodeFeature(): 3D single-feature document carries srsDimension and Z'`. It currently asserts `expect(content).toContain('4 3 12')` for input `[3, 4, 12]` on the file's `CRS:84` reference — `'4 3 12'` is the swapped (buggy) value; after the fix it becomes `'3 4 12'`.
