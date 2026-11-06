import { type Dirent, realpathSync } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import { DECLARATION_HEADER } from './constants.js';

const STYLE_REGEX = /\.(css|scss|sass|less|styl|stylus)$/i;
const isMissing = (error: unknown) =>
  (error as NodeJS.ErrnoException).code === 'ENOENT';

type CleanOptions = {
  root: string;
  outputPaths: string[];
};

export function createDeclarationCleaner({ root, outputPaths }: CleanOptions) {
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
    if (!isInScope(source) || !STYLE_REGEX.test(source)) {
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
      if (!(await fs.lstat(declaration)).isFile()) {
        return;
      }
      const content = await fs.readFile(declaration, 'utf8');
      if (content.replace(/\r\n/g, '\n').startsWith(DECLARATION_HEADER)) {
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
    const entryNames = new Set(entries.map((entry) => entry.name));
    for (const entry of entries) {
      const filename = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        await visit(filename);
      } else if (entry.isFile() && filename.endsWith('.d.ts')) {
        const sourceName = entry.name.slice(0, -'.d.ts'.length);
        // The directory listing already tells us which source files exist.
        if (!entryNames.has(sourceName)) {
          await remove(path.join(directory, sourceName));
        }
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
