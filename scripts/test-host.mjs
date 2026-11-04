// Runs the host tests once per tested OpenCode release, the one list in src/host/versions.ts, each as the version
// the embedded host reports to the plugin (OPENCODE_HOST_VERSION, read by test/host/harness.ts).
import { spawnSync } from 'node:child_process';
import { TESTED_HOSTS } from '../src/host/versions.ts';
for (const version of TESTED_HOSTS) {
  console.log(`Host tests as OpenCode ${version}`);
  const run = spawnSync('bun', ['test', 'test/host'], { stdio: 'inherit', env: { ...process.env, OPENCODE_HOST_VERSION: version } });
  if (run.status !== 0) process.exit(run.status ?? 1);
}
