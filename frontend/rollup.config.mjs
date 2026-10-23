import resolve from '@rollup/plugin-node-resolve'
import typescript from '@rollup/plugin-typescript'
import svelte from 'rollup-plugin-svelte'
import postcss from 'rollup-plugin-postcss'
import postcssImport from 'postcss-import'
import postcssNested from 'postcss-nested'
import postcssPresetEnv from 'postcss-preset-env'
import autoprefixer from 'autoprefixer'
import livereload from 'rollup-plugin-livereload'
import copy from 'rollup-plugin-copy'
import proxy from './proxy.js'

const production = !process.env.ROLLUP_WATCH

// Identifies this bundle so the server can reject clients from a stale deploy (joinRoom `build`).
// Dev/watch builds use a fixed value so reloads never trip staleBuild.
const buildId = production ? Date.now().toString(36) : 'dev'

// Replaces the __BUILD_ID__ identifier in our own TS sources with a string literal
const buildIdPlugin = () => ({
    name: 'build-id',
    transform(code, id) {
        if (id.includes('node_modules') || !/\.ts$/.test(id) || !code.includes('__BUILD_ID__')) return null
        return { code: code.replace(/\b__BUILD_ID__\b/g, JSON.stringify(buildId)), map: null }
    },
})

export default {
    //  Our games entry point (edit as required)
    input: [
        './src/main.ts'
    ],

    output: {
        file: './dist/static/bundle.js',
        name: 'Game',
        format: 'iife',
        sourcemap: true,
    },

    onwarn(warning, warn) {
        // Svelte's runtime has internal circular imports that are harmless
        if (warning.code === 'CIRCULAR_DEPENDENCY' && warning.ids?.every((id) => id.includes('node_modules'))) return
        warn(warning)
    },

    plugins: [
        buildIdPlugin(),

        svelte({
            compilerOptions: {
                // enable run-time checks when not in production
                dev: !production,
            },
        }),

        postcss({
            extract: 'bundle.css',
            // The postcss plugins are ESM-only, so they're configured here rather than in postcss.config.js
            config: false,
            plugins: [
                postcssImport(),
                postcssNested(),
                postcssPresetEnv(),
                autoprefixer(),
            ],
        }),

        //  Parse our .ts source files
        resolve({
            browser: true,
            extensions: ['.ts'],
            dedupe: ['svelte'],
            exportConditions: ['svelte'],
        }),

        copy({
            targets: [
                { src: 'assets', dest: 'dist/static' }
            ]
        }),

        // In dev mode, call `npm run start` once
        // the bundle has been generated
        !production && proxy(),

        // Watch the `public` directory and refresh the
        // browser on changes when not in production
        !production && livereload('dist'),

        //  See https://github.com/rollup/plugins/tree/master/packages/typescript for config options
        typescript(),
    ],
};
