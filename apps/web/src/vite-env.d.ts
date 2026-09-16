// The build-time variables this app reads.
//
// Declared here rather than pulling in all of `vite/client`, which types every
// `VITE_*` as `any` through an index signature. There is exactly one, it is set
// by the Docker build from the git tag, and it is absent in every other context —
// hence optional, with the call sites supplying their own fallback.

interface ImportMetaEnv {
  readonly VITE_APP_VERSION?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
