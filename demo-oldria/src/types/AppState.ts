export interface MapCameraState {
  eye: { x: number; y: number; z: number }
  yaw: number
  pitch: number
  roll: number
}

export interface AppState {
  layout: string
  maps: Record<string, MapCameraState>
}

export type DrawTool = 'select' | 'point' | 'line' | 'polygon'
