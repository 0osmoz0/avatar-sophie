/**
 * Modèle du monde : observation périodique du bureau.
 */

import type { Body } from "../motion/Body";
import {
  accessibilityStatus,
  desktopUnion,
  listWindows,
  type WorkArea,
} from "../platform/tauri";
import type {
  DesktopWindow,
  EdgeAnchor,
  MonitorInfo,
  PointOfInterest,
  WorldSnapshot,
} from "./types";

const REFRESH_MS = 200;

export class WorldModel {
  #originX = 0;
  #originY = 0;
  #width = 1280;
  #height = 800;
  #scaleFactor = 2;
  #monitors: MonitorInfo[] = [];
  #windows: DesktopWindow[] = [];
  #accessibilityTrusted = false;
  #lastFetch = 0;
  #inflight = false;
  #snapshot: WorldSnapshot;

  constructor(area: WorkArea) {
    this.#originX = area.x;
    this.#originY = area.y;
    this.#width = area.width;
    this.#height = area.height;
    this.#scaleFactor = area.scaleFactor;
    this.#snapshot = this.#buildSnapshot(0, 0);
  }

  get snapshot(): WorldSnapshot {
    return this.#snapshot;
  }

  get width(): number {
    return this.#width;
  }

  get height(): number {
    return this.#height;
  }

  get scaleFactor(): number {
    return this.#scaleFactor;
  }

  get originX(): number {
    return this.#originX;
  }

  get originY(): number {
    return this.#originY;
  }

  floorYAt(localX: number): number {
    const deskX = localX + this.#originX;
    for (const m of this.#monitors) {
      if (deskX >= m.workX && deskX <= m.workX + m.workWidth) {
        return m.workY + m.workHeight - this.#originY;
      }
    }
    return this.#height;
  }

  async bootstrap(): Promise<void> {
    await this.refresh(true);
  }

  async refresh(force = false): Promise<void> {
    const now = performance.now();
    if (!force && (this.#inflight || now - this.#lastFetch < REFRESH_MS)) return;
    this.#inflight = true;
    this.#lastFetch = now;

    try {
      const [union, windows, access] = await Promise.all([
        desktopUnion(),
        listWindows(),
        accessibilityStatus(),
      ]);

      this.#originX = union.x;
      this.#originY = union.y;
      this.#width = union.width;
      this.#height = union.height;
      this.#scaleFactor = union.scaleFactor;
      this.#monitors = union.monitors;
      this.#accessibilityTrusted = access.trusted;

      this.#windows = windows
        .map((w) => ({
          id: w.id,
          title: w.title,
          owner: w.owner,
          x: w.x / this.#scaleFactor - this.#originX,
          y: w.y / this.#scaleFactor - this.#originY,
          width: w.width / this.#scaleFactor,
          height: w.height / this.#scaleFactor,
          layer: w.layer,
          onScreen: w.onScreen,
        }))
        .filter(
          (w) =>
            w.width > 100 &&
            w.height > 80 &&
            w.x + w.width > 0 &&
            w.y + w.height > 0 &&
            w.x < this.#width &&
            w.y < this.#height,
        );
    } catch (error) {
      console.warn("WorldModel refresh failed", error);
    } finally {
      this.#inflight = false;
    }
  }

  observe(body: Body, now = performance.now()): WorldSnapshot {
    this.#snapshot = this.#buildSnapshot(body.x, body.y - 80);
    this.#snapshot.updatedAt = now;
    void this.refresh();
    return this.#snapshot;
  }

  #buildSnapshot(petX: number, petY: number): WorldSnapshot {
    const nearestWindow = nearestByDistance(this.#windows, petX, petY);
    const edges = this.#collectEdges();
    const nearestEdge = nearestAnchor(edges, petX, petY);
    const points = this.#collectPoints(edges);

    return {
      originX: this.#originX,
      originY: this.#originY,
      width: this.#width,
      height: this.#height,
      scaleFactor: this.#scaleFactor,
      monitors: this.#monitors,
      windows: this.#windows,
      accessibilityTrusted: this.#accessibilityTrusted,
      nearestWindow,
      nearestEdge,
      points,
      updatedAt: performance.now(),
    };
  }

  #collectEdges(): EdgeAnchor[] {
    const edges: EdgeAnchor[] = [];
    for (const m of this.#monitors) {
      const left = m.workX - this.#originX;
      const right = m.workX + m.workWidth - this.#originX;
      const top = m.workY - this.#originY + 40;
      const floor = m.workY + m.workHeight - this.#originY;
      edges.push({ kind: "screen-left", x: left + 8, y: Math.min(floor * 0.35, 220), facing: 1 });
      edges.push({ kind: "screen-right", x: right - 8, y: Math.min(floor * 0.35, 220), facing: -1 });
      edges.push({ kind: "screen-top", x: (left + right) / 2, y: top, facing: 1 });
    }

    for (const w of this.#windows.slice(0, 12)) {
      edges.push({
        kind: "window-top",
        x: w.x + w.width * 0.5,
        y: w.y + 8,
        facing: 1,
        label: w.owner,
      });
      edges.push({
        kind: "window-side",
        x: w.x + 12,
        y: w.y + w.height * 0.4,
        facing: 1,
        label: w.owner,
      });
      edges.push({
        kind: "window-side",
        x: w.x + w.width - 12,
        y: w.y + w.height * 0.4,
        facing: -1,
        label: w.owner,
      });
    }
    return edges;
  }

  #collectPoints(edges: EdgeAnchor[]): PointOfInterest[] {
    const points: PointOfInterest[] = edges.map((edge, i) => ({
      id: `edge-${i}`,
      x: edge.x,
      y: edge.y,
      kind: "edge" as const,
      score: edge.kind.startsWith("window") ? 1.2 : 1,
      anchor: edge,
    }));

    for (const m of this.#monitors) {
      const floor = m.workY + m.workHeight - this.#originY;
      const left = m.workX - this.#originX;
      const right = m.workX + m.workWidth - this.#originX;
      points.push({ id: `floor-${m.id}`, x: (left + right) / 2, y: floor, kind: "floor", score: 0.6 });
      points.push({ id: `corner-l-${m.id}`, x: left + 80, y: floor, kind: "corner", score: 0.8 });
      points.push({ id: `corner-r-${m.id}`, x: right - 80, y: floor, kind: "corner", score: 0.8 });
    }
    return points;
  }
}

function nearestByDistance(windows: DesktopWindow[], x: number, y: number): DesktopWindow | null {
  let best: DesktopWindow | null = null;
  let bestD = Infinity;
  for (const w of windows) {
    const cx = w.x + w.width / 2;
    const cy = w.y + w.height / 2;
    const d = Math.hypot(cx - x, cy - y);
    if (d < bestD) {
      bestD = d;
      best = w;
    }
  }
  return best;
}

function nearestAnchor(anchors: EdgeAnchor[], x: number, y: number): EdgeAnchor | null {
  let best: EdgeAnchor | null = null;
  let bestD = Infinity;
  for (const a of anchors) {
    const d = Math.hypot(a.x - x, a.y - y);
    if (d < bestD) {
      bestD = d;
      best = a;
    }
  }
  return best;
}
