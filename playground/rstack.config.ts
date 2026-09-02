// Configuration guide: https://rstack.rs/config
import { pluginLess } from '@rsbuild/plugin-less';
import { pluginSass } from '@rsbuild/plugin-sass';
import { pluginStylus } from '@rsbuild/plugin-stylus';
import { define } from 'rstack';
import { pluginTypedCSSModules } from '../src/index.ts';

define.app({
  plugins: [
    pluginLess(),
    pluginSass(),
    pluginStylus(),
    pluginTypedCSSModules(),
  ],
});
