// Finds Blender and runs tools/convert.py headless.
// Order: BLENDER env var, the Microsoft Store alias, then `blender` on PATH.
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';

// Store app aliases are reparse points that existsSync() can't see, so list the folder instead
const aliasDir = path.join(process.env.LOCALAPPDATA ?? '', 'Microsoft', 'WindowsApps');
const hasAlias = existsSync(aliasDir) && readdirSync(aliasDir).includes('blender-launcher.exe');
const exe = process.env.BLENDER || (hasAlias ? path.join(aliasDir, 'blender-launcher.exe') : 'blender');
const script = path.resolve('tools/convert.py');

console.log(`Running ${exe} ...`);
const r = spawnSync(exe, ['--background', '--factory-startup', '--python', script], { stdio: 'inherit' });
if (r.error) console.error(`Could not start Blender: ${r.error.message}. Set the BLENDER env var to blender.exe.`);

// the Store launcher does not always forward Blender's output, so show the report file
const report = path.resolve('tools/convert_report.txt');
if (existsSync(report)) console.log(readFileSync(report, 'utf8'));
process.exit(r.status ?? 1);
