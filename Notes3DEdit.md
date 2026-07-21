# Notes: LuciadRIA 3D editing patterns (from the SDK toolbox)

Investigative notes only — this is a survey of how Luciad's own toolbox implements 3D
create/edit interactions, for learning purposes. None of this is a spec for what we build;
it's the vocabulary and the proven patterns to draw from later.

SDK root: `/Users/felipe.carrillo.romero/luciad/LuciadRIA_2026.0.10/toolbox/ria/`

## Where things live

- `tour/` — camera path tool (the example the user pointed at): record camera positions while
  navigating, build a path from them, edit path points (position + orientation), animate/play back.
- `slicing/` — oriented-box editing (create/select/move/resize a 3D box, used for slicing/clipping).
- `controller/handle/` — the **generic**, reusable handle + interaction primitives underneath both
  of the above. This is the most broadly relevant material.
- `controller/` (top level) — camera navigation controllers (orbit, look-from pan/zoom), not
  directly relevant to shape editing.
- `annotation/` — label and measurement annotations, its own controller/painter/support triad.
- `crosssection/`, `ruler3d/`, `magnifier/`, `infinite-grid/` — not yet explored; likely more
  camera/visualization tools than shape-editing ones, given their names. Worth a look later if we
  need cross-section or measurement-style interactions.
- `samples/ria/icons3d/` — 3D icon sample (not yet read in detail; the rotation limitation below
  was found via a code comment in `slicing/`, not this sample directly).

## The core architectural pattern (seen consistently across tour/ and slicing/)

Three cleanly separated layers, every time:

1. **A "Support" class** (`TourPathSupport`, `OrientedBoxEditingSupport`) — pure domain logic and
   state for the *shape being edited*. Knows nothing about mouse events. Exposes intention-revealing
   mutation methods (`setXInterval`, `translate`, `rotateAroundZ`, `setPathKeyframes`) and emits a
   change event (e.g. `BOX_CHANGED_EVENT`) whenever the underlying shape is recalculated. Controllers
   and UI both just listen to this event to stay in sync — neither has to know about the other.

2. **One or more small, single-responsibility Controllers** — never one monolithic edit controller.
   `slicing/` splits into `BoxCreateController`, `BoxSelectController`, `BoxMoveController`,
   `BoxResizeController` — each owns exactly one interaction concern, all sharing the same `Support`
   instance. `tour/`'s `PathController` is a `CompositeController` that composes
   `PathFrustumController` + `PlayStopController` + `PathPointSelectionController` +
   `PathEditController` together, each independently activatable/deactivatable.

3. **`ControllerHandle<T>`** (`controller/handle/ControllerHandle.ts`) — a small, generic container
   used *inside* a controller, one per interactive handle. Holds: `focused` (bool), `defaultShape`/
   `focusedShape` (different visuals for idle vs. active), `interactsWithMouseFunction` (hit test,
   `(viewPoint) => boolean`), `interactionFunction` (the actual per-frame drag response, created
   lazily on first drag frame, cleared on `endInteraction()`). Meant to be subclassed when a handle
   needs extra state (`BoxResizeHandle extends ControllerHandle<Vector3>` adds `resizingFaceId`,
   `validInterval`).

**The gesture-handling shape is the same everywhere**: `onGestureEvent` branches on
`GestureEventType.MOVE` (hover → update `focused` via the hit-test function, no mutation) →
`DRAG` (if focused: lazily build `interactionFunction` via a factory, call it, apply the result) →
`DRAG_END` (call `endInteraction()`, emit a "data changed" event for anything listening). Return
`HandleEventResult.EVENT_HANDLED` to consume the event, `EVENT_IGNORED` to let it pass through
(relevant when composed inside a `CompositeController`).

## The interaction-factory functions — the most directly reusable part

`controller/handle/ControllerHandleInteractionFactory.ts` — generic (not tour- or box-specific),
each returns a closure valid for one drag gesture's lifetime:

- **`horizontalMovePointInteraction(map, viewPoint, modelPoint, {fixedHeight, restrictionFunction})`**
  — moves a point in X/Y only, height fixed or terrain-following. Works on any map reference (no
  3D-only guard). This is the "base handle" mechanism.
- **`verticalMovePointInteraction(map, viewPoint, modelPoint)`** — moves a point in height only.
  **Explicitly disabled on non-3D maps**: `if (!map.reference.equals(EPSG_4978)) return () => modelPoint;`
  — i.e. Luciad's own engineers hit the exact wall we discussed (no coherent "up" direction in a flat
  2D view) and just turned the feature off rather than working around it. Strong precedent: **height
  dragging should probably require/detect a 3D (perspective, EPSG:4978) map view in our own design
  too**, with a numeric-only fallback for 2D, rather than inventing a 2D-compatible gesture.
- **`planarMovePointInteraction(map, viewPoint, originalPoint, planeNormal)`** /
  **`linearMovePointInteraction(map, viewPoint, originalPoint, lineVector)`** — the general (non-
  camera-specific) versions of "drag on a plane" / "drag along a line". Both throw if
  `map.reference` isn't `EPSG:4978`. Both work by: cast a ray from the camera through the current
  mouse position (`calculatePointingDirection`), intersect it with a plane anchored at the point
  (`rayPlaneIntersection`), then either use the intersection directly (planar) or project it onto the
  line (`projectPointOnLine` / `distanceAlongDirection`, linear). This ray-plane-intersection technique
  is the core mechanism underneath *every* drag interaction in this toolbox.
