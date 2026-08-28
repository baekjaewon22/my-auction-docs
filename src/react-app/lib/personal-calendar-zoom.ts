export const PERSONAL_CALENDAR_BASE_WIDTH = 700;
export const PERSONAL_CALENDAR_DESKTOP_MIN_ZOOM = 0.8;
export const PERSONAL_CALENDAR_DESKTOP_MAX_ZOOM = 1.4;
export const PERSONAL_CALENDAR_MOBILE_MAX_ZOOM = 1.8;

export function clampPersonalCalendarZoom(value: number, minimum: number, maximum: number): number {
  if (!Number.isFinite(value)) return minimum;
  return Math.min(maximum, Math.max(minimum, value));
}

export function getPersonalCalendarFitZoom(
  viewportWidth: number,
  baseWidth = PERSONAL_CALENDAR_BASE_WIDTH,
): number {
  if (!Number.isFinite(viewportWidth) || viewportWidth <= 0 || !Number.isFinite(baseWidth) || baseWidth <= 0) {
    return 1;
  }
  return Math.min(1, viewportWidth / baseWidth);
}

export function getPersonalCalendarCanvasWidth(
  viewportWidth: number,
  zoom: number,
  baseWidth = PERSONAL_CALENDAR_BASE_WIDTH,
): number {
  if (!Number.isFinite(viewportWidth) || viewportWidth <= 0) return 0;
  const logicalWidth = Math.max(viewportWidth, baseWidth);
  return Math.max(viewportWidth, Math.round(logicalWidth * zoom));
}

export function getPersonalCalendarScrollForZoom(
  scrollLeft: number,
  anchorX: number,
  currentZoom: number,
  nextZoom: number,
): number {
  if (currentZoom <= 0 || !Number.isFinite(currentZoom) || !Number.isFinite(nextZoom)) return Math.max(0, scrollLeft);
  const logicalAnchor = (Math.max(0, scrollLeft) + Math.max(0, anchorX)) / currentZoom;
  return Math.max(0, logicalAnchor * nextZoom - Math.max(0, anchorX));
}
