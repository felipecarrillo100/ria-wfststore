import { useState, FormEvent } from 'react'
import Box from '@mui/material/Box'
import TextField from '@mui/material/TextField'
import Button from '@mui/material/Button'
import { mapCommandBus } from '../../../mapCommandBus'

export function Ogc3DTilesConnectForm() {
  // Keeping your default 3D Tiles URL

  // const [url, setUrl] = useState('https://sampledata.luciad.com/data/ogc3dtiles/LucerneAirborneMesh/tileset.json');
  const [url, setUrl] = useState('https://sampleservices.luciad.com/ogc/3dtiles/marseille-mesh/tileset.json');




      function handleSubmit(e: FormEvent) {
    e.preventDefault() // Prevents page reload on Enter
    if (!url.trim()) return

    // Directly dispatch the command using the committed URL
    mapCommandBus.dispatch({
      type: 'ADD_3DTILES_LAYER',
      payload: {
        url: url.trim(),
        title: '3D Tiles Layer', // Fallback title since we aren't fetching metadata
        featureType: '',
        wfst: false
      },
    })
  }

  return (
      <Box
          component="form"
          onSubmit={handleSubmit}
          sx={{ p: 2, display: 'flex', flexDirection: 'column', gap: 2 }}
      >
        <TextField
            label="3D Tiles URL"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            size="small"
            fullWidth
        />
        <Button
            type="submit"
            variant="contained"
            disabled={!url.trim()}
            fullWidth
        >
          Connect
        </Button>
      </Box>
  )
}