export interface GeoPoint {
  readonly lat: number
  readonly lon: number
}

export interface ResourceTrackingMeta {
  readonly location: GeoPoint
  readonly altitudeFt: number | null
  readonly heading: number | null
  readonly speedKt: number | null
  readonly timestamp: number
  readonly source: string
  readonly label: string
  readonly stale: boolean
}

export interface AssetTrackerPosition {
  readonly id: string
  readonly lat: number
  readonly lon: number
  readonly altitude: number | null
  readonly heading: number | null
  readonly speed: number | null
  readonly timestamp: number
  readonly source: string
  readonly label: string
  readonly meta?: Readonly<Record<string, unknown>>
}
