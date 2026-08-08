export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface MonitorInfo {
  id: number;
  x: number;
  y: number;
  width: number;
  height: number;
  scaleFactor: number;
  workX: number;
  workY: number;
  workWidth: number;
  workHeight: number;
  primary: boolean;
}

export interface DesktopWindow {
  id: number;
  title: string;
  owner: string;
  x: number;
  y: number;
  width: number;
  height: number;
  layer: number;
  onScreen: boolean;
}

export type EdgeKind = "screen-left" | "screen-right" | "screen-top" | "window-top" | "window-side";

export interface EdgeAnchor {
  kind: EdgeKind;
  x: number;
  y: number;
  facing: 1 | -1;
  label?: string;
}

export interface PointOfInterest {
  id: string;
  x: number;
  y: number;
  kind: "edge" | "window" | "corner" | "floor";
  score: number;
  anchor?: EdgeAnchor;
}

export interface WorldSnapshot {
  originX: number;
  originY: number;
  width: number;
  height: number;
  scaleFactor: number;
  monitors: MonitorInfo[];
  windows: DesktopWindow[];
  accessibilityTrusted: boolean;
  nearestWindow: DesktopWindow | null;
  nearestEdge: EdgeAnchor | null;
  points: PointOfInterest[];
  updatedAt: number;
}
