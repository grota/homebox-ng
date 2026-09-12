import type { InstanceSettingsDto } from '@homebox/shared'
import { DETECTION_PROVIDERS } from '@homebox/shared'
import { detectionRegistry } from './provider.js'
import { createLocalProvider } from './local.js'
import { createOpenAIProvider } from './openai.js'
import { createGoogleProvider } from './google.js'
import { createMockProvider } from './mock.js'
import type { ProviderConfig } from './local.js'

type GetSettings = () => InstanceSettingsDto

// Register the built-in providers. `getSettings` reads instance settings through
// a holder so per-request config (model/device/threshold) is available to each
// provider's `detectBoxes` without widening the `DetectionProviderImpl` interface.
// When `opts.mock` is set (e2e smoke), register a single deterministic provider.
//
// The mock is registered under EVERY known provider name (in addition to
// 'mock') so that DETECTION_MOCK=1 resolves to it no matter what the live
// `detectionProvider` setting happens to be (`createItemsFromImage` looks up the provider
// by settings value, which is one of `DETECTION_PROVIDERS`, and `instanceSettings
// .update` rejects 'mock'). This makes mock mode self-sufficient.
export const registerDetectionProviders = (getSettings: GetSettings, opts: { mock?: boolean } = {}): void => {
  detectionRegistry.clear()
  if (opts.mock) {
    const mock = createMockProvider()
    detectionRegistry.register(mock)
    for (const name of DETECTION_PROVIDERS) detectionRegistry.register({ ...mock, name })
    return
  }
  const getConfig = (): ProviderConfig => ((getSettings().detectionConfig ?? {}) as ProviderConfig)
  detectionRegistry.register(createLocalProvider(getConfig))
  detectionRegistry.register(createOpenAIProvider(getConfig))
  detectionRegistry.register(createGoogleProvider(getConfig))
}
