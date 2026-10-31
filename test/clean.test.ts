import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { expect, test } from '@rstest/playwright';
import { createRsbuild } from '@rsbuild/core';
import { pluginTypedCSSModules } from '../dist';

for (const clean of [undefined, true]) {
  test(`cleans orphaned declarations on build only when clean is enabled (${clean})`, async () => {
    const root = await fs.promises.mkdtemp(
      path.join(os.tmpdir(), 'typed-css-build-'),
    );
    const entry = path.join(root, 'index.js');
    const source = path.join(root, 'remove.module.css');
    const keptSource = path.join(root, 'keep.module.css');
    try {
      await fs.promises.writeFile(
        entry,
        "import './remove.module.css'; import './keep.module.css';",
      );
      await fs.promises.writeFile(source, '.foo { color: red; }');
      await fs.promises.writeFile(keptSource, '.bar { color: blue; }');
      const rsbuild = await createRsbuild({
        cwd: root,
        config: {
          plugins: [pluginTypedCSSModules({ clean })],
          source: { entry: { index: './index.js' } },
        },
      });
      await rsbuild.build();
      expect(fs.existsSync(`${source}.d.ts`)).toBe(true);
      expect(fs.existsSync(`${keptSource}.d.ts`)).toBe(true);

      await fs.promises.unlink(source);
      await fs.promises.writeFile(entry, "import './keep.module.css';");
      await rsbuild.build();
      expect(fs.existsSync(`${source}.d.ts`)).toBe(!clean);
      expect(fs.existsSync(`${keptSource}.d.ts`)).toBe(true);
    } finally {
      await fs.promises.rm(root, { recursive: true, force: true });
    }
  });
}

test('cleans declarations when a watched source is deleted', async () => {
  const root = await fs.promises.mkdtemp(
    path.join(os.tmpdir(), 'typed-css-watch-'),
  );
  const entry = path.join(root, 'index.js');
  const source = path.join(root, 'index.module.css');
  let close: (() => Promise<void>) | undefined;
  try {
    await fs.promises.writeFile(entry, "import './index.module.css';");
    await fs.promises.writeFile(source, '.foo { color: red; }');
    const rsbuild = await createRsbuild({
      cwd: root,
      config: {
        plugins: [pluginTypedCSSModules({ clean: true })],
        source: { entry: { index: './index.js' } },
      },
    });
    let builds = 0;
    rsbuild.onAfterBuild(() => {
      builds++;
    });
    ({ close } = await rsbuild.build({ watch: true }));
    await expect.poll(() => builds).toBeGreaterThan(0);
    const initialBuilds = builds;
    expect(fs.existsSync(`${source}.d.ts`)).toBe(true);

    await fs.promises.unlink(source);
    await fs.promises.writeFile(entry, 'console.log("deleted");');
    await expect.poll(() => builds).toBeGreaterThan(initialBuilds);
    expect(fs.existsSync(`${source}.d.ts`)).toBe(false);
  } finally {
    await close?.();
    await fs.promises.rm(root, { recursive: true, force: true });
  }
});
