import { type Dirent, realpathSync } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import type { Rspack } from '@rsbuild/core';

const STYLE_REGEX = /\.(css|scss|sass|less|styl|stylus)$/i;
const isMissing = (error: unknown) =>
  (error as NodeJS.ErrnoException).code === 'ENOENT';

type CleanOptions = {
  root: string;
  outputPaths: string[];
  isModule: (filename: string) => boolean;
};

export function createDeclarationCleaner({
  root,
  outputPaths,
  isModule,
}: CleanOptions) {
  const originalRoot = path.resolve(root);
  root = realpathSync(originalRoot);
  // Rspack reports real paths (e.g. /private/var on macOS), while cwd may
  // contain an alias such as /var. Normalize both without following file links.
  const normalize = (filename: string) => {
    const absolute = path.resolve(filename);
    if (
      absolute === originalRoot ||
      absolute.startsWith(`${originalRoot}${path.sep}`)
    ) {
      return path.join(root, path.relative(originalRoot, absolute));
    }
    return absolute;
  };
  const excluded = outputPaths.map(normalize);

  function isInScope(filename: string) {
    const relative = path.relative(root, filename);
    return (
      relative !== '..' &&
      !relative.startsWith(`..${path.sep}`) &&
      !path.isAbsolute(relative) &&
      !relative
        .split(path.sep)
        .some((part) => part === 'node_modules' || part === '.git') &&
      !excluded.some(
        (output) =>
          filename === output || filename.startsWith(`${output}${path.sep}`),
      )
    );
  }

  async function remove(source: string) {
    if (!isInScope(source) || !STYLE_REGEX.test(source) || !isModule(source)) {
      return;
    }
    try {
      await fs.lstat(source);
      return;
    } catch (error) {
      if (!isMissing(error)) {
        throw error;
      }
    }
    const declaration = `${source}.d.ts`;
    try {
      if ((await fs.lstat(declaration)).isFile()) {
        await fs.unlink(declaration);
      }
    } catch (error) {
      // Multiple compilers can observe the same removed source.
      if (!isMissing(error)) {
        throw error;
      }
    }
  }

  async function visit(directory: string): Promise<void> {
    if (!isInScope(directory)) {
      return;
    }
    let entries: Dirent[];
    try {
      entries = await fs.readdir(directory, { withFileTypes: true });
    } catch (error) {
      if (isMissing(error)) {
        return;
      }
      throw error;
    }
    for (const entry of entries) {
      const filename = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        await visit(filename);
      } else if (entry.isFile() && filename.endsWith('.d.ts')) {
        await remove(filename.slice(0, -'.d.ts'.length));
      }
    }
  }

  return {
    scan: () => visit(root),
    async removeDeleted(sources: Iterable<string>) {
      for (const filename of sources) {
        const source = normalize(filename);
        if (!isInScope(source) || !STYLE_REGEX.test(source)) {
          continue;
        }
        // Watch paths may pass through a symlink even though scans do not.
        let directory = path.dirname(source);
        let linked = false;
        while (directory !== root) {
          try {
            if ((await fs.lstat(directory)).isSymbolicLink()) {
              linked = true;
              break;
            }
          } catch (error) {
            if (!isMissing(error)) {
              throw error;
            }
          }
          directory = path.dirname(directory);
        }
        if (!linked) {
          await remove(source);
        }
      }
    },
  };
}

// Use the same resource conditions as the stylesheet rule that installs the loader.
export function matchesCondition(
  filename: string,
  condition?: Rspack.RuleSetCondition,
): boolean {
  if (condition === undefined) return true;
  if (typeof condition === 'string') return filename.startsWith(condition);
  if (typeof condition === 'function') return condition(filename);
  if (condition instanceof RegExp)
    return new RegExp(condition.source, condition.flags).test(filename);
  if (Array.isArray(condition))
    return condition.some((item) => matchesCondition(filename, item));
  return (
    (!condition.and ||
      condition.and.every((item) => matchesCondition(filename, item))) &&
    (!condition.or ||
      condition.or.some((item) => matchesCondition(filename, item))) &&
    (!condition.not || !matchesCondition(filename, condition.not))
  );
}
