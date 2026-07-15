import type { RIAMap } from '@luciad/ria/view/RIAMap.js'
import { useLuciadMapContext } from '../context/LuciadMapContext'

export function useMap(id: string): RIAMap | undefined {
  return useLuciadMapContext().maps[id]
}