- **`directionalMovePointInteraction(map, startWorldPoint, worldDirection)`** — a variant used for
  box-face resizing; computes its own pointing plane from the camera's right vector rather than
  taking one as a parameter.
- **Hit-test companions**: `closeToPointCheck`, `closeToHorizontalPointCheck`,
  `closeToVerticalLineCheck` (project a 3D line segment to screen space, check pixel distance,
  optionally clamped to the segment — this is the generic version of what `PathEditController`
  wrote inline for its altitude handle), `horizontalMouseRotateCheck`, `inHorizontalPolygonCheck`.
- **`limitHorizontalMoveToBounds(bounds)`** — a ready-made `restrictionFunction` for
  `horizontalMovePointInteraction`, clamps to a bounding box.

Underlying vector math (`@luciad/ria-toolbox-core/util/Vector3Util.js`, generic, no dependency on
any of the above): `add`, `sub`, `scale`, `cross`, `normalize`, `distance`,
`distanceAlongDirection`, `projectPointOnLine`, `rayPlaneIntersection`, `rayRectangleIntersection`,
`length`, `angle`/`absoluteAngle`, `rotateAroundAxis`, `rotatePointAroundLine`, `toPoint`. Worth
knowing this exists rather than re-deriving vector math ourselves.
`calculatePointingDirection(map, viewPoint)` (`PerspectiveCameraUtil.js`) is the "unproject a mouse
click into a 3D ray direction" primitive everything else is built on.

## Tour/camera-path specifics (the example the user pointed at)

- Path points are stored as raw `Vector3` (x/y/z), always in **`EPSG:4978`** (geocentric Cartesian)
  — the README states this tool *only* supports that reference. Likely reason: splining/interpolating
  smoothly in Cartesian XYZ is far simpler and better-behaved than in geodetic lat/lon/height, where
  "height" and horizontal position have different units and great-circle vs. straight-line
  interpolation matters.
- Two-tier model: a sparse list of user-editable **keyframes** (`PathPointFeature`, one per
  recorded camera position) + a dense, regenerated-on-change **trajectory** (`Polyline`, purely for
  rendering, via `Curve.getPoints(divisions)`). Editing only ever touches the sparse keyframes;
  `invalidateTrajectory()` regenerates the dense visual line afterward. Directly transferable pattern
  if we ever want smooth (not polyline-straight) curved paths with editable control points.
- `Curve` (abstract) / `CatmullRomCurve` (concrete): clean split between parameter `t` (proportional
  along control-point index, uneven spacing) and `u` (arc-length-normalized, even spacing) —
  `getPoint(t)` vs `getPointAt(u)`. Arc lengths are cached and invalidated explicitly
  (`updateArcLengths()`) rather than recomputed every call.
- Each path point tracks **three** parallel vectors (eye/position, forward, up) — three independent
  `CatmullRomCurve` splines, one per vector — because it's modeling a camera, not just a position.
  We don't need this multiplicity for plain vertex editing, but the "one spline per independently-
  varying vector property" structure is a clean pattern if we ever need it (e.g. per-vertex normal).
- `PathEditController` has **two edit modes** (`EditMode.POSITION`, `EditMode.ORIENTATION`) with
  totally different interaction schemes for the same point — position uses the Move/Altitude handle
  pair described above; orientation uses free mouse-drag camera rotation, no discrete handles at
  all. Editing "different aspects of the same thing" via distinct modes, not one overloaded gesture.
- The altitude handle's *visual* is a `Polyline` from 100m below the point to 50m above (both fixed
  offsets along the local "up" = `normalize(pointVector)`, since in EPSG:4978 "up" varies by
  location on the globe, it's not a fixed axis) — a literal implementation of the "vertical line
  appears" idea from our own brainstorm, already built and shipping.
- **The "capture current camera as a new point" mechanism, confirmed precisely** (sample code,
  `samples/common/ui/tour/hooks/useTourPath.ts`, function `addPathPoint`):
  ```ts
  const { eye, forward, up } = tourSupport.map.camera;
  tourSupport.addPathKeyframe({ eye, forward, up, tension, id }, editPointIndex ?? undefined);
  ```
  It's exactly as simple as it sounds — read `map.camera`'s current vectors directly, build a
  keyframe object, hand it to the Support's `addPathKeyframe(keyframe, index?)` (append, or insert
  at a given index if editing mid-path). No actual image/screenshot capture at this layer — that's a
  separate concern (`recorder/` toolbox module + `TourRecorderSupport`, for recording a *video* of
  tour playback, unrelated to adding a path point). The user's "take a screenshot" phrasing was a
  loose description of "capture the current camera state," not a literal image file.

## Oriented-box (slicing/) specifics

