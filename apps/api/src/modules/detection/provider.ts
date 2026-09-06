export type DetectionBox = {
  box: { x: number; y: number; width: number; height: number }
  label: string
  confidence: number
}

export interface DetectionProvider {
  name: string
  detectBoxes(image: Buffer): Promise<DetectionBox[]>
}

// No concrete provider is registered in Phase 5 — the config surface exists, and
// the providers are wired in a later phase. `get` returns undefined for any name;
// callers surface "configure a detection provider".
export class DetectionProviderRegistry {
  private providers = new Map<string, DetectionProvider>()
  register(p: DetectionProvider) { this.providers.set(p.name, p) }
  get(name: string) { return this.providers.get(name) }
  names() { return [...this.providers.keys()] }
}

export const detectionRegistry = new DetectionProviderRegistry()
