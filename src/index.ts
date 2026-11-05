import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { CSSLoaderOptions, RsbuildPlugin } from '@rsbuild/core';
import { createDeclarationCleaner } from './clean.js';

export const PLUGIN_TYPED_CSS_MODULES_NAME = 'rsbuild:typed-css-modules';
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const loaderFilename = import.meta.url.endsWith('.ts')
  ? './loader.ts'
  : './loader.cjs';

export type PluginOptions = {
  /**
   * Remove generated declarations whose source files no longer exist before
   * builds and when watched source files are deleted.
   * @default false
   */
  clean?: boolean;
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
    if (options.clean) {
      api.onAfterCreateCompiler(({ compiler }) => {
        const compilers =
          'compilers' in compiler ? compiler.compilers : [compiler];
        // Collect every environment's output after tools.rspack has been applied.
        const outputPaths = compilers.map((item) => item.outputPath);
        for (const item of compilers) {
          const cleaner = createDeclarationCleaner({
            root: api.context.rootPath,
            outputPaths: [api.context.distPath, ...outputPaths],
          });
          item.hooks.beforeRun.tapPromise(
            PLUGIN_TYPED_CSS_MODULES_NAME,
            cleaner.scan,
          );
          let initialWatch = true;
          item.hooks.watchRun.tapPromise(
            PLUGIN_TYPED_CSS_MODULES_NAME,
            async () => {
              if (initialWatch) {
                await cleaner.scan();
                initialWatch = false;
              } else {
                await cleaner.removeDeleted(item.removedFiles ?? []);
              }
            },
          );
        }
      });
    }

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

            const cssLoaderOptions = rule
              .use<CSSLoaderOptions>(CHAIN_ID.USE.CSS)
              .get('options');

            if (
              !cssLoaderOptions?.modules ||
              (typeof cssLoaderOptions.modules === 'object' &&
                cssLoaderOptions.modules.auto === false)
            ) {
              continue;
            }

            rule
              .use('css-modules-typescript')
              .loader(path.resolve(__dirname, loaderFilename))
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
