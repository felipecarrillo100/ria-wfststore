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

// 'arc' and 'circle' both create a circular Arc shape (never a true Circle) - see
// DrawToolsHelper.ts for why: this demo connects over GML specifically to exercise native
// Circle/Arc encoding, and the WFS-T server used for it (LuciadFusion) converts a closed
// CircleByCenterPoint curve into a filled Polygon boundary on output, which isn't decodable
// and defeats the point of the demo. A full-360-degree-sweep Arc round-trips correctly instead.
export type DrawTool = 'select' | 'point' | 'line' | 'polygon' | 'arc' | 'circle'
