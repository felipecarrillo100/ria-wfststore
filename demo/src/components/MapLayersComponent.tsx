import { useCallback, useEffect, useState, type DragEvent, type MouseEvent } from 'react'
import Box from '@mui/material/Box'
import List from '@mui/material/List'
import ListItem from '@mui/material/ListItem'
import IconButton from '@mui/material/IconButton'
import Tooltip from '@mui/material/Tooltip'
import Typography from '@mui/material/Typography'
import VisibilityIcon from '@mui/icons-material/Visibility'
import VisibilityOffIcon from '@mui/icons-material/VisibilityOff'
import FolderOpenIcon from '@mui/icons-material/FolderOpen'
import FolderIcon from '@mui/icons-material/Folder'
import ExpandMoreIcon from '@mui/icons-material/ExpandMore'
import ChevronRightIcon from '@mui/icons-material/ChevronRight'
import MoreVertIcon from '@mui/icons-material/MoreVert'
import DeleteIcon from '@mui/icons-material/Delete'
import Recycling from '@mui/icons-material/Recycling'
import { type ContextMenuItem, useWindowManagerActions } from 'react-dockable-desktop'
import { RIAMap } from '@luciad/ria/view/RIAMap.js'
import { LayerTreeNode } from '@luciad/ria/view/LayerTreeNode.js'
import { LayerGroup } from '@luciad/ria/view/LayerGroup.js'
import { LayerTreeNodeType } from '@luciad/ria/view/LayerTreeNodeType.js'
import { FeatureLayer } from '@luciad/ria/view/feature/FeatureLayer.js'
import { useLuciadMapContext } from '../context/LuciadMapContext'
import { getLayerType } from './layerType'
import { LayerTypeIcon } from './LayerTypeIcons'

interface MapLayersComponentProps {
  map: RIAMap | undefined
  panelId: string
}

function useLayerTreeVersion(map: RIAMap | undefined): number {
  const [version, setVersion] = useState(0)
  useEffect(() => {
    if (!map) return
    const bump = () => setVersion(v => v + 1)
    const handles = [
      map.layerTree.on('NodeAdded', bump),
      map.layerTree.on('NodeRemoved', bump),
      map.layerTree.on('NodeMoved', bump),
    ]
    return () => handles.forEach(h => h.remove())
  }, [map])
  return version
}

function useNodeVisibility(node: LayerTreeNode): boolean {
  const [visible, setVisible] = useState(node.visible)
  useEffect(() => {
    setVisible(node.visible)
    const handle = node.on('VisibilityChanged', (v: boolean) => setVisible(v))
    return () => handle.remove()
  }, [node])
  return visible
}

type DropZone = 'above' | 'below' | 'into' | null

const ROW_H = 30
const INDENT = 16
const ICON_SZ = 16

interface LayerRowProps {
  node: LayerTreeNode
  depth: number
  map: RIAMap
  currentLayerId: string | null
  onMenu: (e: MouseEvent, items: ContextMenuItem[]) => void
  onSelectLayer: (node: LayerTreeNode) => void
}