- Box is decomposed into: one **origin** (corner 7) + 3 **direction unit vectors** (X/Y/Z edges from
  that origin) + 3 **intervals** (min/max distance along each direction). Resizing one face just
  changes one interval's min or max; the box is fully recalculated (`recalculateBox()`) from these
  primitives on every change, then re-emitted via `BOX_CHANGED_EVENT`.
- `BoxResizeController` hit-tests against the box's 6 face polygons via ray-rectangle intersection
  (`rayRectangleIntersection`) to find which face is under the cursor, then resizes along that face's
  own normal via `directionalMovePointInteraction`, clamped to a valid interval so you can't drag a
  face past its opposite one (`MINIMAL_INTERVAL_WIDTH`/`MAX_INTERVAL_WIDTH` guards).
- **Icon rotation limitation (the one the user specifically flagged)**, found as a code comment:
  *"icon rotation only works correctly in 90° increments (otherwise it depends on which angle you're
  looking from)"* — `IconStyle.rotation` is a 2D/screen-space rotation, and there is no single
  camera-independent screen angle for an arbitrary 3D direction — it only becomes well-defined at
  90°-snapped increments. Real, hard-won constraint: if we ever want a directional/rotated icon to
  visually indicate a 3D direction, this is a documented ceiling on how precisely that can look,
  not a bug to work around.

## Multi-step click-sequence creation (BoxCreateController)

A distinct, complete pattern worth knowing separately from the edit-handle material above: creating
an `OrientedBox` is a **4-click finite state machine** (`CreationState.IDLE` →
`CORNER_DEFINED` → `WIDTH_DEFINED` → `PLANE_DEFINED` → done), not a single click-drag-release:

1. Click 1: place the first corner (`updateCorner`, via `LocationMode.CLOSEST_SURFACE` — snaps to
   whatever surface/terrain is under the cursor).
2. Click 2: define width + horizontal orientation (mouse moves along a ray-plane intersection
   anchored at corner 1; distance = width, direction = orientation).
3. Click 3: define depth (perpendicular to the orientation from step 2, same ray-plane technique).
4. Click 4: define height — **normal case**: height extrudes one-sided (up from the plane defined
   so far); **with Shift held**: the same click instead defines a half-height, and the box is
   extruded symmetrically both above and below the plane. A single modifier key changing the
   *meaning* of the last click, not a separate mode.

Each intermediate stage has its own `onDraw` preview (a point, then a line, then a semi-transparent
plane, then the full box with `withOccludedPart: true` so you can see through terrain/other
geometry while placing it) — the shape being actively constructed is always visible, one step
ahead of what's committed. `onActivate` throws immediately if the map isn't in `EPSG:4978` — same
3D-only guard as the edit-side interactions.

Relevant if our own vertex-height creation ever wants a guided multi-click flow (e.g. click for
X/Y, a distinct second phase to set height) rather than a single continuous drag — this is a
complete, working reference for how to structure that as an explicit state machine with live
preview at each step, plus how a modifier key can cheaply add a second behavior to the same click
without a separate mode/button.

## ruler3d/ — sequential click-to-place measurement, and a genuinely new idea: 3-point plane definition

Read in full at the user's request (the one module out of the "not yet explored" list judged
actually relevant). Distinctly different interaction style from tour/ and slicing/, and directly
answers something we'd only speculated about earlier: how would a user establish an arbitrary
tilted plane by hand, rather than us hardcoding one?

### The controller: click-to-place, not drag-a-handle

`Ruler3DController` builds up a `Measurement` (distance or area) by **sequential clicks**, not
dragging:
- `SINGLE_CLICK_UP` → add a new point (or finish, if `maxSegments` reached).
- `MOVE` → live-updates the position of the *last, not-yet-committed* point — a "rubber band"
  preview of where the next click would land, before it's confirmed.
- `DOUBLE_CLICK` → removes the extra point the first click of the double-click created, then
  finishes the measurement.
- `startOnMove` option: if true, the very first point is placed by hovering, no initial click
  needed.
- `minSegments`/`maxSegments` bound how many points a given measurement accepts (e.g. a fixed
  2-point distance vs. an open-ended area polygon).

This is a cleanly different creation paradigm from `BoxCreateController`'s state machine or the
tour path's drag handles — worth having as a third distinct pattern in mind, not just the two from
before.

### The genuinely new idea: `MeasurementProjector` — a swappable "2D click → 3D point" strategy

The controller doesn't hardcode how a screen click becomes a model point — it takes an *optional,
injectable* `projector: MeasurementProjector`:
```ts
interface MeasurementProjector {
  readonly ready: boolean;
  handleEventForInitialization(gestureEvent): HandleEventResult;  // runs BEFORE normal click/move handling, until ready
  project(viewPoint): Point | null;                                 // used INSTEAD of the default terrain raycast, once ready
  paintProjection(geoCanvas): void;
}
```
Without a projector, clicks just raycast onto `LocationMode.CLOSEST_SURFACE` (whatever's under the
cursor). *With* one, the projector gets first refusal on every gesture event until it reports
`ready`, then takes over point placement entirely. This split (`handleEventForInitialization` vs.
`project`) is exactly how the controller supports a **multi-step setup phase before the "real"
interaction starts** — worth remembering as a general pattern, not just for planes.

