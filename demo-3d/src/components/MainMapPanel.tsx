import { useEffect, useRef } from 'react'
import {
  usePanelId,
  useFormContainer,
  usePanelFloatingWindowManager,
  useWindowManagerActions,
  usePanelActions,
  PanelOverlayRoot,
  PanelToolbar,
  ToolbarToggle,
  ToolbarSpacer,
  ConfirmationForm,
  type ContextMenuItem,
} from 'react-dockable-desktop'

import LayersIcon from '@mui/icons-material/Layers'
import LockOpenIcon from '@mui/icons-material/LockOpen'
import { RIAMap } from '@luciad/ria/view/RIAMap.js'
import { ContextMenu as LuciadContextMenu } from '@luciad/ria/view/ContextMenu.js'
import { Feature } from '@luciad/ria/model/feature/Feature.js'
import type { FeatureLayer } from '@luciad/ria/view/feature/FeatureLayer.js'
import { getReference } from '@luciad/ria/reference/ReferenceProvider.js'
import { WMSTileSetModel } from '@luciad/ria/model/tileset/WMSTileSetModel.js'
import { WMSTileSetLayer } from '@luciad/ria/view/tileset/WMSTileSetLayer.js'
import { EditController } from '@luciad/ria/view/controller/EditController.js'
import type { Controller } from '@luciad/ria/view/controller/Controller.js'
import { useLuciadMapContext } from '../context/LuciadMapContext'
import { useMap } from '../hooks/useMap'
import { throttle } from '../utils/throttle'
import { mapCommandBus } from '../mapCommandBus'
import {LayerBuilder, type AddWfsLayerPayload, type Add3DTilesPayload} from '../modules/luciad/factories/LayerBuilder'
import { layerWfstRegistry } from '../modules/luciad/factories/LayerFactory'
import { populateWfsContextMenu, WFS_CONTEXT_MENU_ICONS } from '../modules/luciad/contextmenu/FeatureContextMenu'
import { createDrawController, getDrawToolFromController, findFirstEditableLayer } from '../modules/luciad/controllers/DrawToolsHelper'
import { create3DEditController, edit3DGeometryController, getShape3DEditToolFromController, isEdit3DGeometrySupported, type ThreeDEditTool } from '../modules/luciad/controllers/Shape3DEditHelper'
import { EditFeaturePropertiesForm } from './forms/feature/EditFeaturePropertiesForm'
import { EditWFSTFeaturesWithLockForm } from './forms/feature/wfstlock/EditWFSTFeaturesWithLockForm'
import { EditCurrentLockForm } from './forms/feature/wfstlock/EditCurrentLockForm'
import { ListAvailableWFSTFeatureLocksForm } from './forms/feature/wfstlock/ListAvailableWFSTFeatureLocksForm'
import { DemoWFSTDelegateScreen } from '../modules/luciad/wfst/DemoWFSTDelegateScreen'
import { WFSTFeatureStore, WFSTFeatureLockStore, WFSTFeatureLocksStorage } from 'ria-wfststore'
import { MapLayersComponent } from './MapLayersComponent'
import type { DrawTool } from '../types/AppState'

// Combines the 2D (BasicCreateController) and 3D (Shape3DEditController) tag-recovery helpers into
// one lookup, since only one controller is ever active on the map and both use the same
// __drawTool tagging convention.
function resolveActiveDrawTool(ctrl: Controller | null): DrawTool {
  const tool2d = getDrawToolFromController(ctrl)
  if (tool2d !== 'select') return tool2d
  return getShape3DEditToolFromController(ctrl) ?? 'select'
}

// onActivate/onResize were added in react-dockable-desktop 4.1.0; type definitions lag behind.
type Contract41 = ReturnType<typeof useFormContainer> & {
  onActivate?: (handler: () => void) => () => void
  onResize?: (handler: () => void) => () => void
}

