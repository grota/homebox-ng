export type UnpackErrorCode = 'image-not-decodable'

export class UnpackError extends Error {
  declare code: UnpackErrorCode
  constructor(code: UnpackErrorCode, message: string = code) {
    super(message)
    this.name = 'UnpackError'
    this.code = code
  }
}
