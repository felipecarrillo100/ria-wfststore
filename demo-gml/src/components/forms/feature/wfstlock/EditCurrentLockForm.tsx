import { useCallback, useEffect, useRef, useState } from 'react'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import Typography from '@mui/material/Typography'
import Chip from '@mui/material/Chip'
import Tabs from '@mui/material/Tabs'
import Tab from '@mui/material/Tab'
import Table from '@mui/material/Table'
import TableBody from '@mui/material/TableBody'
import TableCell from '@mui/material/TableCell'
import TableContainer from '@mui/material/TableContainer'
import TableHead from '@mui/material/TableHead'
import TableRow from '@mui/material/TableRow'
import IconButton from '@mui/material/IconButton'
import Menu from '@mui/material/Menu'
import MenuItem from '@mui/material/MenuItem'
import CircularProgress from '@mui/material/CircularProgress'
import Alert from '@mui/material/Alert'
import Tooltip from '@mui/material/Tooltip'
import MoreVertIcon from '@mui/icons-material/MoreVert'
import { useFormContainer } from 'react-dockable-desktop'
import type { WebGLMap as RIAMap } from '@luciad/ria/view/WebGLMap.js'
import { FeatureLayer } from '@luciad/ria/view/feature/FeatureLayer.js'
import type { Feature } from '@luciad/ria/model/feature/Feature.js'
import {
  WFSTFeatureLockStore,
  WFSTFeatureLocksStorage,
  type CommitLockTransactionResult,
  type WFSTEditFeatureLockItem,
  type WFSEditedFeature,
  WFSTFeatureStore,
} from 'ria-wfststore'
import { LayerTreeVisitor } from "@luciad/ria/view/LayerTreeVisitor.js"
import type {Layer} from "@luciad/ria/view/Layer.js";
import type {LayerGroup} from "@luciad/ria/view/LayerGroup.js";
import {LayerTreeNode} from "@luciad/ria/view/LayerTreeNode.js";

interface Props {
  lockItem: WFSTEditFeatureLockItem
  lockStore: WFSTFeatureLockStore
  helperLayer: FeatureLayer
  map: RIAMap
}

function formatRemaining(ms: number): string {
  if (ms <= 0) return 'Expired'
  const s = Math.floor(ms / 1000)
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const sec = s % 60
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')} hours`
  if (m > 0) return `${m}:${String(sec).padStart(2, '0')} minutes`
  return `${sec} seconds`
}

function lookupFeature(id: string, lockStore: WFSTFeatureLockStore): Feature | null {
  const cursor = (lockStore as any).query?.()
  if (!cursor) return null
  while (cursor.hasNext()) {
    const f = cursor.next() as Feature
    if (String(f.id) === String(id)) return f
  }
  return null
}

interface RowMenuProps {
  id: string
  tab: 'unchanged' | 'updated' | 'deleted' | 'inserted'
  lockStore: WFSTFeatureLockStore
  map: RIAMap
}

function RowMenu({ id, tab, lockStore, map }: RowMenuProps) {
  const [anchor, setAnchor] = useState<HTMLElement | null>(null)

  function handleZoom() {
    setAnchor(null)
    const f = lookupFeature(id, lockStore)
    const bounds = f?.shape?.bounds
    if (bounds) map.mapNavigator.fit({ bounds, animate: true })
  }

  return (
      <>
        <Tooltip title="Actions">
          <IconButton size="small" onClick={e => setAnchor(e.currentTarget)}>
            <MoreVertIcon fontSize="small" />
          </IconButton>
        </Tooltip>
        <Menu anchorEl={anchor} open={Boolean(anchor)} onClose={() => setAnchor(null)}>
          <MenuItem onClick={handleZoom}>Zoom to feature</MenuItem>
          {(tab === 'updated' || tab === 'deleted') && (
              <MenuItem
                  onClick={() => {
                    setAnchor(null)
                    // Revert: not yet supported in the library; deferred
                  }}
                  disabled
              >
                Revert to Unchanged
              </MenuItem>
          )}
        </Menu>
      </>
  )
}

function FeatureTable({
                        ids,
                        tab,
                        lockStore,
                        map,
                      }: {
  ids: string[]
  tab: 'unchanged' | 'updated' | 'deleted' | 'inserted'
  lockStore: WFSTFeatureLockStore
  map: RIAMap
}) {
  if (ids.length === 0) {
    return (
        <Typography variant="body2" color="text.secondary" sx={{ p: 2, textAlign: 'center' }}>
          No features
        </Typography>
    )
  }
  return (
      <TableContainer sx={{ maxHeight: 260 }}>
        <Table size="small" stickyHeader>
          <TableHead>
            <TableRow>
              <TableCell>Feature ID</TableCell>
              <TableCell align="right" sx={{ width: 48 }} />
            </TableRow>
          </TableHead>
          <TableBody>
            {ids.map(id => (
                <TableRow key={id} hover>
                  <TableCell sx={{ fontFamily: 'monospace', fontSize: '0.75rem' }}>{id}</TableCell>
                  <TableCell align="right">
                    <RowMenu id={id} tab={tab} lockStore={lockStore} map={map} />
                  </TableCell>
                </TableRow>
            ))}
          </TableBody>
        </Table>
      </TableContainer>
  )
}

