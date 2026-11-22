import { copyFile, mkdir } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const exec = promisify(execFile);
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const dist = resolve(root, 'dist');
const release = resolve(root, 'release');
const zipPath = resolve(release, 'creatordeck.zip');

await mkdir(release, { recursive: true });
await exec('zip', ['-r', '-q', '-FS', zipPath, '.'], { cwd: dist });

const artifact = '/opt/cursor/artifacts/creatordeck.zip';
try {
  await mkdir(dirname(artifact), { recursive: true });
  await copyFile(zipPath, artifact);
  console.log(`Packed ${zipPath} and ${artifact}`);
} catch (error) {
  console.log(`Packed ${zipPath}`);
  console.error(error);
}
