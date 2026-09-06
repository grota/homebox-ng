import type { InstanceSettingsDto } from '@homebox/shared'
import { detectionRegistry } from './provider'
import { createLocalProvider } from './local'
import { createOpenAIProvider } from './openai'
import { createGoogleProvider } from './google'
import { createMockProvider } from './mock'
import type { ProviderConfig } from './local'

type GetSettings = () => InstanceSettingsDto

// Register the built-in providers. `getSettings` reads instance settings through
// a holder so per-request config (model/device/threshold) is available to each
// provider's `detectBoxes` without widening the `DetectionProvider` interface.
// When `opts.mock` is set (e2e smoke), register a single deterministic provider.
export const registerDetectionProviders = (getSettings: GetSettings, opts: { mock?: boolean } = {}): void => {
  detectionRegistry.clear()
  if (opts.mock) {
    detectionRegistry.register(createMockProvider())
    return
  }
  const getConfig = (): ProviderConfig => ((getSettings().detectionConfig ?? {}) as ProviderConfig)
  detectionRegistry.register(createLocalProvider(getConfig))
  detectionRegistry.register(createOpenAIProvider(getConfig))
  detectionRegistry.register(createGoogleProvider(getConfig))
}
