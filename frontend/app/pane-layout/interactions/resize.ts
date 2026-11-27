import { clampRatio, computeNodeRect, computeSplitRatioBounds } from "../model/tree"
import {
  DEFAULT_LAYOUT_CONSTRAINTS,
  type LayoutConstraints,
  type LayoutNode,
  type RatioBounds,
  type SplitDirection,
  type ViewportSize,
} from "../model/types"

export interface SplitPixelMetrics {
  splitAxisStart: number
  splitAxisSize: number
  bounds: RatioBounds
  minPixels: number
  maxPixels: number
}

/**
 * Computes pixel start/size and ratio bounds for a SplitNode relative to the
 * layout container box.
 */
export function computeSplitPixelMetrics(
  root: LayoutNode,
  splitId: string,
  direction: SplitDirection,
  containerBox: { left: number; top: number; width: number; height: number },
  constraints: Pick<LayoutConstraints, "minPaneWidth" | "minPaneHeight"> = DEFAULT_LAYOUT_CONSTRAINTS,
): SplitPixelMetrics | null {
  const rect = computeNodeRect(root, splitId)
  if (!rect || containerBox.width <= 0 || containerBox.height <= 0) return null

  const viewport: ViewportSize = {
    width: containerBox.width,
    height: containerBox.height,
  }
  const bounds = computeSplitRatioBounds(root, splitId, viewport, constraints)
  const splitAxisStart =
    direction === "horizontal"
      ? containerBox.left + rect.x * containerBox.width
      : containerBox.top + rect.y * containerBox.height
  const splitAxisSize =
    direction === "horizontal"
      ? rect.width * containerBox.width
      : rect.height * containerBox.height

  if (splitAxisSize <= 0) return null

  return {
    splitAxisStart,
    splitAxisSize,
    bounds,
    minPixels: bounds.min * splitAxisSize,
    maxPixels: bounds.max * splitAxisSize,
  }
}

export function ratioFromPointerCoordinate(
  coordinate: number,
  metrics: SplitPixelMetrics,
): number {
  if (metrics.splitAxisSize <= 0) return 0.5
  const raw = (coordinate - metrics.splitAxisStart) / metrics.splitAxisSize
  return clampRatio(raw, metrics.bounds)
}

export function ratioFromKeyboardDelta(
  currentRatio: number,
  deltaPixels: number,
  metrics: SplitPixelMetrics,
): number {
  if (metrics.splitAxisSize <= 0) return currentRatio
  return clampRatio(currentRatio + deltaPixels / metrics.splitAxisSize, metrics.bounds)
}
