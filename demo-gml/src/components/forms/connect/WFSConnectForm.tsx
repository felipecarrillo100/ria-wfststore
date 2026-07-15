import { useState } from 'react'
import Box from '@mui/material/Box'
import Chip from '@mui/material/Chip'
import TextField from '@mui/material/TextField'
import Button from '@mui/material/Button'
import CircularProgress from '@mui/material/CircularProgress'
import List from '@mui/material/List'
import ListItemButton from '@mui/material/ListItemButton'
import ListItemText from '@mui/material/ListItemText'
import Typography from '@mui/material/Typography'
import Alert from '@mui/material/Alert'
import { WFSCapabilities } from '@luciad/ria/model/capabilities/WFSCapabilities.js'
import { mapCommandBus } from '../../../mapCommandBus'

function detectWfst(caps: WFSCapabilities): boolean {
  const raw = (caps as any)?._parser?._raw?.WFS_Capabilities?.OperationsMetadata?.Operation
  if (!Array.isArray(raw)) return false
  return raw.some((op: any) => op.name === 'Transaction')
}

interface FeatureType {
  name: string
  title: string
}

export function WFSConnectForm() {
  // const [url, setUrl] = useState('https://sampleservices.luciad.com/wfs');
  const [url, setUrl] = useState('http://localhost:8081/ogc/wfs/states');

  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [featureTypes, setFeatureTypes] = useState<FeatureType[]>([])
  const [connectedUrl, setConnectedUrl] = useState('')
  const [wfstCapable, setWfstCapable] = useState<boolean | null>(null)

  async function handleConnect() {
    setLoading(true)
    setError(null)
    setFeatureTypes([])
    setWfstCapable(null)
    try {
      const caps = await WFSCapabilities.fromURL(url)
      setWfstCapable(detectWfst(caps))
      const types: FeatureType[] = (caps.featureTypes ?? []).map((ft: any) => ({
        name: ft.name ?? '',
        title: ft.title ?? ft.name ?? '',
      }))
      setFeatureTypes(types)
      setConnectedUrl(url)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to connect to WFS service')
    } finally {
      setLoading(false)
    }
  }

  function handleSelectLayer(ft: FeatureType) {
    mapCommandBus.dispatch({
      type: 'ADD_WFS_LAYER',
      payload: { url: connectedUrl, featureType: ft.name, title: ft.title, wfst: wfstCapable },
    })
  }

  return (
    <Box sx={{ p: 2, display: 'flex', flexDirection: 'column', gap: 2 }}>
      <TextField
        label="WFS URL"
        value={url}
        onChange={(e) => setUrl(e.target.value)}
        size="small"
        fullWidth
        disabled={loading}
      />
      <Button
        variant="contained"
        onClick={handleConnect}
        disabled={loading || !url.trim()}
        startIcon={loading ? <CircularProgress size={16} color="inherit" /> : null}
      >
        {loading ? 'Connecting…' : 'Get Capabilities'}
      </Button>

      {error && <Alert severity="error" sx={{ fontSize: '0.75rem' }}>{error}</Alert>}

      {featureTypes.length > 0 && (
        <>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            <Typography variant="subtitle2" color="text.secondary">
              {featureTypes.length} feature type{featureTypes.length !== 1 ? 's' : ''}
            </Typography>
            {wfstCapable === true && (
              <Chip label="WFS-T" size="small" color="success" variant="outlined" />
            )}
            {wfstCapable === false && (
              <Chip label="Read only" size="small" color="default" variant="outlined" />
            )}
          </Box>
          <List dense disablePadding sx={{ overflow: 'auto', maxHeight: 'calc(100vh - 300px)' }}>
            {featureTypes.map((ft) => (
              <ListItemButton key={ft.name} onClick={() => handleSelectLayer(ft)}>
                <ListItemText
                  primary={ft.title}
                  secondary={ft.name}
                  slotProps={{ primary: { variant: 'body2' }, secondary: { variant: 'caption' } }}
                />
              </ListItemButton>
            ))}
          </List>
        </>
      )}
    </Box>
  )
}
