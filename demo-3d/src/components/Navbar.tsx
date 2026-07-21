import { useRef } from 'react'
import AppBar from '@mui/material/AppBar'
import Box from '@mui/material/Box'
import Toolbar from '@mui/material/Toolbar'
import Typography from '@mui/material/Typography'
import Button from '@mui/material/Button'
import { usePanelActions, useWindowManagerActions } from 'react-dockable-desktop'
import { WFSConnectForm } from './forms/connect/WFSConnectForm'
import {Ogc3DTilesConnectForm} from "./forms/connect/Ogc3DTilesConnectForm.tsx";

interface NavbarProps {
  isDark: boolean
  onToggleTheme: () => void
}

export function Navbar({ isDark, onToggleTheme }: NavbarProps) {
  const { openLeftPanel } = usePanelActions()
  const { openPanel } = useWindowManagerActions()
  const mapCounter = useRef(0)

  function handleConnect() {
    openLeftPanel(WFSConnectForm, {}, { title: 'Connect WFS', width: 340 })
  }

  function handle3DTileConnect() {
    openLeftPanel(Ogc3DTilesConnectForm, {}, { title: 'Connect 3D Tiles', width: 340 })
  }

  function handleNewMap() {
    mapCounter.current += 1
    openPanel(crypto.randomUUID(), 'ria-map', { title: `Map ${mapCounter.current}` })
  }

  return (
    <AppBar position="fixed" sx={{ zIndex: (theme) => theme.zIndex.appBar }}>
      <Toolbar>
        <Typography variant="h6" component="div" sx={{ mr: 2 }}>
          WFST Store Demo
        </Typography>
        <Button color="inherit" onClick={handleConnect}>
          Open WFS-T
        </Button>
        <Button color="inherit" onClick={handle3DTileConnect}>
          Open 3D Tiles
        </Button>

        <Box sx={{ flexGrow: 1 }} />
        <Button color="inherit" onClick={handleNewMap}>
          New Map
        </Button>
        <Button color="inherit" onClick={onToggleTheme}>
          {isDark ? 'Light' : 'Dark'}
        </Button>
      </Toolbar>
    </AppBar>
  )
}
