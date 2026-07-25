import { useEffect, useMemo, useState } from 'react'
import Box from '@mui/material/Box'
import TextField from '@mui/material/TextField'
import Table from '@mui/material/Table'
import TableBody from '@mui/material/TableBody'
import TableCell from '@mui/material/TableCell'
import TableContainer from '@mui/material/TableContainer'
import TableHead from '@mui/material/TableHead'
import TableRow from '@mui/material/TableRow'
import Typography from '@mui/material/Typography'
import type { FeatureLayer } from '@luciad/ria/view/feature/FeatureLayer.js'
import type { Feature } from '@luciad/ria/model/feature/Feature.js'
import { mapCommandBus } from '../mapCommandBus'

interface FeatureListPanelProps {
  layer: FeatureLayer
  panelId: string
}

// Rendering every row of a huge working set (tens of thousands of features on some layers) would
// freeze the table - cap what actually gets rendered and tell the user it's truncated.
const MAX_RENDERED_FEATURES = 500

// The scan itself is cheap even for tens of thousands of features; debouncing just avoids
// re-scanning the whole working set on every single keystroke while the user is still typing.
const FILTER_DEBOUNCE_MS = 200

// No schema assumption - matches the id or any stringified property value, case-insensitively.
function matchesQuery(feature: Feature, query: string): boolean {
  if (String(feature.id).toLowerCase().includes(query)) return true
  const properties = feature.properties
  if (!properties) return false
  for (const value of Object.values(properties)) {
    if (value != null && String(value).toLowerCase().includes(query)) return true
  }
  return false
}

// Panel content (opened via openPanel('feature-list') from MapLayersComponent, hosted by
// FeatureListDockablePanel). Mirrors the layer's working set live: WorkingSetChanged fires on
// every add/update/remove/clear, so the list always reflects what's actually loaded, not a
// one-time snapshot taken on open.
export function FeatureListPanel({ layer, panelId }: FeatureListPanelProps) {
  const [features, setFeatures] = useState<Feature[]>(() => layer.workingSet.get())
  const [query, setQuery] = useState('')
  const [debouncedQuery, setDebouncedQuery] = useState('')

  useEffect(() => {
    setFeatures(layer.workingSet.get())
    const handle = layer.workingSet.on('WorkingSetChanged', () => {
      setFeatures(layer.workingSet.get())
    })
    return () => handle.remove()
  }, [layer])

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedQuery(query.trim().toLowerCase()), FILTER_DEBOUNCE_MS)
    return () => clearTimeout(timer)
  }, [query])

  // Filters the full working set, not just the rendered/capped slice - a match must be findable
  // anywhere in the layer, independent of MAX_RENDERED_FEATURES.
  const filteredFeatures = useMemo(() => {
    if (!debouncedQuery) return features
    return features.filter(feature => matchesQuery(feature, debouncedQuery))
  }, [features, debouncedQuery])

  const visibleFeatures = filteredFeatures.slice(0, MAX_RENDERED_FEATURES)
  const truncated = filteredFeatures.length > MAX_RENDERED_FEATURES

  // Sent to the map hosting this panel, not applied directly - the panel has no direct handle on
  // the RIAMap instance, and MainMapPanel's command-bus subscription (panelId-targeted, same
  // convention as SET_DRAW_TOOL) is what actually calls mapNavigator.fit().
  const handleRowClick = (feature: Feature) => {
    mapCommandBus.dispatch({ type: 'ZOOM_TO_FEATURE', payload: { panelId, feature } })
  }

  return (
    <Box sx={{ height: '100%', display: 'flex', flexDirection: 'column', bgcolor: 'background.paper' }}>
      <Box sx={{ p: 1, flexShrink: 0 }}>
        <TextField
          size="small"
          fullWidth
          placeholder="Filter features..."
          value={query}
          onChange={e => setQuery(e.target.value)}
        />
      </Box>

      {features.length === 0 ? (
        <Typography variant="body2" color="text.secondary" sx={{ p: 2, textAlign: 'center' }}>
          No features in working set
        </Typography>
      ) : filteredFeatures.length === 0 ? (
        <Typography variant="body2" color="text.secondary" sx={{ p: 2, textAlign: 'center' }}>
          No features match "{query}"
        </Typography>
      ) : (
        <>
          <TableContainer sx={{ flex: 1, overflow: 'auto' }}>
            <Table size="small" stickyHeader>
              <TableHead>
                <TableRow>
                  <TableCell>ID</TableCell>
                  <TableCell>Properties</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {visibleFeatures.map(feature => (
                  <TableRow
                    key={String(feature.id)}
                    hover
                    onClick={() => handleRowClick(feature)}
                    sx={{ cursor: 'pointer' }}
                  >
                    <TableCell sx={{ fontFamily: 'monospace', fontSize: '0.75rem' }}>
                      {String(feature.id)}
                    </TableCell>
                    <TableCell sx={{ fontSize: '0.75rem' }}>
                      {Object.keys(feature.properties ?? {}).length}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableContainer>
          {truncated && (
            <Typography
              variant="caption"
              color="text.secondary"
              sx={{ p: 1, textAlign: 'center', borderTop: '1px solid', borderColor: 'divider', flexShrink: 0 }}
            >
              Showing {visibleFeatures.length} of {filteredFeatures.length} features
            </Typography>
          )}
        </>
      )}
    </Box>
  )
}
