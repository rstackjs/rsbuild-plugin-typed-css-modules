import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { CSSLoaderOptions, RsbuildPlugin } from '@rsbuild/core';

export const PLUGIN_TYPED_CSS_MODULES_NAME = 'rsbuild:typed-css-modules';
const __dirname = path.dirname(fileURLToPath(import.meta.url));

export type PluginOptions = {
  /**
   * When enabled, the generated type definition will include an index signature (`[key: string]: string`).
   * This allows you to reference any class name without TypeScript errors, while still keeping autocomplete
   * and type hints for existing class names. It’s useful if you only need editor IntelliSense and don't require
   * strict type checking for CSS module exports.
   * @default false
   */
  looseTyping?: boolean;
};

export const pluginTypedCSSModules = (
  options: PluginOptions = {},
): RsbuildPlugin => ({
  name: PLUGIN_TYPED_CSS_MODULES_NAME,

  setup(api) {
    api.modifyBundlerChain({
      order: 'post',
      handler: async (chain, { target, CHAIN_ID }) => {
        if (target === 'web') {
          const ruleIds: string[] = [
            CHAIN_ID.RULE.CSS,
            CHAIN_ID.RULE.SASS,
            CHAIN_ID.RULE.LESS,
            CHAIN_ID.RULE.STYLUS,
          ];
          const isV1 = api.context.version.startsWith('1.');

          for (const ruleId of ruleIds) {
            let index = 1;
            while (chain.module.rules.has(`${ruleId}-${index}`)) {
              ruleIds.push(`${ruleId}-${index}`);
              index++;
            }
          }

          for (const ruleId of ruleIds) {
            if (!chain.module.rules.has(ruleId)) {
              continue;
            }

            const rule = isV1
              ? chain.module.rule(ruleId)
              : chain.module.rule(ruleId).oneOf(ruleId.split('-')[0]);

            if (!rule.uses.has(CHAIN_ID.USE.CSS)) {
              continue;
            }

            const cssLoaderOptions: CSSLoaderOptions = rule
              .use(CHAIN_ID.USE.CSS)
              .get('options');

            if (
              !cssLoaderOptions.modules ||
              (typeof cssLoaderOptions.modules === 'object' &&
                cssLoaderOptions.modules.auto === false)
            ) {
              continue;
            }

            rule
              .use('css-modules-typescript')
              .loader(path.resolve(__dirname, './loader.cjs'))
              .options({
                modules: cssLoaderOptions.modules,
                looseTyping: options.looseTyping,
              })
              .before(CHAIN_ID.USE.CSS);
          }
        }
      },
    });
  },
});
