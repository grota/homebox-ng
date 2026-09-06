import { describe, it, expect } from 'vitest'
import { clampBox } from '../src/modules/detection/coords'
import { DetectionProviderError } from '../src/modules/detection/errors'
import type { DetectionProviderErrorCode } from '../src/modules/detection/errors'

describe('clampBox', () => {
  it('clamps out-of-range coordinates to the image bounds', () => {
    expect(clampBox({ x: -10, y: 5, width: 100, height: 200 }, 100, 150))
      .toEqual({ x: 0, y: 5, width: 90, height: 145 })
    expect(clampBox({ x: 90, y: 90, width: 50, height: 50 }, 100, 100))
      .toEqual({ x: 90, y: 90, width: 10, height: 10 })
  })
  it('zeroes a fully-outside box', () => {
    expect(clampBox({ x: 200, y: 200, width: 30, height: 30 }, 100, 100))
      .toEqual({ x: 100, y: 100, width: 0, height: 0 })
  })
})

describe('DetectionProviderError', () => {
  it('carries a typed code and name', () => {
    const e = new DetectionProviderError('not-configured', 'no key')
    expect(e).toBeInstanceOf(Error)
    expect(e.name).toBe('DetectionProviderError')
    expect((e as unknown as { code: DetectionProviderErrorCode }).code).toBe('not-configured')
  })
})
