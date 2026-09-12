export type DetectionBox = {
  box: { x: number; y: number; width: number; height: number }
  label: string
  confidence: number
}

export interface DetectionProviderImpl {
  name: string
  // `bounds` are the decoded image dims (pixel space, top-left origin). Every
  // returned box is guaranteed to lie within those bounds: providers clamp here,
  // so consumers (`createItemsFromImage`) can trust the box before driving `sharp.extract`.
  detectBoxes(image: Buffer, bounds: { width: number; height: number }): Promise<DetectionBox[]>
}

// Providers are registered at startup by `./register.ts` (built-in local/google/
// openai, or `mock` when DETECTION_MOCK=1). `get` returns undefined for any name
// not yet registered; callers surface "configure a detection provider".
export class DetectionProviderRegistry {
  private providers = new Map<string, DetectionProviderImpl>()
  register(p: DetectionProviderImpl) { this.providers.set(p.name, p) }
  get(name: string) { return this.providers.get(name) }
  names() { return [...this.providers.keys()] }
  clear() { this.providers.clear() }
}

export const detectionRegistry = new DetectionProviderRegistry()