**`ThreePointProjector` (abstract)** is the concrete use of this: the user clicks **3 points** on
whatever surface is visible; `buildPlane()` computes a `planeCenter` (centroid) and `planeNormal`
(cross product of two edge vectors) from them — i.e. **the user defines an arbitrary plane, at any
tilt, just by clicking three points on visible geometry**, no numeric angle entry at all. While
placing points 1–3, a live-updating cross-icon marks each point, and once all 3 exist, a real 3D
plane mesh (`drawIcon3D`, oriented/scaled from the computed normal via `Icon3DStyle`) is drawn as a
continuously-updating preview *before* the plane is finalized (mouse-move keeps re-running
`buildPlane()` until the user is satisfied and stops adjusting).

Once ready, two interchangeable subclasses answer "given a *new* click near the plane, where
exactly on the plane does it map to":
- **`ThreePointOrthogonalProjector`**: raycasts the click onto the terrain/surface first (same
  `LocationMode.CLOSEST_SURFACE` as the default), then **orthogonally projects** that ground point
  onto the plane (`projectPointOnPlane`). Draws a literal helper line connecting the true ground
  point to its projection, so the user can see the "flattening" happening.
- **`ThreePointRaycastedProjector`**: skips the terrain step entirely — intersects the click's
  camera-eye line-of-sight *directly* with the plane (`rayPlaneIntersection(camera.eye,
  pointingDirection, planeNormal, planeCenter)`, the exact same primitive already noted under
  `ControllerHandleInteractionFactory` above).

These give **meaningfully different results** whenever the camera isn't looking straight down —
one answers "where does my click's sightline hit the plane," the other answers "where does the
ground under my click sit once flattened onto the plane." Two valid, different answers to "put this
click on the plane," implemented as two swappable strategies behind one interface — a genuinely
useful design idea to borrow directly: don't hardcode one screen-click-to-3D-point policy, make it
pluggable, the same way this module does.

**Direct link back to our own earlier discussion**: this is a complete, working, user-driven answer
to "how would someone actually establish a tilted plane" — the exact scenario behind the tilted-
plane `Polygon` test you had me build a few tasks ago. If we ever want an *interactive* way to let a
user define a non-horizontal plane (rather than us constructing one programmatically in a test),
this is the reference implementation to start from.

## annotation/ — placing markers on any surface, including walls, and a reusable generic Support base class

Read at the user's request, specifically to answer: does LuciadRIA's annotation tooling support
placing an annotation on a vertical surface (a wall), not just flat ground/terrain?

### Short answer: yes, already, with zero special-casing

`LabelAnnotationController` places a point exactly the same way `BoxCreateController`'s first click
does: `LocationMode.CLOSEST_SURFACE`, the same raycast mechanism already confirmed (via `slicing/`
and `ruler3d/`) to snap to *whatever* surface is nearest — terrain **or** mesh geometry like a
building wall — not a terrain-only mode despite what its name might suggest in isolation. A click on
a wall just returns a 3D point sitting exactly on that wall's face. There's no separate "attach to
face/mesh ID" concept anywhere in this module — an annotation is stored as an ordinary `Feature<Point>`
with plain X/Y/Z, nothing more. That's sufficient because the use case is a *static* building/mesh
model: the wall isn't moving, so a plain captured point never needs to be re-anchored. (This would
stop being sufficient the moment a model itself can move/deform — not a case this module handles or
needs to, and not a case we have either, so no gap for us here.)

### `AnnotationSupport<A, F, C, T, U>` — a genuinely different Support pattern: an abstract, reusable base class

Unlike `TourPathSupport`/`OrientedBoxEditingSupport` (concrete, one-off), `AnnotationSupport` is
**abstract and generic**, meant to be subclassed once per *kind* of annotation
(`LabelAnnotationSupport` for point/label markers; presumably `MeasurementAnnotationSupport` for
distance/area annotations, not yet read). It factors out everything that's the same across kinds:
- A `MemoryStore`-backed `FeatureLayer` (creation delegated to an abstract `createLayer()` hook, so
  subclasses can still pick their own painter/selectable/hoverable settings).
- Hover/selection sync via `map.on("HoverChanged"/"SelectionChanged")` — kept in the Support, not
  duplicated per controller.
- A **declarative, diffing** `updateAnnotations(annotations, hoveredIds, selectedIds)` method: the
  caller passes the *full desired list* every time (virtual-DOM-style), and the Support reconciles
  the map to match — add what's missing, update what changed, remove what's gone. One-way data flow
  from app state down to the map, not an imperative `addAnnotation()`/`removeAnnotation()` pair.
  Worth remembering as the external API shape if our own future package's demo consumer turns out to
  be React-driven (as `demo-gml` already is) — this declarative "sync to this list" entrypoint fits
  that consumption model well.
- Creation-controller lifecycle (`startCreation`/`cancelCreation`/`updateCreationState`), with the
  kind-specific bits (`createAndInitializeController`, `isCurrentlyCreating`, `createFeature`,
  `updateFeature`) left abstract for subclasses.

