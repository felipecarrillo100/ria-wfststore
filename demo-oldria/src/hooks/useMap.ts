import type { WebGLMap as RIAMap } from '@luciad/ria/view/WebGLMap.js'
import { useLuciadMapContext } from '../context/LuciadMapContext'

export function useMap(id: string): RIAMap | undefined {
  return useLuciadMapContext().maps[id]
}
