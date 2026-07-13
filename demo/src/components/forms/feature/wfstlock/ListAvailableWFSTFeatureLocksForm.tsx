import { useEffect, useState } from 'react'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import Typography from '@mui/material/Typography'
import Table from '@mui/material/Table'
import TableBody from '@mui/material/TableBody'
import TableCell from '@mui/material/TableCell'
import TableContainer from '@mui/material/TableContainer'
import TableHead from '@mui/material/TableHead'
import TableRow from '@mui/material/TableRow'
import CircularProgress from '@mui/material/CircularProgress'
import { useFormContainer } from 'react-dockable-desktop'
import type { RIAMap } from '@luciad/ria/view/RIAMap.js'
import {
  WFSTFeatureLockStore,
  WFSTFeatureLocksStorage,
  type WFSTEditFeatureLockItem,
  type WFSTEditFeatureLockIndexItem,
} from 'ria-wfststore'
import { createLockedLayer } from '../../../../modules/luciad/wfst/EditWithLockHelper'

interface Props {
  map: RIAMap
  onResume: (lockItem: WFSTEditFeatureLockItem, lockStore: WFSTFeatureLockStore, helperLayer: any) => void
}

function formatRemaining(eol: number): string {
  const remaining = Math.max(0, eol - Date.now())
  if (remaining === 0) return 'Expired'
  const s = Math.floor(remaining / 1000)
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const sec = s % 60
  if (h > 0) return `${h}h ${m}m`
  if (m > 0) return `${m}m ${sec}s`
  return `${sec}s`
}

export function ListAvailableWFSTFeatureLocksForm({ map, onResume }: Props) {
  const container = useFormContainer()
  const [locks, setLocks] = useState<WFSTEditFeatureLockIndexItem[]>([])
  const [selected, setSelected] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [, setTick] = useState(0)

  function loadLocks() {
    WFSTFeatureLocksStorage.query({ search: '', pageSize: 100, pageNumber: 0 })
      .then(result => setLocks(result.rows))
      .catch(() => setLocks([]))
  }

  useEffect(() => {
    loadLocks()
    const unsubscribe = WFSTFeatureLocksStorage.subscribe(() => loadLocks())
    // Countdown tick every second
    const interval = setInterval(() => setTick(t => t + 1), 1000)
    return () => {
      unsubscribe()
      clearInterval(interval)
    }
  }, [])

  async function handleResume() {
    if (!selected) return
    setLoading(true)
    try {
      const lockItem = await WFSTFeatureLocksStorage.getLock(selected)
      const lockStore = new WFSTFeatureLockStore(lockItem)
      const helperLayer = createLockedLayer(lockStore, lockItem.lockName)
      map.layerTree.addChild(helperLayer)
      onResume(lockItem, lockStore, helperLayer)
      container.requestClose()
    } catch {
      setLoading(false)
    }
  }

  return (
    <Box sx={{ p: 2, display: 'flex', flexDirection: 'column', gap: 2 }}>
      <Typography variant="body2" color="text.secondary">
        Select an existing lock session to resume.
      </Typography>

      {locks.length === 0 ? (
        <Typography variant="body2" color="text.secondary" sx={{ textAlign: 'center', py: 2 }}>
          No active lock sessions found.
        </Typography>
      ) : (
        <TableContainer sx={{ border: '1px solid', borderColor: 'divider', borderRadius: 1 }}>
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell>Lock Name</TableCell>
                <TableCell>Expires In</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {locks.map(lock => (
                <TableRow
                  key={lock.id}
                  hover
                  selected={selected === lock.id}
                  onClick={() => setSelected(lock.id)}
                  sx={{ cursor: 'pointer' }}
                >
                  <TableCell sx={{ fontFamily: 'monospace', fontSize: '0.75rem' }}>{lock.lockName}</TableCell>
                  <TableCell
                    sx={{
                      fontSize: '0.75rem',
                      color: lock.eol - Date.now() < 60_000 ? 'warning.main' : 'text.primary',
                    }}
                  >
                    {formatRemaining(lock.eol)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableContainer>
      )}

      <Box sx={{ display: 'flex', justifyContent: 'flex-end', gap: 1 }}>
        <Button onClick={() => container.requestClose()} disabled={loading}>
          Cancel
        </Button>
        <Button
          variant="contained"
          onClick={handleResume}
          disabled={!selected || loading}
          startIcon={loading ? <CircularProgress size={16} color="inherit" /> : undefined}
        >
          Resume Lock
        </Button>
      </Box>
    </Box>
  )
}
