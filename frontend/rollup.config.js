import resolve from '@rollup/plugin-node-resolve';
import commonjs from '@rollup/plugin-commonjs';
import babel from '@rollup/plugin-babel';
import { terser } from 'rollup-plugin-terser';

const production = !process.env.ROLLUP_WATCH;

// rollup.config.js
export default {
  input: 'src/main.js',
  output: {
    file: 'build/bundle.js',
    format: 'cjs',
    sourcemap: true
  },
  plugins: [
    resolve({ browser: true, preferBuiltins: false }),
    commonjs(),
    babel({ exclude: 'node_modules/**', babelHelpers: 'bundled' }),
    production && terser() // minify, but only in production
  ]
}
