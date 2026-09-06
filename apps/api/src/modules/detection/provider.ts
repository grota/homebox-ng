export type DetectionBox = {
  box: { x: number; y: number; width: number; height: number }
  label: string
  confidence: number
}

export interface DetectionProvider {
  name: string
  detectBoxes(image: Buffer): Promise<DetectionBox[]>
}

// Providers are registered at startup by `./register.ts` (built-in local/google/
// openai, or `mock` when DETECTION_MOCK=1). `get` returns undefined for any name
// not yet registered; callers surface "configure a detection provider".
export class DetectionProviderRegistry {
  private providers = new Map<string, DetectionProvider>()
  register(p: DetectionProvider) { this.providers.set(p.name, p) }
  get(name: string) { return this.providers.get(name) }
  names() { return [...this.providers.keys()] }
  clear() { this.providers.clear() }
}

export const detectionRegistry = new DetectionProviderRegistry()
