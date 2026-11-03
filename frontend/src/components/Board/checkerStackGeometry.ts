export const POINT_CHECKER_LIMIT = 5;
export const BAR_CHECKER_LIMIT = 3;
export const CHECKER_STACK_CLEARANCE_PX = 8;

export interface PointStackMetrics {
  diameter: number;
  height: number;
  paddingTop: number;
  paddingBottom: number;
  gap: number;
}

export interface BarStackMetrics {
  diameter: number;
  height: number;
}

export function pointStackMetrics(
  width: number,
  height: number,
  paddingTop: number,
  paddingBottom: number,
  gap: number,
): PointStackMetrics {
  const room = Math.max(0, height - paddingTop - paddingBottom - CHECKER_STACK_CLEARANCE_PX);
  const safeGap = Math.max(0, gap);
  // Four complete disks must fit before a fifth checker needs to overlap.
  const fourCheckerDiameter = (room - safeGap * 3) / 4;
  return {
    diameter: Math.max(0, Math.floor(Math.min(width * 0.95, fourCheckerDiameter))),
    height,
    paddingTop,
    paddingBottom,
    gap: safeGap,
  };
}

/** Use the logical count, including any checker temporarily hidden by a flight. */
export function pointStackOffset(metrics: PointStackMetrics, count: number, index: number, top: boolean): number {
  const visible = Math.min(POINT_CHECKER_LIMIT, Math.max(1, count));
  const room = Math.max(0, metrics.height - metrics.paddingTop - metrics.paddingBottom - CHECKER_STACK_CLEARANCE_PX);
  const step = visible > 1
    ? Math.min(metrics.diameter + metrics.gap, Math.max(0, (room - metrics.diameter) / (visible - 1)))
    : 0;
  const slot = Math.min(Math.max(0, index), visible - 1);
  return top
    ? metrics.paddingTop + slot * step
    : metrics.height - metrics.paddingBottom - metrics.diameter - slot * step;
}

export function barStackMetrics(width: number, height: number): BarStackMetrics {
  return { diameter: Math.max(0, Math.floor(Math.min(width * 0.9, height))), height };
}

export function barStackOffset(metrics: BarStackMetrics, count: number, index: number): number {
  const visible = Math.min(BAR_CHECKER_LIMIT, Math.max(1, count));
  const room = Math.max(0, metrics.height - metrics.diameter);
  if (visible === 1) return room / 2;
  return Math.min(Math.max(0, index), visible - 1) * room / (visible - 1);
}
