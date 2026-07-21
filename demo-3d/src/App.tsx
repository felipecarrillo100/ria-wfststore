import { useEffect, useRef, useState, useMemo } from 'react'
import CssBaseline from '@mui/material/CssBaseline'
import Box from '@mui/material/Box'
import { ThemeProvider, createTheme } from '@mui/material/styles'
import {
  DockableDesktopProvider,
  WindowManager,
  SidePanelRenderer,
  ModalStackRenderer,
  Toolbar,
  useToolbar,
  type ToolbarItem,
} from 'react-dockable-desktop'
import PlaceOutlinedIcon from '@mui/icons-material/PlaceOutlined'
import PolylineOutlinedIcon from '@mui/icons-material/PolylineOutlined'
import HexagonOutlinedIcon from '@mui/icons-material/HexagonOutlined'
import PlaceIcon from '@mui/icons-material/Place'
import PolylineIcon from '@mui/icons-material/Polyline'
import HexagonIcon from '@mui/icons-material/Hexagon'
import { LuciadMapProvider, useLuciadMapContext } from './context/LuciadMapContext'
import { Navbar } from './components/Navbar'
import { workspace } from './workspace'
import { mapCommandBus } from './mapCommandBus'
import type { DrawTool } from './types/AppState'

export default function App() {
  return (
    <LuciadMapProvider>
      <DockableDesktopProvider client={workspace}>
        <AppContent />
      </DockableDesktopProvider>
    </LuciadMapProvider>
  )
}

function AppContent() {
  const [mode, setMode] = useState<'light' | 'dark'>('dark')
  const theme = useMemo(() => createTheme({ palette: { mode } }), [mode])

  useEffect(() => {
    document.documentElement.setAttribute('data-color-scheme', mode)
  }, [mode])

  const opened = useRef(false)
  useEffect(() => {
    if (opened.current) return
    opened.current = true
    workspace.openPanel(crypto.randomUUID(), 'main-map', { initialTarget: 'docked' })
  }, [])

  const { currentlySelectedId, activeDrawTool } = useLuciadMapContext()
  const toolbar = useToolbar()

  // Mirror the active map's draw tool state into the toolbar highlight
  useEffect(() => {
    toolbar.setActiveInGroup('draw-tools', activeDrawTool)
  }, [activeDrawTool]) // toolbar ref is stable

  function dispatchDrawTool(tool: DrawTool) {
    if (!currentlySelectedId) return
    mapCommandBus.dispatch({ type: 'SET_DRAW_TOOL', payload: { tool, panelId: currentlySelectedId } })
  }

  function dispatch3DEditTool(tool: 'point3d' | 'line3d' | 'polygon3d') {
    if (!currentlySelectedId) return
    mapCommandBus.dispatch({ type: 'SET_3D_EDIT_TOOL', payload: { tool, panelId: currentlySelectedId } })
  }

  const drawToolbarItems: ToolbarItem[] = [
    {
      type: 'radio',
      id: 'select',
      group: 'draw-tools',
      label: 'Select',
      icon: (
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
          <path d="M3 2l9 5.5-4 1L6.5 13 3 2z" />
        </svg>
      ),
      onActivate: () => dispatchDrawTool('select'),
    },
    { type: 'separator' },
    {
      type: 'radio',
      id: 'point',
      group: 'draw-tools',
      label: 'Create point',
      icon: <PlaceOutlinedIcon sx={{ fontSize: 16 }} />,
      onActivate: () => dispatchDrawTool('point'),
    },
    {
      type: 'radio',
      id: 'line',
      group: 'draw-tools',
      label: 'Create line',
      icon: <PolylineOutlinedIcon sx={{ fontSize: 16 }} />,
      onActivate: () => dispatchDrawTool('line'),
    },
    {
      type: 'radio',
      id: 'polygon',
      group: 'draw-tools',
      label: 'Create polygon',
      icon: <HexagonOutlinedIcon sx={{ fontSize: 16 }} />,
      onActivate: () => dispatchDrawTool('polygon'),
    },
    { type: 'separator' },
    {
      type: 'radio',
      id: 'point3d',
      group: 'draw-tools',
      label: 'Create 3D point (with height editing)',
      icon: <PlaceIcon sx={{ fontSize: 16 }} />,
      onActivate: () => dispatch3DEditTool('point3d'),
    },
    {
      type: 'radio',
      id: 'line3d',
      group: 'draw-tools',
      label: 'Create 3D line (with height editing)',
      icon: <PolylineIcon sx={{ fontSize: 16 }} />,
      onActivate: () => dispatch3DEditTool('line3d'),
    },
    {
      type: 'radio',
      id: 'polygon3d',
      group: 'draw-tools',
      label: 'Create 3D polygon (with height editing)',
      icon: <HexagonIcon sx={{ fontSize: 16 }} />,
      onActivate: () => dispatch3DEditTool('polygon3d'),
    },
  ]

  return (
    <ThemeProvider theme={theme}>
      <CssBaseline />
      <ModalStackRenderer />
      <Box sx={{ display: 'flex', flexDirection: 'column', height: '100vh', width: '100vw', overflow: 'hidden' }}>
        <Navbar isDark={mode === 'dark'} onToggleTheme={() => setMode(m => m === 'light' ? 'dark' : 'light')} />
        <Box sx={{ flexGrow: 1, mt: '64px', display: 'flex', overflow: 'hidden' }}>
          <Toolbar position="left" items={drawToolbarItems} />
          <Box sx={{ flexGrow: 1, position: 'relative', overflow: 'hidden' }}>
            <WindowManager skin="vscode" taskbarVisibility="always" />
            <SidePanelRenderer />
          </Box>
        </Box>
      </Box>
    </ThemeProvider>
  )
}
