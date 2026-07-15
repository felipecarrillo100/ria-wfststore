import { FeaturePainter } from "@luciad/ria/view/feature/FeaturePainter.js";
import type { PaintState } from "@luciad/ria/view/feature/FeaturePainter.js";
import type { GeoCanvas } from "@luciad/ria/view/style/GeoCanvas.js";
import { Feature } from "@luciad/ria/model/feature/Feature.js";
import { Shape } from "@luciad/ria/shape/Shape.js";
import { ShapeType } from "@luciad/ria/shape/ShapeType.js";
import { Layer } from "@luciad/ria/view/Layer.js";
import type { LabelCanvas } from "@luciad/ria/view/style/LabelCanvas.js";
import { Map } from "@luciad/ria/view/Map.js";
import type { ShapeStyle } from "@luciad/ria/view/style/ShapeStyle.js";
import { DrapeTarget } from "@luciad/ria/view/style/DrapeTarget.js";

export interface ColorSet {
    normalStroke: string
    normalFill: string
    selectedStroke: string
    selectedFill: string
}

const DEFAULT_COLORS: ColorSet = {
    normalStroke:   'rgb(1,64,89)',
    normalFill:     'rgba(1,64,89,0.5)',
    selectedStroke: 'rgb(103,1,55)',
    selectedFill:   'rgba(103,1,55,0.5)',
}

interface ColourfulFeaturePainterOptions {
    labelProperty?: string
    showLabels?: boolean
    colorSet?: Partial<ColorSet>
}

function makePointIcon(fillColor: string, strokeColor: string, radius: number): HTMLCanvasElement {
    const size = (radius + 2) * 2
    const canvas = document.createElement('canvas')
    canvas.width = size
    canvas.height = size
    const ctx = canvas.getContext('2d')!
    ctx.beginPath()
    ctx.arc(size / 2, size / 2, radius, 0, Math.PI * 2)
    ctx.fillStyle = fillColor
    ctx.fill()
    ctx.strokeStyle = strokeColor
    ctx.lineWidth = 1.5
    ctx.stroke()
    return canvas
}

type PointIcons = {
    normal: HTMLCanvasElement
    hovered: HTMLCanvasElement
    selected: HTMLCanvasElement
    selectedHovered: HTMLCanvasElement
}

export class ColourfulFeaturePainter extends FeaturePainter {
    private readonly labelProperty: string
    private readonly showLabels: boolean
    private readonly _normalStyle: ShapeStyle
    private readonly _selectedStyle: ShapeStyle
    private readonly _colors: ColorSet
    private _pointIcons: PointIcons | null = null

    constructor(options: ColourfulFeaturePainterOptions = {}) {
        super()
        this.labelProperty = options.labelProperty ?? 'STATE_NAME'
        this.showLabels = options.showLabels ?? true
        this._colors = { ...DEFAULT_COLORS, ...options.colorSet }
        this._normalStyle = {
            drapeTarget: DrapeTarget.TERRAIN,
            stroke: { width: 2, color: this._colors.normalStroke },
            fill: { color: this._colors.normalFill },
        }
        this._selectedStyle = {
            drapeTarget: DrapeTarget.TERRAIN,
            stroke: { width: 2, color: this._colors.selectedStroke },
            fill: { color: this._colors.selectedFill },
        }
    }

    private getPointIcons(): PointIcons {
        if (!this._pointIcons) {
            const toRgba = (rgb: string, alpha: number) => {
                const m = rgb.match(/rgb\((\d+),\s*(\d+),\s*(\d+)\)/)
                return m ? `rgba(${m[1]},${m[2]},${m[3]},${alpha})` : rgb
            }
            const n = this._colors.normalStroke
            const s = this._colors.selectedStroke
            this._pointIcons = {
                normal:          makePointIcon(toRgba(n, 0.75), n, 5),
                hovered:         makePointIcon(toRgba(n, 0.9),  n, 7),
                selected:        makePointIcon(toRgba(s, 0.75), s, 6),
                selectedHovered: makePointIcon(toRgba(s, 0.9),  s, 8),
            }
        }
        return this._pointIcons
    }

    paintBody(geoCanvas: GeoCanvas, _feature: Feature, shape: Shape, _layer: Layer, _map: Map, paintState: PaintState): void {
        if (ShapeType.contains(shape.type, ShapeType.POINT)) {
            const icons = this.getPointIcons()
            const image = paintState.selected
                ? (paintState.hovered ? icons.selectedHovered : icons.selected)
                : (paintState.hovered ? icons.hovered : icons.normal)
            geoCanvas.drawIcon(shape, { image, drapeTarget: DrapeTarget.TERRAIN })
            return
        }

        const style = paintState.selected
            ? JSON.parse(JSON.stringify(this._selectedStyle))
            : JSON.parse(JSON.stringify(this._normalStyle));

        if (paintState.hovered && style.stroke) {
            style.stroke.width = 4;
        }

        geoCanvas.drawShape(shape, style);
    }

    paintLabel(labelCanvas: LabelCanvas, feature: Feature, shape: Shape, _layer: Layer, _map: Map, _paintState: PaintState): void {
        if (!this.showLabels) return
        const name = feature.properties[this.labelProperty];
        const label = `<div class="painter_state_label"><span>${name}</span></div>`;
        labelCanvas.drawLabelInPath(label, shape, {});
    }
}
