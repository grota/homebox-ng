export type UnpackErrorCode = 'image-not-decodable'

export class UnpackError extends Error {
  declare code: UnpackErrorCode
  declare cause?: unknown
  constructor(code: UnpackErrorCode, message: string = code, cause?: unknown) {
    super(message)
    this.name = 'UnpackError'
    this.code = code
    if (cause !== undefined) this.cause = cause
  }
}