This is a more sophisticated reuse pattern than anything seen in `tour/`/`slicing/`/`ruler3d/` — those
had shared *primitives* (interaction factories, vector math) but every Support class itself was
bespoke. If we ever want more than one kind of "created/edited entity" in our own package sharing
common plumbing (layer, hover/select, lifecycle), this abstract-generic-base-class shape is the
concrete reference to copy from, not just the idea of "have a Support class."

### `LabelAnnotationSupport` — the concrete point/label implementation

Fills in the abstract hooks: `createLayer()` builds a `FeatureLayer` with `LabelAnnotationPainter`,
`selectable: true`, `hoverable: true`; `createAndInitializeController()` wires up
`LabelAnnotationController` and listens for its `POINT_CREATION_EVENT`. One detail worth keeping in
mind for later: on creation it captures **both** the clicked point **and** the camera's current
`LookAt` (`this._map.camera.asLookAt(distance(...))`) via `emitAnnotationCreated(id, point, lookAt)`
— presumably so a UI can later "fly back to this annotation from the angle it was created at." A
much lighter-weight version of the same idea as `tour/`'s per-point camera vectors (there: a whole
spline of eye/forward/up; here: one static snapshot at creation time) — worth remembering as a cheap
option if we ever want "recall how this vertex looked when it was placed" without needing anything
as heavy as a full path.

### `LabelAnnotationPainter` — rendering detail

