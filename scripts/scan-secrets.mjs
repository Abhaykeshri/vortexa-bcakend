import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
const ignored = new Set(['.git', 'node_modules', 'dist', 'coverage', 'tmp', 'output']);
const files = [];
function walk(dir) {
  for (const name of readdirSync(dir)) {
    // Local environment files are intentionally untracked and may contain real
    // credentials. Scan the committed example, but never read local secret files.
    if (ignored.has(name) || (name.startsWith('.env') && name !== '.env.example')) continue;
    const path = join(dir, name);
    const stat = statSync(path);
    if (stat.isDirectory()) walk(path);
    else if (stat.size < 2_000_000) files.push(path);
  }
}
walk('.');
const rules = [
  ['private key', /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/],
  ['credential-bearing URL', /(?:postgres(?:ql)?|redis(?:s)?):\/\/[^\s:/]+:[^\s@/]+@/i],
  ['32-byte hex private key assignment', /(?:PRIVATE_KEY|SIGNER_KEY)\s*=\s*0x[a-f0-9]{64}/i],
  ['known weak API key', /API_KEY\s*=\s*(?:qwert|password|secret)/i],
];
const findings = [];
for (const file of files) {
  let source;
  try {
    source = readFileSync(file, 'utf8');
  } catch {
    continue;
  }
  for (const [label, pattern] of rules) if (pattern.test(source)) findings.push(`${file}: ${label}`);
}
if (findings.length) {
  console.error(findings.join('\n'));
  process.exit(1);
}
console.log(`Secret scan passed (${files.length} files inspected; local environment files excluded)`);