export function MainMapPanel() {
  const panelId = usePanelId()
  const contract = useFormContainer() as Contract41
  const containerRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<RIAMap | null>(null)
  const { registerMap, unregisterMap, setCurrentlySelected, setDrawTool, currentLayers } = useLuciadMapContext()
  const { showContextMenu } = useWindowManagerActions()
  const { openModal, openLeftPanel } = usePanelActions()

  // Carry latest currentLayers into stable effect closures without re-subscribing
  const currentLayersRef = useRef(currentLayers)
  currentLayersRef.current = currentLayers

  // Delegate is created once and lives for the component lifetime
  const delegateRef = useRef(new DemoWFSTDelegateScreen())

  // Keep showContextMenu stable in a ref so the map creation effect never needs to re-run
  const showContextMenuRef = useRef(showContextMenu)
  showContextMenuRef.current = showContextMenu

  // Stable ref for edit-geometry callback
  const openEditGeomRef = useRef<((feature: any, layer: FeatureLayer) => void) | null>(null)
  openEditGeomRef.current = (feature: any, layer: FeatureLayer) => {
    const map = mapRef.current
    if (!map) return
    const editController = new EditController(layer, feature, { finishOnSingleClick: true })
    editController.onDeactivate = (...args: any[]) =>
      new Promise<void>((resolve) => {
        (EditController.prototype as any).onDeactivate.apply(editController, args)
        map.controller = null
        resolve()
      })
    map.controller = editController
  }

  // Stable ref for the "Edit 3D geometry" context menu action - unlike openEditGeomRef above,
  // Shape3DEditController already self-deactivates (sets map.controller = null itself) once
  // editing ends, so no onDeactivate wrapping is needed here.
  const openEdit3DGeomRef = useRef<((feature: Feature, layer: FeatureLayer) => void) | null>(null)
  openEdit3DGeomRef.current = (feature: Feature, layer: FeatureLayer) => {
    const map = mapRef.current
    if (!map) return
    const ctrl = edit3DGeometryController(feature, layer)
    if (ctrl) map.controller = ctrl
  }

  // Wire the delegate's new-feature handler: called by the store when a drawn feature has
  // missing/invalid properties. Shows the properties form; on save re-submits to the store.
  // Runs every render so openModal is always the latest reference.
  delegateRef.current.setEditNewFeatureHandler((feature, store) => {
    openModal(
      EditFeaturePropertiesForm,
      {
        feature,
        onSave: (properties: Record<string, unknown>) => {
          const updated = new Feature(feature.shape, properties, feature.id)
          // store is WFSTFeatureStore | WFSTFeatureLockStore - add() is async on the former,
          // sync on the latter (matching RIA's own Store.add() contract: FeatureId | Promise<FeatureId>).
          // Promise.resolve(...) handles both without an unsafe cast or an instanceof branch.
          Promise.resolve(store.add(updated)).catch((err: unknown) =>
            console.error('WFS-T add failed:', err)
          )
        },
      },
      { title: 'New Feature', size: 'medium' }
    )
  })

  // Wire the delegate's confirm handler to react-dockable-desktop's ConfirmationForm.
  // Runs every render so openModal is always the latest reference.
  delegateRef.current.setConfirmHandler((onOK, onCancel) => {
    openModal(
      ConfirmationForm,
      {
        title: 'Confirm geometry update',
        message: "Would you like to proceed with updating the feature's geometry?",
        useYesNoTitles: true,
        onOK,
        onCancel,
      },
      { size: 'small' }
    )
  })

  // Delete one or many features with confirmation
  const openDeleteRef = useRef<((features: Feature[], layer: FeatureLayer) => void) | null>(null)
  openDeleteRef.current = (features: Feature[], layer: FeatureLayer) => {
    const count = features.length
    openModal(
      ConfirmationForm,
      {
        title: count === 1 ? 'Delete feature' : `Delete ${count} features`,
        message: count === 1
          ? 'Are you sure you want to permanently delete this feature? This action cannot be undone.'
          : `Are you sure you want to permanently delete ${count} features? This action cannot be undone.`,
        useYesNoTitles: true,
        onOK: () => {
          const store = (layer.model as any).store
          if (store instanceof WFSTFeatureStore) {
            Promise.all(features.map(f => store.remove(f.id)))
              .catch((err: unknown) => console.error('WFS-T remove failed:', err))
          }
        },
        onCancel: () => {},
      },
      { size: 'small' }
    )
  }

  const openEditWithLockRef = useRef<((features: Feature[], layer: FeatureLayer) => void) | null>(null)
  openEditWithLockRef.current = (features: Feature[], layer: FeatureLayer) => {
    const store = (layer.model as any)?.store
    if (!(store instanceof WFSTFeatureStore)) return

    openLeftPanel(
      EditWFSTFeaturesWithLockForm,
      { features, store },
      { title: 'Edit with Lock', width: 360 }
    )
  }

  // Open edit-properties as a react-dockable-desktop modal
  const openEditPropsRef = useRef<((feature: any, layer: FeatureLayer) => void) | null>(null)
  openEditPropsRef.current = (feature: any, layer: FeatureLayer) => {
    openModal(
      EditFeaturePropertiesForm,
      {
        feature,
        onSave: (properties: Record<string, unknown>) => {
          const updated = new Feature(feature.shape, properties, feature.id)
          const store = (layer.model as any).store
          if (store instanceof WFSTFeatureStore) {
            store.putProperties(updated).catch((err: unknown) => console.error('WFS-T putProperties failed:', err))
          } else {
            Promise.resolve(layer.model.put(updated)).catch((err: unknown) => console.error('WFS-T put failed:', err))
          }
        },
      },
      { title: 'Edit Properties', size: 'medium' }
    )
  }

  // Today: no-op. Future: open a dialog offering to create an AnnotationsLayer (an editing layer
  // that doesn't require a server). This is the single extension point for that feature.
  function handleNoEditableLayer() {
    // TODO: prompt user to create an AnnotationsLayer
  }

  // Effect 1 — activate tracking
  useEffect(() => {
    return contract.onActivate?.(() => setCurrentlySelected(panelId))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [panelId, setCurrentlySelected])

  // Effect 2 — map creation + WMS base layer + ControllerChanged tracking
  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    const map = new RIAMap(container, { reference: getReference('EPSG:4978') })
    mapRef.current = map

    WMSTileSetModel.createFromURL(
      'https://sampleservices.luciad.com/wms',
      [{ layer: '4ceea49c-3e7c-4e2d-973d-c608fb2fb07e' }],
      {}
    ).then((model) => {
      map.layerTree.addChild(new WMSTileSetLayer(model, { label: 'Imagery' }))
    })

    // Translate LuciadRIA's populated ContextMenu into the library's global portal-rendered menu.
    // LuciadRIA only calls this when contextMenu has items.
    map.onShowContextMenu = (position: number[], contextMenu: LuciadContextMenu) => {
      if (contextMenu.items.length === 0) return
      const items: ContextMenuItem[] = contextMenu.items.map((item) =>
        item.separator
          ? { separator: true as const }
          : { label: item.label, icon: WFS_CONTEXT_MENU_ICONS[item.id as string], action: item.action }
      )
      showContextMenuRef.current?.({ x: position[0], y: position[1], items })
    }

    setCurrentlySelected(panelId)
    registerMap(panelId, map)

    // Publish draw tool state whenever the controller changes — MainMapPanel is the
    // authoritative owner of this map's controller state (user's architecture).
    setDrawTool(panelId, resolveActiveDrawTool(map.controller ?? null))
    const controllerHandle = map.on('ControllerChanged', (newCtrl: any) => {
      setDrawTool(panelId, resolveActiveDrawTool(newCtrl))
    })

    return () => {
      controllerHandle.remove()
      mapRef.current = null
      unregisterMap(panelId)
      map.destroy()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [panelId, registerMap, unregisterMap, setCurrentlySelected, setDrawTool])

  // Effect 3 — resize
  useEffect(() => {
    const throttledResize = throttle(() => { mapRef.current?.resize() }, 200, { leading: true, trailing: true })
    const unsubscribe = contract.onResize?.(throttledResize)
    return () => {
      throttledResize.cancel()
      unsubscribe?.()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Effect 4 — command bus
  useEffect(() => {
    return mapCommandBus.subscribe((cmd) => {
      const map = mapRef.current
      if (!map) return
      if (cmd.type === 'ADD_3DTILES_LAYER') {
        LayerBuilder.add3DTileLayer(cmd.payload as Add3DTilesPayload, map)
      }
      if (cmd.type === 'ADD_WFS_LAYER') {
        LayerBuilder.addWfsLayer(cmd.payload as AddWfsLayerPayload, map)
          .then((layer) => {
            // Inject the React-aware delegate so confirmGeometryUpdate shows a modal
            const store = (layer.model as any).store
            if (store instanceof WFSTFeatureStore) {
              store.setScreenHelper(delegateRef.current)
            }
            layer.onCreateContextMenu = (contextMenu: LuciadContextMenu, layerMap: RIAMap, info: unknown) => {
              const clickedObjects = ((info as any)?.objects ?? []) as Feature[]
              if (clickedObjects.length === 0) return

              // Three cases: nothing selected -> act on the clicked feature; something selected
              // but the click landed on a feature outside that selection -> still act on just
              // the clicked feature (a stale selection elsewhere must never override what was
              // actually right-clicked); the click landed on a feature that IS part of the
              // current selection -> act on the whole selection (bulk actions).
              const clickedFeature = clickedObjects[0]
              const selInfo = layerMap.selectedObjects.find(s => s.layer === layer)
              const selectedInLayer = (selInfo?.selected ?? []) as Feature[]
              const clickedIsSelected = selectedInLayer.some(f => f.id === clickedFeature.id)
              const features = clickedIsSelected ? selectedInLayer : [clickedFeature]

              const wfst = layerWfstRegistry.get(layer.id) ?? false
              populateWfsContextMenu(contextMenu, features, wfst, layerMap,
                (feature) => openEditPropsRef.current?.(feature, layer),
                (feature) => openEditGeomRef.current?.(feature, layer),
                (feature) => openEdit3DGeomRef.current?.(feature, layer),
                (featureList) => openDeleteRef.current?.(featureList, layer),
                (featureList) => openEditWithLockRef.current?.(featureList, layer),
              )
            }
          })
          .catch((err) => console.error('Failed to add WFS layer:', err))
      }
      if (cmd.type === 'OPEN_LOCK_SESSION') {
        const { lockId } = cmd.payload as { lockId: string }
        WFSTFeatureLocksStorage.getLock(lockId).then((lockItem) => {
          const lockStore = new WFSTFeatureLockStore(lockItem)
          lockStore.setScreenHelper(delegateRef.current)
          const helperLayer = LayerBuilder.addLockLayer(lockStore, lockItem.lockName, map)

          helperLayer.onCreateContextMenu = (contextMenu, _layerMap, info) => {
            const clickedObjects = ((info as any)?.objects ?? []) as Feature[]
            if (clickedObjects.length === 0) return
            const feature = clickedObjects[0]

            // Reuse the main context menu's item ids (not lock-specific ones) so these resolve
            // to the same icons via WFS_CONTEXT_MENU_ICONS[item.id] in the shared
            // onShowContextMenu translation below - these are the same semantic actions, just
            // wired to the lock store instead of the main one.
            contextMenu.addItem({
              id: 'wfs-fit', label: 'Zoom to feature',
              action: () => {
                const bounds = feature.shape?.bounds
                if (bounds) map.mapNavigator.fit({ bounds, animate: true })
              },
            })
            contextMenu.addSeparator()
            contextMenu.addItem({
              id: 'wfs-edit-geom', label: 'Edit geometry',
              action: () => openEditGeomRef.current?.(feature, helperLayer),
            })
            if (feature.shape && isEdit3DGeometrySupported(feature.shape.type)) {
              contextMenu.addItem({
                id: 'wfs-edit-geom-3d', label: 'Edit 3D geometry',
                action: () => openEdit3DGeomRef.current?.(feature, helperLayer),
              })
            }
            contextMenu.addItem({
              id: 'wfs-edit-props', label: 'Edit properties',
              action: () => openModal(
                EditFeaturePropertiesForm,
                {
                  feature,
                  onSave: (properties: Record<string, unknown>) => {
                    const updated = new Feature(feature.shape, properties, feature.id)
                    lockStore.putProperties(updated)
                  },
                },
                { title: 'Edit Properties', size: 'medium' }
              ),
            })
            contextMenu.addSeparator()
            contextMenu.addItem({
              id: 'wfs-delete', label: 'Delete feature',
              action: () => lockStore.remove(feature.id),
            })
          }

          setTimeout(() => {
            openLeftPanel(
              EditCurrentLockForm,
              { lockItem, lockStore, helperLayer, map },
              { title: 'Lock Session', width: 360 }
            )
          }, 333)
        }).catch((err) => {
          console.error('Failed to open lock session:', err)
          delegateRef.current?.MessageError('This lock is no longer available. It may have expired or been removed.')
        })
      }
      if (cmd.type === 'SET_DRAW_TOOL') {
        const { tool, panelId: targetId } = cmd.payload as { tool: DrawTool; panelId: string }
        if (targetId !== panelId) return
        if (tool === 'select') {
          map.controller = null
          return
        }
        // Resolve target layer before creating the controller — onChooseLayer is synchronous
        // and cannot show a dialog, so the "no layer" check must happen here.
        const layer = currentLayersRef.current[panelId] ?? findFirstEditableLayer(map)
        if (!layer) {
          handleNoEditableLayer()
          return
        }
        const ctrl = createDrawController(tool, () => layer)
        map.controller = ctrl
      }
      if (cmd.type === 'SET_3D_EDIT_TOOL') {
        const { tool, panelId: targetId } = cmd.payload as { tool: ThreeDEditTool; panelId: string }
        if (targetId !== panelId) return
        const layer = currentLayersRef.current[panelId] ?? findFirstEditableLayer(map)
        if (!layer) {
          handleNoEditableLayer()
          return
        }
        map.controller = create3DEditController(tool, layer)
      }
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <PanelOverlayRoot style={{ width: '100%', height: '100%' }}>
      <div ref={containerRef} style={{ width: '100%', height: '100%' }} />
      <MapToolbar panelId={panelId} />
    </PanelOverlayRoot>
  )
}

// Must be a descendant of PanelOverlayRoot to use usePanelFloatingWindowManager
function MapToolbar({ panelId }: { panelId: string }) {
  const map = useMap(panelId)
  const floats = usePanelFloatingWindowManager()
  const { openLeftPanel } = usePanelActions()

  function toggleLayers() {
    if (floats.isOpen('layers')) {
      floats.close('layers')
    } else {
      floats.open('layers', {
        title: 'Layers',
        icon: <LayersIcon fontSize="small" />,
        content: <MapLayersComponent map={map} panelId={panelId} />,
        anchor: 'top-right',
        width: 280,
        height: 400,
      })
    }
  }

  function handleResumeLock() {
    openLeftPanel(ListAvailableWFSTFeatureLocksForm, {}, { title: 'Available Locks', width: 360 })
  }

  return (
    <PanelToolbar position="top">
      <ToolbarSpacer />
      <ToolbarToggle
        icon={<LockOpenIcon />}
        active={false}
        onToggle={handleResumeLock}
        title="Resume Lock Session"
      />
      <ToolbarToggle
        icon={<LayersIcon />}
        active={floats.isOpen('layers')}
        onToggle={toggleLayers}
        title="Layers"
      />
    </PanelToolbar>
  )
}
