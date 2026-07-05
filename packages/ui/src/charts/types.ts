import type { ReactNode } from 'react'

/** A single point in a continuous series (line/area/sparkline). `x` is numeric — an index, a day
 *  bucket, or an epoch-ms timestamp; the chart only needs it ordered and numeric. */
export interface SeriesPoint {
  x: number
  y: number
}

/** A categorical bar — a labeled value (bar/column charts). */
export interface BarDatum {
  label: string
  value: number
  /** Optional explicit color (theme `.val` hex). Defaults to the chart's accent. */
  color?: string
}

/** Format a numeric value for an axis tick or a tooltip (e.g. `(v) => `${Math.round(v*100)}%`). */
export type ValueFormat = (value: number) => string

/** Plot-area handles handed to a {@link ChartFrame} child: pixel scales + inner dimensions. */
export interface PlotContext {
  /** Domain-x → pixel-x within the plot area. */
  xScale: (v: number) => number
  /** Domain-y → pixel-y within the plot area (inverted: larger y is higher on screen). */
  yScale: (v: number) => number
  /** Plot-area width in px (inside the axis margins). */
  innerW: number
  /** Plot-area height in px (inside the axis margins). */
  innerH: number
}

/** Render-prop signature for a chart's marks, given the resolved plot scales. */
export type PlotChildren = (plot: PlotContext) => ReactNode
