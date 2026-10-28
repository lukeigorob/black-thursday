// Run Blender (the Store install, through its launcher alias) with arguments; its console output is lost,
// so scripts write their own log. node bl.mjs <args...>
import { spawnSync } from 'node:child_process';
import path from 'node:path';
const exe = path.join(process.env.LOCALAPPDATA, 'Microsoft', 'WindowsApps', 'blender-launcher.exe');
const r = spawnSync(exe, process.argv.slice(2), { encoding: 'utf8', timeout: 1800000 });
console.log('status', r.status, r.error?.message ?? '');
