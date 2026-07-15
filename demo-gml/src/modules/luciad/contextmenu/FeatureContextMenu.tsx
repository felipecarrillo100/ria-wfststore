import FitScreenIcon from '@mui/icons-material/FitScreen'
import EditIcon from '@mui/icons-material/Edit'
import TuneIcon from '@mui/icons-material/Tune'
import DeleteIcon from '@mui/icons-material/Delete'
import LockOutlinedIcon from '@mui/icons-material/LockOutlined'
import type { ReactElement } from 'react'
import type { ContextMenu as LuciadContextMenu } from '@luciad/ria/view/ContextMenu.js'
import type { Feature } from '@luciad/ria/model/feature/Feature.js'
import type { RIAMap } from '@luciad/ria/view/RIAMap.js'

export function populateWfsContextMenu(
  contextMenu: LuciadContextMenu,
  features: Feature[],
  wfst: boolean,
  map: RIAMap,
  onEditProperties?: (feature: Feature) => void,
  onEditGeometry?: (feature: Feature) => void,
  onDeleteFeature?: (features: Feature[]) => void,
  onEditWithLock?: (features: Feature[]) => void,
): void {
  if (features.length === 0) return

  const multi = features.length > 1
  const feature = features[0]

  // Fit to feature — single only (no meaningful bounds for a multi-selection)
  if (!multi) {
    contextMenu.addItem({
      id: 'wfs-fit',
      label: 'Fit to feature',
      action: () => {
        const bounds = feature.shape?.bounds
        if (bounds) map.mapNavigator.fit({ bounds, animate: true })
      },
    })
  }

  if (wfst) {
    // Geometry/property editing — single only (ambiguous for multiple)
    if (!multi) {
      contextMenu.addSeparator()
      contextMenu.addItem({
        id: 'wfs-edit-geom', label: 'Edit geometry',
        action: () => { onEditGeometry?.(feature) },
      })
      contextMenu.addItem({
        id: 'wfs-edit-props', label: 'Edit properties',
        action: () => { onEditProperties?.(feature) },
      })
    }

    // Delete — works for one or many
    contextMenu.addSeparator()
    contextMenu.addItem({
      id: 'wfs-delete',
      label: multi ? `Delete ${features.length} features` : 'Delete feature',
      action: () => { onDeleteFeature?.(features) },
    })

    // Edit with Lock — works for one or many
    contextMenu.addSeparator()
    contextMenu.addItem({
      id: 'wfs-edit-lock',
      label: multi ? `Edit ${features.length} features with Lock` : 'Edit with Lock',
      action: () => { onEditWithLock?.(features) },
    })
  }
}

/** React icons keyed by LuciadRIA item id — merged during RDD translation. */
export const WFS_CONTEXT_MENU_ICONS: Record<string, ReactElement> = {
  'wfs-fit':        <FitScreenIcon fontSize="small" />,
  'wfs-edit-geom':  <EditIcon fontSize="small" />,
  'wfs-edit-props': <TuneIcon fontSize="small" />,
  'wfs-delete':     <DeleteIcon fontSize="small" />,
  'wfs-edit-lock':  <LockOutlinedIcon fontSize="small" />,
}
