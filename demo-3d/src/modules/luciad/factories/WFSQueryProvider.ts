import { QueryProvider } from '@luciad/ria/view/feature/QueryProvider.js'
import type { FeatureLayer } from '@luciad/ria/view/feature/FeatureLayer.js'
import type { RIAMap } from '@luciad/ria/view/RIAMap.js'

export const TypicalWmsScaleRanges: number[] = [
  1.0 / 4.0e6,
  1.0 / 2.0e6,
  1.0 / 1.0e6,
  1.0 / 5.0e5,
  1.0 / 2.5e5,
  1.0 / 1.5e7,
  1.0 / 7.0e4,
  1.0 / 3.5e4,
  1.0 / 1.5e4,
  1.0 / 8.0e3,
  1.0 / 4.0e3,
  1.0 / 2.0e3,
  1.0 / 1.0e3,
  1.0 / 5.0e2,
]

const FILTER_NO_RESTRICTIONS: any = null

// N scale ranges → N+1 query levels, all with no filter restriction.
const TypicalWMSScaleQueries: any[] = []
for (let i = 0; i < TypicalWmsScaleRanges.length; ++i) {
  TypicalWMSScaleQueries.push({ filter: FILTER_NO_RESTRICTIONS })
}
TypicalWMSScaleQueries.push({ filter: FILTER_NO_RESTRICTIONS })

export class WFSQueryProvider extends QueryProvider {
  private readonly _scaleRanges: number[]
  private readonly _queries: any[]

  constructor(maxFeatures = 500) {
    super()
    this._scaleRanges = TypicalWmsScaleRanges
    this._queries = TypicalWMSScaleQueries.map(q => ({ filter: q.filter, maxFeatures }))
  }

  override getQueryForLevel(level: number): any {
    if (level < this._queries.length) return this._queries[level]
    return this._queries[this._queries.length - 1]
  }

  override getQueryLevelScales(_layer?: FeatureLayer, _map?: RIAMap): number[] {
    return this._scaleRanges
  }
}
