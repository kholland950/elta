// Stylesheets are bundled by rollup-plugin-postcss
declare module '*.css'

// Injected at bundle time by rollup.config.mjs; undefined under vitest/tsc-only runs
declare const __BUILD_ID__: string | undefined