export function EditCurrentLockForm({ lockItem, lockStore, helperLayer, map }: Props) {
  const container = useFormContainer()
  const [currentItem, setCurrentItem] = useState<WFSTEditFeatureLockItem>(lockItem)
  const [activeTab, setActiveTab] = useState(0)
  const [expireStr, setExpireStr] = useState('')
  const [isExpired, setIsExpired] = useState(false)
  const [committing, setCommitting] = useState(false)
  const [commitError, setCommitError] = useState<string | null>(null)
  const shouldRunRef = useRef(true)
  const helperLayerRemovedRef = useRef(false)

  const removeHelperLayer = useCallback(() => {
    if (helperLayerRemovedRef.current) return
    helperLayerRemovedRef.current = true
    map.layerTree.removeChild(helperLayer)
  }, [map, helperLayer])

  const recalcTimeout = useCallback(() => {
    WFSTFeatureLocksStorage.getLockPointer(lockItem.id!)
        .then(pointer => {
          const remaining = Math.max(0, pointer.eol - Date.now())
          setIsExpired(remaining === 0)
          setExpireStr(formatRemaining(remaining))
          if (remaining > 0 && shouldRunRef.current) {
            setTimeout(recalcTimeout, 1000)
          }
        })
        .catch(() => {
          setIsExpired(true)
          setExpireStr('Expired')
        })
  }, [lockItem.id])

  useEffect(() => {
    shouldRunRef.current = true
    recalcTimeout()
    const unsubscribe = WFSTFeatureLocksStorage.subscribe(() => {
      WFSTFeatureLocksStorage.getLock(lockItem.id!)
          .then(item => setCurrentItem(item))
          .catch(() => {})
    })
    return () => {
      shouldRunRef.current = false
      unsubscribe()
    }
  }, [lockItem.id, recalcTimeout]);

  useEffect(() => {
    // Left/right panels don't implement onClose, only onCloseRequested (a close
    // guard). requestClose() awaits this before actually closing, so it fires
    // for every close path: the Close button, the panel's own X button, and
    // replacement when another left panel is opened. Always allow the close.
    return container.onCloseRequested(() => {
      removeHelperLayer()
      return true
    })
  }, [container, removeHelperLayer])

  function findAssociatedLayers() {
    const WFSIdentity = WFSTFeatureStore.getWFSStoreIdentity(lockItem.storeSettings);
    const layersFound: FeatureLayer[] = [];
    const layerTreeVisitor: LayerTreeVisitor = {
      visitLayer: (layer: Layer): LayerTreeVisitor.ReturnValue => {
        if (layer instanceof FeatureLayer) {
          if (layer.model.store instanceof WFSTFeatureStore) {
            const storeIdentity = layer.model.store.getWFSStoreidentity();
            if (storeIdentity === WFSIdentity) {
              layersFound.push(layer);
            }
          }
        }
        return LayerTreeVisitor.ReturnValue.CONTINUE;
      },
      visitLayerGroup(layerGroup: LayerGroup): LayerTreeVisitor.ReturnValue {
        layerGroup.visitChildren(layerTreeVisitor, LayerTreeNode.VisitOrder.TOP_DOWN);
        return LayerTreeVisitor.ReturnValue.CONTINUE;
      }
    };
    map.layerTree.visitChildren(layerTreeVisitor, LayerTreeNode.VisitOrder.TOP_DOWN);
    return layersFound;
  }

  async function handleCommit() {
    setCommitting(true)
    setCommitError(null)
    let totalChanges = 0
    try {
      const latest = await WFSTFeatureLocksStorage.getLock(lockItem.id!)
      const result = await lockStore.commitLockTransaction(latest) as CommitLockTransactionResult
      if (result?.success) {
        totalChanges = result.totalChanges ?? 0
        await WFSTFeatureLocksStorage.deleteLock(lockItem.id!);
        if (totalChanges > 0) {
          try {
            const layersFound = findAssociatedLayers();
            for (const layer of layersFound) {
              if (layer.loadingStrategy && layer.loadingStrategy.queryProvider && layer.loadingStrategy.queryProvider.invalidate) {
                layer.loadingStrategy.queryProvider.invalidate();
              }
            }
          } catch (e) {
            console.warn('[EditCurrentLockForm] Layer invalidation failed:', e)
          }
        }
        removeHelperLayer()
        container.requestClose()
      } else {
        setCommitError('Commit failed. Please try again.')
        setCommitting(false)
        return
      }
    } catch {
      setCommitError('An error occurred during commit.')
      setCommitting(false)
      return
    }
  }

  async function handleCancel() {
    try {
      const latest = await WFSTFeatureLocksStorage.getLock(lockItem.id!)
      const empty: WFSTEditFeatureLockItem = {
        ...latest,
        deletedIds: [],
        insertedIds: [],
        updatedIds: [],
      }
      await lockStore.commitLockTransaction(empty)
      await WFSTFeatureLocksStorage.deleteLock(lockItem.id!)
    } catch {
      // Even if the server call fails, clean up locally
      await WFSTFeatureLocksStorage.deleteLock(lockItem.id!).catch(() => {})
    }
    removeHelperLayer()
    container.requestClose()
  }

  const updatedIds: string[] = currentItem.updatedIds.map((e: WFSEditedFeature) => e.id)
  const insertedIds: string[] = currentItem.insertedIds.map((e: WFSEditedFeature) => e.id)

  const tabs = [
    { label: 'Unchanged', ids: currentItem.unchangedIds, tab: 'unchanged' as const },
    { label: 'Updated',   ids: updatedIds,                tab: 'updated' as const },
    { label: 'Deleted',   ids: currentItem.deletedIds,    tab: 'deleted' as const },
    { label: 'Inserted',  ids: insertedIds,               tab: 'inserted' as const },
  ]

  return (
      <Box sx={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>
        {/* Lock info */}
        <Box sx={{ p: 2, borderBottom: '1px solid', borderColor: 'divider' }}>
          <Typography variant="subtitle2" gutterBottom>{currentItem.lockName}</Typography>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 0.5 }}>
            <Typography variant="caption" color="text.secondary">ID:</Typography>
            <Chip label={currentItem.lockId} size="small" sx={{ fontFamily: 'monospace', fontSize: '0.7rem' }} />
          </Box>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            <Typography variant="caption" color="text.secondary">Expires In:</Typography>
            <Typography
                variant="caption"
                color={isExpired ? 'error' : expireStr.includes('seconds') ? 'warning.main' : 'text.primary'}
                sx={{ fontWeight: isExpired ? 700 : 400 }}
            >
              {expireStr || '…'}
            </Typography>
          </Box>
        </Box>

        {/* Tabs */}
        <Tabs
            value={activeTab}
            onChange={(_, v) => setActiveTab(v)}
            variant="scrollable"
            scrollButtons="auto"
            sx={{ borderBottom: '1px solid', borderColor: 'divider', minHeight: 40 }}
        >
          {tabs.map((t, i) => (
              <Tab
                  key={i}
                  label={
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                      {t.label}
                      {t.ids.length > 0 && (
                          <Chip label={t.ids.length} size="small" sx={{ height: 16, fontSize: '0.65rem' }} />
                      )}
                    </Box>
                  }
                  sx={{ minHeight: 40, py: 0.5, px: 1, fontSize: '0.75rem' }}
              />
          ))}
        </Tabs>

        {/* Tab content */}
        <Box sx={{ flexGrow: 1, overflow: 'auto' }}>
          <FeatureTable
              ids={tabs[activeTab].ids}
              tab={tabs[activeTab].tab}
              lockStore={lockStore}
              map={map}
          />
        </Box>

        {/* Errors */}
        {commitError && (
            <Alert severity="error" onClose={() => setCommitError(null)} sx={{ mx: 2, mb: 1 }}>
              {commitError}
            </Alert>
        )}

        {isExpired && (
            <Alert severity="warning" sx={{ mx: 2, mb: 1 }}>
              Lock has expired. You can no longer commit changes.
            </Alert>
        )}

        {/* Action buttons */}
        <Box sx={{ p: 2, borderTop: '1px solid', borderColor: 'divider', display: 'flex', gap: 1, justifyContent: 'flex-end' }}>
          <Button size="small" color="warning" onClick={handleCancel} disabled={committing}>
            Cancel and unlock
          </Button>
          <Button size="small" onClick={() => container.requestClose()} disabled={committing}>
            Close
          </Button>
          <Button
              size="small"
              variant="contained"
              onClick={handleCommit}
              disabled={isExpired || committing}
              startIcon={committing ? <CircularProgress size={14} color="inherit" /> : undefined}
          >
            {committing ? 'Committing…' : 'Commit Changes'}
          </Button>
        </Box>
      </Box>
  )
}
