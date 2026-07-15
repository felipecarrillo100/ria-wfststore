import { WorkspaceClient } from 'react-dockable-desktop'
import { MainMapPanel } from './components/MainMapPanel'

const baseMapOptions = {
  initialTarget: 'docked' as const,
  favoritePosition: { x: 0, y: 0, width: 1200, height: 800 },
}

export const workspace = new WorkspaceClient({
  panels: {
    'main-map': {
      component: MainMapPanel,
      defaultOptions: { ...baseMapOptions, title: 'Main Map', canDrag: false, canMinimize: false, canClose: false },
    },
    'ria-map': {
      component: MainMapPanel,
      defaultOptions: { ...baseMapOptions, title: 'Map', canDrag: true, canMinimize: true, canClose: true },
    },
  },
})
