import fs from 'node:fs';
import { join } from 'node:path';

export const generatorTempDir = async (cwd: string, testDir: string) => {
  fs.rmSync(testDir, { recursive: true, force: true });
  await fs.promises.cp(join(cwd, 'src'), testDir, { recursive: true });

  return () => fs.promises.rm(testDir, { force: true, recursive: true });
};
