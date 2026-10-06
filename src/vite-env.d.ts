/// <reference types="vite/client" />

declare module "@chenglou/pretext" {
  export function prepareWithSegments(text: string, fontSpec: string): unknown;
  export function layoutWithLines(
    prepared: unknown,
    maxWidthPx: number,
    lineHeightPx: number,
  ): { lines: Array<{ width: number }> };
}
