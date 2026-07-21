import type { SVGProps } from 'react'
import { LayerType } from './layerType'

type IconProps = SVGProps<SVGSVGElement> & { size?: number }

function Svg({ size = 16, children, ...props }: IconProps) {
  return (
    <svg viewBox="0 0 16 16" width={size} height={size} xmlns="http://www.w3.org/2000/svg" {...props}>
      {children}
    </svg>
  )
}

function WmsIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <rect x="1" y="1" width="6" height="6" fill="none" stroke="currentColor" strokeWidth="1.5" rx="0.5"/>
      <rect x="9" y="1" width="6" height="6" fill="none" stroke="currentColor" strokeWidth="1.5" rx="0.5"/>
      <rect x="1" y="9" width="6" height="6" fill="none" stroke="currentColor" strokeWidth="1.5" rx="0.5"/>
      <rect x="9" y="9" width="6" height="6" fill="none" stroke="currentColor" strokeWidth="1.5" rx="0.5"/>
    </Svg>
  )
}

function WmtsIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <rect x="1" y="1" width="6" height="6" fill="currentColor" rx="0.5"/>
      <rect x="9" y="1" width="6" height="6" fill="none" stroke="currentColor" strokeWidth="1.5" rx="0.5"/>
      <rect x="1" y="9" width="6" height="6" fill="none" stroke="currentColor" strokeWidth="1.5" rx="0.5"/>
      <rect x="9" y="9" width="6" height="6" fill="currentColor" rx="0.5"/>
    </Svg>
  )
}

function LtsIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <rect x="1.5" y="1.5" width="13" height="3.5" rx="1.75" fill="currentColor"/>
      <rect x="1.5" y="6.5" width="13" height="3.5" rx="1.75" fill="currentColor"/>
      <rect x="1.5" y="11.5" width="13" height="3.5" rx="1.75" fill="currentColor"/>
    </Svg>
  )
}

function WfsIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <polygon
        points="8,1 14.5,5.5 12.3,13 3.7,13 1.5,5.5"
        fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round"
      />
    </Svg>
  )
}

function Ogc3dTilesIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <polygon points="8,1 14,4.5 8,8 2,4.5" fill="currentColor"/>
      <polygon points="2,4.5 8,8 8,14 2,10.5" fill="currentColor" opacity="0.6"/>
      <polygon points="14,4.5 8,8 8,14 14,10.5" fill="currentColor" opacity="0.35"/>
    </Svg>
  )
}

function HspcIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <circle cx="3.5" cy="5"    r="1.2" fill="currentColor"/>
      <circle cx="7"   cy="2.5"  r="1.2" fill="currentColor"/>
      <circle cx="12"  cy="4"    r="1.2" fill="currentColor"/>
      <circle cx="5"   cy="9.5"  r="1.2" fill="currentColor"/>
      <circle cx="10"  cy="8"    r="1.2" fill="currentColor"/>
      <circle cx="14"  cy="11"   r="1.2" fill="currentColor"/>
      <circle cx="4.5" cy="13.5" r="1.2" fill="currentColor"/>
      <circle cx="9.5" cy="13"   r="1.2" fill="currentColor"/>
    </Svg>
  )
}

function PanoramaIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <circle cx="8" cy="8" r="6.5" fill="none" stroke="currentColor" strokeWidth="1.5"/>
      <path d="M1.5,8 Q8,4.5 14.5,8" fill="none" stroke="currentColor" strokeWidth="1.2"/>
      <path d="M1.5,8 Q8,11.5 14.5,8" fill="none" stroke="currentColor" strokeWidth="1.2"/>
      <circle cx="8" cy="8" r="1.5" fill="currentColor"/>
    </Svg>
  )
}

function FeatureIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path
        d="M8,1.5 C5.5,1.5 3.5,3.5 3.5,6.5 C3.5,10 8,14.5 8,14.5 C8,14.5 12.5,10 12.5,6.5 C12.5,3.5 10.5,1.5 8,1.5 Z"
        fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round"
      />
      <circle cx="8" cy="6.5" r="1.8" fill="currentColor"/>
    </Svg>
  )
}

function UnknownIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path
        d="M8,1.5 L14.5,8 L8,14.5 L1.5,8 Z"
        fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round"
      />
      <circle cx="8" cy="8" r="1.5" fill="currentColor"/>
    </Svg>
  )
}

interface LayerTypeIconProps extends IconProps {
  type: LayerType
}

export function LayerTypeIcon({ type, ...props }: LayerTypeIconProps) {
  switch (type) {
    case LayerType.WMS:          return <WmsIcon {...props} />
    case LayerType.WMTS:         return <WmtsIcon {...props} />
    case LayerType.LTS:          return <LtsIcon {...props} />
    case LayerType.WFS:          return <WfsIcon {...props} />
    case LayerType.OGC_3D_TILES: return <Ogc3dTilesIcon {...props} />
    case LayerType.HSPC:         return <HspcIcon {...props} />
    case LayerType.PANORAMA:     return <PanoramaIcon {...props} />
    case LayerType.FEATURE:      return <FeatureIcon {...props} />
    default:                     return <UnknownIcon {...props} />
  }
}
