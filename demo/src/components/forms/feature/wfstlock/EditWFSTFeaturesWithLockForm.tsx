import { useState } from 'react'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import TextField from '@mui/material/TextField'
import Select from '@mui/material/Select'
import MenuItem from '@mui/material/MenuItem'
import InputLabel from '@mui/material/InputLabel'
import FormControl from '@mui/material/FormControl'
import Typography from '@mui/material/Typography'
import List from '@mui/material/List'
import ListItem from '@mui/material/ListItem'
import ListItemText from '@mui/material/ListItemText'
import CircularProgress from '@mui/material/CircularProgress'
import Alert from '@mui/material/Alert'
import { useFormContainer } from 'react-dockable-desktop'
import type { Feature } from '@luciad/ria/model/feature/Feature.js'
import { WFSTFeatureStore, WFSTFeatureLocksStorage, type WFSTEditFeatureLockItem } from 'ria-wfststore'

const DURATION_OPTIONS = [
  { label: '1 minute',  value: 1 },
  { label: '5 minutes', value: 5 },
  { label: '15 minutes', value: 15 },
  { label: '30 minutes', value: 30 },
  { label: '1 hour',    value: 60 },
  { label: '2 hours',   value: 120 },
  { label: '6 hours',   value: 360 },
  { label: '12 hours',  value: 720 },
  { label: '1 day',     value: 1440 },
]

interface Props {
  features: Feature[]
  store: WFSTFeatureStore
  onLockAcquired: (lockItem: WFSTEditFeatureLockItem) => void
}

export function EditWFSTFeaturesWithLockForm({ features, store, onLockAcquired }: Props) {
  const container = useFormContainer()
  const [lockName, setLockName] = useState(() => `Lock-${new Date().toLocaleTimeString()}`)
  const [expiry, setExpiry] = useState(5)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleLock() {
    if (!lockName.trim()) { setError('Lock name is required'); return }
    setLoading(true)
    setError(null)

    let acquiredItem: WFSTEditFeatureLockItem | null = null

    try {
      const rids = features.map(f => String(f.id))
      const lockItem = await store.getFeatureWithLock({ rids, expiry })
      if (!lockItem?.lockId) {
        setError('Server did not grant a lock. The features may already be locked.')
        setLoading(false)
        return
      }
      lockItem.lockName = lockName.trim()
      // bounds is a LuciadRIA Bounds (circular refs) that breaks JSON.stringify.
      // Strip it before localStorage persistence; the lock store doesn't need it.
      lockItem.storeSettings = { ...(lockItem.storeSettings as any), bounds: undefined }
      await WFSTFeatureLocksStorage.addLock(lockItem)
      acquiredItem = lockItem
    } catch (err) {
      console.error('[EditWithLock] Lock acquisition failed:', err)
      setError('Failed to acquire lock. Please try again.')
      setLoading(false)
      return
    }

    container.requestClose()
    onLockAcquired(acquiredItem!)
  }

  return (
    <Box sx={{ p: 2, display: 'flex', flexDirection: 'column', gap: 2 }}>
      <Typography variant="body2" color="text.secondary">
        {features.length === 1
          ? 'Acquire an exclusive lock on this feature.'
          : `Acquire an exclusive lock on ${features.length} features.`}
      </Typography>

      <Box sx={{ maxHeight: 120, overflowY: 'auto', border: '1px solid', borderColor: 'divider', borderRadius: 1 }}>
        <List dense disablePadding>
          {features.map((f, i) => (
            <ListItem key={i} sx={{ py: 0 }}>
              <ListItemText
                primary={<Typography variant="body2" sx={{ fontFamily: 'monospace' }}>{String(f.id)}</Typography>}
              />
            </ListItem>
          ))}
        </List>
      </Box>

      <TextField
        label="Lock Name"
        value={lockName}
        onChange={e => setLockName(e.target.value)}
        size="small"
        fullWidth
        disabled={loading}
      />

      <FormControl size="small" fullWidth>
        <InputLabel id="lock-duration-label">Duration</InputLabel>
        <Select
          labelId="lock-duration-label"
          value={expiry}
          label="Duration"
          onChange={e => setExpiry(Number(e.target.value))}
          disabled={loading}
          MenuProps={{ disablePortal: true }}
        >
          {DURATION_OPTIONS.map(opt => (
            <MenuItem key={opt.value} value={opt.value}>{opt.label}</MenuItem>
          ))}
        </Select>
      </FormControl>

      {error && <Alert severity="error" sx={{ py: 0 }}>{error}</Alert>}

      <Box sx={{ display: 'flex', justifyContent: 'flex-end', gap: 1 }}>
        <Button onClick={() => container.requestClose()} disabled={loading}>
          Cancel
        </Button>
        <Button
          variant="contained"
          onClick={handleLock}
          disabled={loading}
          startIcon={loading ? <CircularProgress size={16} color="inherit" /> : undefined}
        >
          {loading ? 'Locking…' : 'Lock Features'}
        </Button>
      </Box>
    </Box>
  )
}
