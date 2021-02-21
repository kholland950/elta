import commonjs from '@rollup/plugin-commonjs'
import resolve from '@rollup/plugin-node-resolve'
import typescript from '@rollup/plugin-typescript'
import svelte from 'rollup-plugin-svelte'
import postcss from 'rollup-plugin-postcss'
import livereload from 'rollup-plugin-livereload'
import css from 'rollup-plugin-css-only'

const proxy = require('./proxy')

const production = !process.env.ROLLUP_WATCH

export default {
    //  Our games entry point (edit as required)
    input: [
        './src/main.ts'
    ],

    output: {
        file: './build/bundle.js',
        name: 'Game',
        format: 'iife',
        sourcemap: true,
        intro: 'var global = window;'
    },

    plugins: [
        svelte({
            compilerOptions: {
                // enable run-time checks when not in production
                dev: !production,
                hydratable: true,
            },
        }),

        postcss({
            extract: 'bundle.css'
        }),

        //  Parse our .ts source files
        resolve({
            browser: true,
            extensions: ['.ts'],
            dedupe: ['svelte'],
        }),

        //  We need to convert the Phaser 3 CJS modules into a format Rollup can use:
        commonjs({
            include: [
                'node_modules/eventemitter3/**',
                'node_modules/phaser/**'
            ],
            exclude: [
                'node_modules/phaser/src/polyfills/requestAnimationFrame.js'
            ],
            sourceMap: true,
            ignoreGlobal: true
        }),

        // In dev mode, call `npm run start` once
        // the bundle has been generated
        !production && proxy(),

        // Watch the `public` directory and refresh the
        // browser on changes when not in production
        !production && livereload('build'),

        //  See https://www.npmjs.com/package/rollup-plugin-typescript2 for config options
        typescript(),
    ],
};
