/**
 * Pont vers le backend Tauri.
 */

import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";

export interface WorkArea {
  x: number;
  y: number;
  width: number;
  height: number;
  scaleFactor: number;
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

export interface DesktopUnion {
  x: number;
  y: number;
  width: number;
  height: number;
  scaleFactor: number;
  monitors: MonitorInfo[];
}

export interface SystemWindow {
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

export interface AccessibilityStatus {
  trusted: boolean;
}

export interface CursorPoint {
  x: number;
  y: number;
}

export const isTauri = "__TAURI_INTERNALS__" in window;

export async function fitToWorkArea(): Promise<WorkArea> {
  if (!isTauri) {
    return {
      x: 0,
      y: 0,
      width: window.innerWidth,
      height: window.innerHeight,
      scaleFactor: window.devicePixelRatio,
    };
  }
  return invoke<WorkArea>("fit_to_work_area");
}

export async function desktopUnion(): Promise<DesktopUnion> {
  if (!isTauri) {
    const area = await fitToWorkArea();
    return {
      ...area,
      monitors: [
        {
          id: 0,
          x: area.x,
          y: area.y,
          width: area.width,
          height: area.height,
          scaleFactor: area.scaleFactor,
          workX: area.x,
          workY: area.y,
          workWidth: area.width,
          workHeight: area.height,
          primary: true,
        },
      ],
    };
  }
  return invoke<DesktopUnion>("desktop_union");
}

export async function listWindows(): Promise<SystemWindow[]> {
  if (!isTauri) return [];
  const raw = await invoke<
    Array<{
      id: number;
      title: string;
      owner: string;
      x: number;
      y: number;
      width: number;
      height: number;
      layer: number;
      on_screen: boolean;
    }>
  >("list_windows");
  return raw.map((w) => ({
    id: w.id,
    title: w.title,
    owner: w.owner,
    x: w.x,
    y: w.y,
    width: w.width,
    height: w.height,
    layer: w.layer,
    onScreen: w.on_screen,
  }));
}

export async function accessibilityStatus(): Promise<AccessibilityStatus> {
  if (!isTauri) return { trusted: false };
  return invoke<AccessibilityStatus>("accessibility_status");
}

export async function openAccessibilitySettings(): Promise<void> {
  if (!isTauri) return;
  await invoke("open_accessibility_settings");
}

export async function setClickThrough(ignore: boolean): Promise<void> {
  if (!isTauri) return;
  await invoke("set_click_through", { ignore });
}

export async function reveal(): Promise<void> {
  if (!isTauri) return;
  await invoke("reveal");
}

export async function setCursorTracking(enabled: boolean): Promise<void> {
  if (!isTauri) return;
  await invoke("set_cursor_tracking", { enabled });
}

export async function onCursorMove(handler: (point: CursorPoint) => void): Promise<() => void> {
  if (!isTauri) {
    const listener = (event: PointerEvent) => {
      handler({
        x: event.clientX * window.devicePixelRatio,
        y: event.clientY * window.devicePixelRatio,
      });
    };
    window.addEventListener("pointermove", listener);
    return () => window.removeEventListener("pointermove", listener);
  }
  return listen<CursorPoint>("cursor:move", (event) => handler(event.payload));
}

export async function onTrayAction(handler: (action: string) => void): Promise<() => void> {
  if (!isTauri) return () => {};
  return listen<string>("tray:action", (event) => handler(event.payload));
}
