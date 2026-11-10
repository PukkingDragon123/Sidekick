export const FRAMES: Record<string, { w: number; h: number; slice: number[]; fill: boolean }>;
export function frameStyle(name: string, scale?: number): string;
export function frameURL(name: string, scale?: number): string;