Point annotations render as a fixed-size 2D screen-space icon (`IconStyle`, `34px`, four style
variants for default/selected/hovered-visible/hovered-hidden) pinned to the 3D point, with
`OcclusionMode.ALWAYS_VISIBLE` on the default style — the icon renders *through* other geometry
rather than being hidden behind a wall/building it might be logically "on" or "behind." That's a
deliberate, sensible choice for a label/marker (you want to see it exists even from behind the
wall it's mounted on) but is a rendering choice specific to this "always-visible marker" use case,
not a general rule — worth remembering as a knob to consider (occluded vs. always-visible) rather
than assuming one behavior is automatically correct for whatever our own vertex-editing handles end
up looking like.

### Stated limitation

The module's own README: "only designed to work on a map with a geocentric reference" —
i.e. `EPSG:4978`, the same 3D-only requirement seen everywhere else in this toolbox. Consistent,
recurring pattern across every module now examined; not a new constraint, just confirms it again.

## External example — `ria-volume-measurement-tool` (github.com/felipecarrillo100), plus `geolocation/` toolbox module it uses

The user pointed at a real, independently-published, third-party (not Luciad-authored) npm package
that creates/edits oriented boxes for volume measurement:
`https://github.com/felipecarrillo100/ria-volume-measurement-tool` — cloned read-only into the
scratchpad for inspection, not part of this repo or the SDK tree. Genuinely useful on three fronts:
a different architectural style to contrast with Luciad's own, a previously-unexplored Luciad
toolbox module (`geolocation/`) it depends on that turns out to be *the* most directly relevant
thing found so far for our own move/height editing design, and a real novel technique (grid-scan
volume refinement) that isn't in Luciad's toolbox at all.

### Packaging: answers a previously open question

`package.json` declares `@luciad/ria-toolbox-controller`, `@luciad/ria-toolbox-core`, and
`@luciad/ria-toolbox-geolocation` as **peerDependencies** (all `>=2025.0`), published standalone to
npm under MIT. This directly closes the "are toolbox packages consumable as real dependencies for an
independent package" open item from earlier — yes, confirmed by a real, working, separately
distributed example, not just theoretically possible.

### Architectural contrast: one big controller, not Support/Controller/Handle

Unlike every Luciad-authored module examined so far, this package is **one single ~1275-line
`VolumeMeasureController` class** doing everything: creation state machine, face-drag resizing, hover
detection, event emission, label drawing, and the volume-refinement sampling loop. No separate
"Support" class, no `ControllerHandle` subclassing of its own (it delegates whole-box move/rotate/
altitude to Luciad's `GeolocateHandleSupport` instead, see below, rather than building it in). Useful
as a real counter-example: the three-layer split isn't a hard requirement to ship something that
works — but reading both back to back, the split version (Luciad's own) is noticeably easier to
follow than the monolith, which has to track ~15 pieces of mutable state (`_state`, `_firstCorner`,
`_orientation`, `_orientationComplement`, `_width/_depth/_height`, `resizedFaceIndex`,
`hoveredFace`, `_geoHandleSupport`, `_rotating`, `_lastRotation`, ...) on one object. Reinforces
rather than undermines the case for keeping our own design split.

### Creation: same 4-click FSM idea as `BoxCreateController`, independently reimplemented

`CreationState.IDLE → CORNER_DEFINED → WIDTH_DEFINED → PLANE_DEFINED → VOLUME_DEFINED` — corner,
then width (ray-plane intersection anchored at the corner), then depth (perpendicular, same
technique), then height (ray-plane intersection against a vertical plane through the third corner).
Shift-to-toggle-symmetric-extrusion on the last click, same idea as Luciad's own `BoxCreateController`
(`slicing/`). Confirms this 4-click-corner→width→depth→height shape is a natural, independently-
arrived-at pattern for "define a box interactively," not an idiosyncrasy of one codebase.

### Post-creation editing has three distinct, coexisting interaction modes

1. **Per-face drag resize** — hit-tests all 6 box faces via `createFacePolygons` +
   `rayRectangleIntersection` (the exact same primitive `slicing/BoxResizeController` uses), but here
   *any* face can be grabbed directly (no separate resize-handle widget), with a genuinely fiddly
   signed-depth-aware remapping table (`updateFaceSize`'s two parallel switch statements) to figure
   out which logical dimension a given face index actually controls once the box's "depth" sign has
   flipped. A real, hard-won piece of code (visible from the commit-message-style code comments like
   `// Success!!!!` / `// FRom CHAT GPT:` left in the source) — worth remembering as a concrete
   example of how fiddly face-index bookkeeping gets once a box's construction allows negative/signed
   dimensions, if we ever want per-face dragging ourselves.
2. **Whole-box move/rotate/altitude via `GeolocateHandleSupport`** — see its own subsection below;
   this is the standout find.
3. **Click away to deselect / click a face to enter move-rotate mode** — a simple third mode
   toggled by plain clicks once the box exists.

### `geolocation/` toolbox module — previously unexplored, and directly the most relevant find yet

`toolbox/ria/geolocation/`: `GeolocateHandleSupport.ts`, `MoveHandleSupport.ts`,
`RotateHandleSupport.ts`, `AltitudeHandleSupport.ts`, `HandleStyles.ts`. Not part of `tour/`,
`slicing/`, `ruler3d/`, or `annotation/` — a fifth, independent toolbox module, discovered only
because this third-party package depends on it. Its purpose: given *any* object anchored by one
"bottom center" point plus a width/depth (it doesn't care what the object actually is — a box here,
could be anything), provide three ready composed, ready-styled draggable handles for **move**
(horizontal), **rotate** (around vertical axis), and **altitude** (vertical move) — precisely the
"separate base-handle and height-handle" idea from our own original brainstorm, except already
built, generic, and shipping:

- **`GeolocateHandleSupport`** — the composite: owns three `ControllerHandle` instances (move/
  rotate/altitude), each with its own hit-test shape (`createHorizontalBarbedCrossArrow` for move,
  `createHorizontalBarbedArcArrow` for rotate, `createVerticalBarbedLineArrow` for altitude — new
  shape-factory helpers, not seen in earlier modules) and its own interaction factory call
  (`horizontalMovePointInteraction`, `horizontalRotateInteraction`, `verticalMovePointInteraction` —
  all from the same `ControllerHandleInteractionFactory` already catalogued). `handleGestureEvent`
  does exactly the same MOVE-then-DRAG-then-DRAG_END dance as every controller examined so far, just
  packaged as a support object a controller delegates to (`VolumeMeasureController.onGestureEvent`
  literally forwards events into it while in its "resize/rotate" state) rather than a `Controller`
  itself. Emits `MOVED_EVENT`/`ROTATED_EVENT`/`ALTITUDE_CHANGED_EVENT` (translation vectors / degrees)
  for the owning controller to apply to its own model.
- **`AltitudeHandleSupport`** — draws exactly the "vertical guide line with tick marks and a live
  height-delta readout" idea from our very first brainstorm, as a complete, working, already-generic
  (constructor just takes a start point + a margin, no box-specific knowledge) implementation: a
  main stroke line from drag-start to current position, perpendicular tick marks at "nice" intervals
  along it (`findLower125(margin/4)` — a reusable utility that snaps to the nearest 1/2/5×10ⁿ step,
  i.e. the same logic behind axis gridline spacing — worth remembering as a utility, not
  reimplementing it), start/end icons, and a floating `"{heightDiff}m"` HTML label pinned at the
  start point. This is no longer a speculative UX idea — it's a citable, working reference we could
  study line-by-line.
- **`RotateHandleSupport`** — the rotate equivalent: a full reference circle, tick marks every 15°,
  a filled arc-band sweep from start-angle to current angle, and a `"{degrees}°"` label. Confirms the
  "guide visual + live numeric readout while dragging" pattern generalizes cleanly across move/
  rotate/altitude, not just altitude.
- **`MoveHandleSupport`** — a different technique worth noting on its own: rather than drawing shapes
  directly in `onDraw` (as every other helper here does), it creates a **temporary real `FeatureLayer`**
  (added to the map in its constructor, removed in `clear()`) so it can use a
  `ParameterizedLinePainter` with a `rangeColorMap` to fade a ground-reference grid's opacity by
  distance from the drag's start point — an effect (per-vertex color ramps) that isn't available
  through plain `GeoCanvas.drawShape` style objects. Worth remembering as a fallback technique: when a
  desired interactive visual effect can't be expressed as a static `ShapeStyle`, a controller can
  stand up its own short-lived `FeatureLayer` + painter for the duration of one interaction and tear
  it down afterward, rather than only ever using `onDraw`.

Directly the single most relevant module found across this entire investigation for our own "let a
user reposition a placed vertex, including its height, with live visual feedback" goal — more so than
`ruler3d/`'s click-to-place or `annotation/`'s point-drop, since this one is specifically about
*moving/adjusting* an already-placed 3D anchor with dedicated horizontal/vertical/rotational handles,
which is exactly our scenario minus the rotation part.

### A genuinely novel technique *not* in Luciad's own toolbox: grid-scan volume refinement

`refineCalculation()`/`processGridPoints()`/`moveCameraToPointAndSample()` is the author's own
contribution, built from primitives but not itself a Luciad pattern: to correct the box's naive
`width×depth×height` volume for whatever terrain/mesh actually occupies space inside it, the code
lays out a 24×24 grid of points across the box's top face, and for *each* grid point: physically
animates the real 3D camera to hover directly above that point looking straight down
(`setCameraLocation` → `Move3DCameraAnimation` from `ria-toolbox-controller/animation`, pitch -90),
then raycasts from the screen center via `LocationMode.CLOSEST_SURFACE` to measure the actual
terrain/mesh depth there, and accumulates the resulting occupied sub-volumes to subtract from the
naive total. In effect: **use the renderer itself as a depth-sampling oracle for arbitrary complex
mesh geometry** (terrain, buildings, whatever the scene contains), without needing any direct access
to mesh internals — a fully generic technique for "what's actually under this footprint" that works
regardless of what kind of 3D content is loaded. The whole sweep runs as a slow sequential async loop
(one animated camera move + pick per cell — a real perf cost, hence the boustrophedon row order to
minimize camera travel between samples), wrapped in `map.saveState()`/`restoreState()` to return the
camera to its original view afterward, with a user-abortable blocking-progress banner
(`showBlockingBanner`/`updateBlockingBannerProgress`) since it can take a while. Not directly relevant
to vertex-height editing itself, but worth remembering as a technique: raycast-sampling a grid over a
footprint via a real (if temporary, invisible-to-the-user) camera move is a legitimate way to query
"what's really there" when there's no other API for it.

## Non-interactive visualization controllers are a thing too

`PathFrustumController` is a `Controller` that only overrides `onDraw` — no gesture handling at
all. It draws the camera frustum ("what would be visible from here") for the path's current
playback position, purely as a visual aid, composed alongside the interactive controllers in
`PathController`'s `CompositeController`. Small but useful: not every controller in a composed
stack needs to handle input — a purely-visual, read-only controller is a legitimate, reusable
building block (e.g. a "preview what this looks like" overlay while another controller does the
actual editing).

## Direct implications for our own future 3D vertex-height editing design

- The user's UX sketch (separate base-handle and height-handle, vertical guide line, "move
  everything together" handle) is **not a novel idea** — it's very close to what Luciad's own
  `PathEditController` already ships for camera points, and the underlying primitives
  (`planarMovePointInteraction`/`linearMovePointInteraction`, `ControllerHandle`) are generic enough
  that we may not need to reinvent the projection math — only decide whether we depend on
  `@luciad/ria-toolbox-controller`/`-core` directly, or study-and-reimplement the same technique to
  keep our own package's dependency footprint minimal (open question, not decided here).
- Height-dragging is realistically **3D-perspective-view-only**, confirmed by Luciad's own code
  disabling it outright on non-3D maps. Our earlier open question ("does this need to work in a flat
  2D view") has a concrete precedent answer: probably not via dragging; a numeric field is the
  fallback for 2D, not a 2D-adapted gesture.
- The Support/Controller/Handle three-layer split is worth adopting directly: a plain-object
  "shape editing support" class (no map/mouse knowledge) + one small controller per interaction
  concern + `ControllerHandle` instances for each draggable affordance, wired together via events.
- The "move everything together" idea for LineString/Polygon maps cleanly onto `Support.translate()`
  (seen literally in `OrientedBoxEditingSupport`) — a single vector added to every control point,
  which for our shapes is just `Polygon`/`Polyline`'s own existing `translate3D(x,y,z)`.
- The "two edit modes for two different aspects of a point" pattern (position vs. orientation, for
  cameras) suggests our own design should also treat "move" and any future second concern (e.g. if
  we ever add per-vertex styling/rotation) as separate modes rather than cramming both into one
  gesture.

## Design decisions confirmed with the user so far (not just observations — actual choices made)

These came out of discussion after the investigation above, each grounded in something read during
it. Recorded here so they don't get re-litigated from scratch later.

- **Rendering: `onDraw`-only, no auxiliary/temporary `FeatureLayer`s.** `MoveHandleSupport` (in
  `geolocation/`) is the only helper class of the four that stands up a real temporary layer, and only
  to get `ParameterizedLinePainter`'s per-vertex color-ramp fade — a purely cosmetic effect its sibling
  classes (`AltitudeHandleSupport`, `RotateHandleSupport`) achieve with plain `onDraw` calls just fine.
  We're treating that as a one-off, not a pattern to copy: our controllers paint their own transient
  visuals entirely through `onDraw`. If we want a similar fade later, do it with a handful of discrete
  `drawShape` calls at stepped colors, not a real layer.
- **One controller class, not split Create/Edit.** Mirrors `VolumeMeasureController`'s proven
  `options.box?` constructor pattern (pass an existing shape → skip straight to edit state) rather than
  Luciad's more common split-into-several-controllers approach. Removes the controller-swap hand-off
  stock `BasicCreateController`/`EditController` currently force on an app the moment creation
  finishes.
- **One controller class, multi-shape (Point/LineString/Polygon), not one class per shape type.** This
  is *not* a departure from LuciadRIA convention — stock `BasicCreateController`/`EditController`
  already work this way today, because vertex-editing is generically "an ordered list of coordinates"
  with only a few type-specific rules (minimum vertex count, ring closure for Polygon). Agreed
  refinement: keep this as the *external* API shape, but delegate the type-specific bits internally to
  small per-shape-type strategy/Support objects, rather than flattening all three shapes' logic inline
  in one class the way `VolumeMeasureController` did for its one shape (a real maintainability cost
  there — see its own section above).
- **No dependency on `@luciad/ria-toolbox-*` packages, even though most modules read during this
  investigation use them.** Copy/adapt source instead of adding the peerDependency. Reasoning: (a)
  every toolbox source file's own header already grants an explicit license to "use, modify and
  redistribute this software in source and binary code form," conditioned only on keeping the
  copyright notice and not disparaging Luciad — so copying is expressly permitted, not a legal
  gray area, provided we keep that notice on any substantially-derived file; (b) toolbox packages are
  separate installs from core `@luciad/ria` with their own version-alignment burden against the SDK
  release — not depending on them keeps our own package usable on any RIA installation, toolbox
  add-ons present or not; (c) we'd already decided against reusing `MoveHandleSupport`'s layer
  technique and against the flat-monolith shape of `VolumeMeasureController` — meaning wholesale reuse
  of the higher-level classes was off the table anyway; only the low-level math was ever going to be
  reused verbatim.

  Rough triage of what that means concretely, based on everything read so far:
  - **Worth harvesting (copy, trim to only what we call, keep the license header)**: the handful of
    `Vector3Util.js` functions we'll actually use (`add`/`sub`/`scale`/`cross`/`normalize`/`distance`/
    `distanceAlongDirection`/`rayPlaneIntersection`/`toPoint`/`projectPointOnPlane`, not the full ~20-
    function file); `PerspectiveCameraUtil.js`'s single `calculatePointingDirection` function; the core
    ray-plane-intersection recipe inside `verticalMovePointInteraction`/`planarMovePointInteraction`
    from `ControllerHandleInteractionFactory.js` (trimmed to just the vertical/planar cases — we don't
    need the rotate or directional variants without a rotate affordance); `Math.js`'s tiny `clamp`/
    `findLower125` if we end up wanting tick-marked guide lines like `AltitudeHandleSupport`'s.
  - **Worth using as inspiration only, write our own**: `ControllerHandle.ts`'s container shape (small
    enough to design fresh, tailored to exactly what we need); the actual `onDraw` visual styling in
    `AltitudeHandleSupport`/`RotateHandleSupport` (the *idea* of a guide line + live numeric readout
    label is worth keeping, the drawing code itself isn't worth porting verbatim); `GeolocateHandleSupport`'s
    gesture-dispatch orchestration (ours will be shaped around vertex-editing, not box move/rotate/
    altitude, so it needs to be written for that shape, not adapted from this one).
  - **Not needed at all**: `Move3DCameraAnimation`/the grid-scan volume-refinement machinery (irrelevant
    to vertex editing); `AdvancedShapeFactory`'s decorative arrow-shape factories (cosmetic, we can
    design simpler handle visuals of our own).

## Open items / things worth reading next, not done yet

- `BoxSelectController.ts`, `BoxMoveController.ts`, `PathPointSelectionController.ts`,
  `PlayStopController.ts` — found, not yet read. Given `BoxCreateController`/`BoxResizeController`/
  `PathEditController`/`PathControllerUtil`/`PathFrustumController` are now all read and converge on
  the same handful of patterns, these are likely more instances of the same, but not confirmed.
- `crosssection/`, `magnifier/` — not explored at all yet. (`ruler3d/`, `annotation/`, and
  `geolocation/` are now fully read — see their own sections above.) `annotation/measurement/`
  subfolder specifically not read (only the `label/` variant was) — likely more of the same
  `AnnotationSupport` pattern applied to distance/area annotations instead of points, not confirmed.
- `samples/ria/icons3d/` — not read directly; the rotation-limitation note above came from a comment
  in `slicing/`, not from this sample's own code.
- Whether `@luciad/ria-toolbox-controller`/`@luciad/ria-toolbox-core`/`@luciad/ria-toolbox-geolocation`
  are consumable as real dependencies for a new, independent package — **resolved**: yes, confirmed
  by `ria-volume-measurement-tool`'s own `package.json` (peerDependencies on exactly these, published
  standalone to npm under MIT). See its section above.
- `ria-volume-measurement-tool`'s own small util files not yet read in detail:
  `OrientedBoxDrawUtil.ts`, `shapestyles.ts`, `Cube3DMesh.ts`/`Simplified3DMeshFactory.ts` (mesh
  helpers, presumably supporting the box-drawing/occlusion visuals) — skimmed only via what
  `VolumeMeasureController.ts` imports from them, not read directly.