function LayerRow({ node, depth, map, currentLayerId, onMenu, onSelectLayer }: LayerRowProps) {
  const visible = useNodeVisibility(node)
  const isGroup = node.treeNodeType === LayerTreeNodeType.LAYER_GROUP
  const layerType = getLayerType(node)
  const [expanded, setExpanded] = useState(true)
  const [dropZone, setDropZone] = useState<DropZone>(null)
  const isSelected = !isGroup && currentLayerId === node.id

  const toggleVisibility = (e: MouseEvent) => {
    e.stopPropagation()
    node.visible = !node.visible
  }

  const toggleExpand = (e: MouseEvent) => {
    e.stopPropagation()
    if (isGroup) setExpanded(x => !x)
  }

  const handleMenuClick = (e: MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
    const items: ContextMenuItem[] = [
      {
        label: 'Delete layer',
        icon: <DeleteIcon fontSize="small" />,
        action: () => node.parent?.removeChild(node),
      },
      {
        label: 'Relaod layer',
        icon: <Recycling fontSize="small" />,
        action: () => {
          if (node instanceof FeatureLayer) {
            node.loadingStrategy.queryProvider.invalidate();
            node.painter?.invalidateAll();
          }
        },
      },
    ]
    onMenu(e, items)
  }

  const handleClick = () => {
    if (!isGroup) onSelectLayer(node)
  }

  const onDragStart = (e: DragEvent<HTMLLIElement>) => {
    e.dataTransfer.effectAllowed = 'move'
    e.dataTransfer.setData('text/plain', node.id)
    e.stopPropagation()
  }

  const computeZone = (e: DragEvent<HTMLLIElement>): DropZone => {
    const rect = e.currentTarget.getBoundingClientRect()
    const rel = (e.clientY - rect.top) / rect.height
    if (isGroup) {
      if (rel < 0.25) return 'above'
      if (rel > 0.75) return 'below'
      return 'into'
    }
    return rel < 0.5 ? 'above' : 'below'
  }

  const onDragOver = (e: DragEvent<HTMLLIElement>) => {
    e.preventDefault()
    e.stopPropagation()
    setDropZone(computeZone(e))
  }

  const onDragLeave = (e: DragEvent<HTMLLIElement>) => {
    if (!e.currentTarget.contains(e.relatedTarget as Node)) setDropZone(null)
  }

  const onDrop = (e: DragEvent<HTMLLIElement>) => {
    e.preventDefault()
    e.stopPropagation()
    const zone = computeZone(e)
    setDropZone(null)
    const draggedId = e.dataTransfer.getData('text/plain')
    if (!draggedId || draggedId === node.id) return
    const toMove = map.layerTree.findLayerTreeNodeById(draggedId)
    if (!toMove) return
    try {
      if (zone === 'into') {
        (node as LayerGroup).moveChild(toMove, 'top')
      } else if (zone === 'above') {
        node.parent?.moveChild(toMove, 'above', node)
      } else if (zone === 'below') {
        node.parent?.moveChild(toMove, 'below', node)
      }
    } catch {
      // ignore invalid moves (e.g. ancestor into descendant)
    }
  }

  const children = isGroup ? [...(node as LayerGroup).children].reverse() : []

  return (
    <>
      <ListItem
        disableGutters
        draggable
        onClick={handleClick}
        onContextMenu={handleMenuClick}
        onDragStart={onDragStart}
        onDragOver={onDragOver}
        onDragLeave={onDragLeave}
        onDrop={onDrop}
        onDragEnd={() => setDropZone(null)}
        sx={{
          height: ROW_H,
          pl: `${depth * INDENT + 4}px`,
          pr: 0.5,
          gap: 0,
          cursor: isGroup ? 'grab' : 'pointer',
          position: 'relative',
          outline: isSelected ? '2px solid' : 'none',
          outlineColor: 'primary.main',
          outlineOffset: '-2px',
          bgcolor: dropZone === 'into' ? 'action.selected' : 'transparent',
          '&:hover': { bgcolor: dropZone === 'into' ? 'action.selected' : 'action.hover' },
          '&:hover .layer-row-menu': { opacity: 1 },
          '&:active': { cursor: isGroup ? 'grabbing' : 'pointer' },
          '&::before': {
            content: '""',
            position: 'absolute',
            top: 0, left: 0, right: 0,
            height: '2px',
            bgcolor: dropZone === 'above' ? 'primary.main' : 'transparent',
            zIndex: 1,
          },
          '&::after': {
            content: '""',
            position: 'absolute',
            bottom: 0, left: 0, right: 0,
            height: '2px',
            bgcolor: dropZone === 'below' ? 'primary.main' : 'transparent',
            zIndex: 1,
          },
        }}
      >
        {/* Expand/collapse — reserves space for alignment */}
        <Box sx={{ width: 20, height: ROW_H, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          {isGroup && (
            <IconButton size="small" onClick={toggleExpand} tabIndex={-1}
              sx={{ p: 0, color: 'text.secondary', '&:hover': { bgcolor: 'transparent', color: 'text.primary' } }}>
              {expanded
                ? <ExpandMoreIcon sx={{ fontSize: ICON_SZ }} />
                : <ChevronRightIcon sx={{ fontSize: ICON_SZ }} />}
            </IconButton>
          )}
        </Box>

        {/* Type icon */}
        <Box sx={{ width: 22, height: ROW_H, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', color: isGroup ? 'primary.main' : 'text.secondary' }}>
          {isGroup
            ? (expanded ? <FolderOpenIcon sx={{ fontSize: ICON_SZ }} /> : <FolderIcon sx={{ fontSize: ICON_SZ }} />)
            : <LayerTypeIcon type={layerType} size={ICON_SZ} />}
        </Box>

        {/* Label */}
        <Typography noWrap sx={{
          flex: 1,
          minWidth: 0,
          fontSize: '0.8125rem',
          lineHeight: `${ROW_H}px`,
          color: 'text.primary',
          opacity: visible ? 1 : 0.45,
          pl: 0.75,
          letterSpacing: 0,
        }}>
          {node.label}
        </Typography>

        {/* 3-dot menu */}
        <IconButton
          className="layer-row-menu"
          size="small"
          onClick={handleMenuClick}
          tabIndex={-1}
          sx={{
            p: 0.25,
            flexShrink: 0,
            opacity: 0,
            transition: 'opacity 0.15s',
            color: 'text.secondary',
            '&:hover': { bgcolor: 'transparent', color: 'text.primary' },
          }}
        >
          <MoreVertIcon sx={{ fontSize: ICON_SZ }} />
        </IconButton>

        {/* Visibility toggle */}
        <Tooltip title={visible ? 'Hide layer' : 'Show layer'} placement="left" disableInteractive>
          <IconButton
            size="small"
            onClick={toggleVisibility}
            tabIndex={-1}
            sx={{
              p: 0.25,
              flexShrink: 0,
              color: visible ? 'primary.main' : 'action.disabled',
              '&:hover': { bgcolor: 'transparent', color: visible ? 'primary.dark' : 'text.secondary' },
            }}
          >
            {visible ? <VisibilityIcon sx={{ fontSize: ICON_SZ }} /> : <VisibilityOffIcon sx={{ fontSize: ICON_SZ }} />}
          </IconButton>
        </Tooltip>
      </ListItem>

      {isGroup && expanded && children.map(child => (
        <LayerRow
          key={child.id}
          node={child}
          depth={depth + 1}
          map={map}
          currentLayerId={currentLayerId}
          onMenu={onMenu}
          onSelectLayer={onSelectLayer}
        />
      ))}
    </>
  )
}

export function MapLayersComponent({ map, panelId }: MapLayersComponentProps) {
  useLayerTreeVersion(map)
  const { showContextMenu } = useWindowManagerActions()
  const { currentLayers, setCurrentLayer } = useLuciadMapContext()
  const currentLayer = currentLayers[panelId] ?? null

  const openMenu = useCallback((e: MouseEvent, items: ContextMenuItem[]) => {
    showContextMenu?.({ x: e.clientX, y: e.clientY, items })
  }, [showContextMenu])

  const handleSelectLayer = useCallback((node: LayerTreeNode) => {
    if (node.treeNodeType !== LayerTreeNodeType.LAYER_GROUP) {
      setCurrentLayer(panelId, node as FeatureLayer)
    }
  }, [panelId, setCurrentLayer])

  if (!map) {
    return (
      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'center', py: 4, bgcolor: 'background.paper' }}>
        <Typography variant="caption" color="text.disabled">No map</Typography>
      </Box>
    )
  }

  // LuciadRIA children are bottom-first; reverse so top-rendered layer appears first
  const topNodes = [...map.layerTree.children].reverse()

  if (topNodes.length === 0) {
    return (
      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'center', py: 4, bgcolor: 'background.paper' }}>
        <Typography variant="caption" color="text.disabled">No layers</Typography>
      </Box>
    )
  }

  return (
    <Box sx={{ userSelect: 'none', bgcolor: 'background.paper' }}>
      <List dense disablePadding>
        {topNodes.map(node => (
          <LayerRow
            key={node.id}
            node={node}
            depth={0}
            map={map}
            currentLayerId={currentLayer?.id ?? null}
            onMenu={openMenu}
            onSelectLayer={handleSelectLayer}
          />
        ))}
      </List>
    </Box>
  )
}
