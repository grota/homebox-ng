export type DetectionProviderErrorCode = 'not-configured' | 'model-unavailable' | 'api-error' | 'rate-limited'

export class DetectionProviderError extends Error {
  declare code: DetectionProviderErrorCode
  constructor(code: DetectionProviderErrorCode, message: string) {
    super(message)
    this.name = 'DetectionProviderError'
    this.code = code
  }
}
