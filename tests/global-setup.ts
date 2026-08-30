import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../', import.meta.url));

// The suite's only `astro build`. Every test that inspects the built site reads
// dist/ as a fixture; none of them may rebuild it while another file is reading.
export default function setup(): void {
  execFileSync('npx', ['astro', 'build'], { cwd: ROOT, stdio: 'inherit' });
}
