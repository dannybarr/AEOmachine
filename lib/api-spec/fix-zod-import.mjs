// Orval emits zod v4 syntax (zod.int()) but imports the classic 'zod' entry.
// It can also emit max-length constants after schemas that reference them,
// which triggers the ESM temporal dead zone at runtime. Normalize both.
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = path.dirname(fileURLToPath(import.meta.url));
const target = path.resolve(dir, '..', 'api-zod', 'src', 'generated', 'api.ts');
let src = readFileSync(target, 'utf8').replace(
  "from 'zod'",
  "from 'zod/v4'",
);
const maxConstants = [];
src = src.replace(
  /^export const [A-Za-z0-9_]+Max = [^;]+;\r?\n?/gm,
  (declaration) => {
    maxConstants.push(declaration.trim());
    return '';
  },
);
if (maxConstants.length) {
  src = src.replace(
    /^(import [^\n]+;\r?\n)/m,
    `$1\n${maxConstants.join('\n')}\n`,
  );
}
writeFileSync(target, `${src.trimEnd()}\n`);

for (const clientFile of ['api.ts', 'api.schemas.ts']) {
  const clientTarget = path.resolve(
    dir,
    '..',
    'api-client-react',
    'src',
    'generated',
    clientFile,
  );
  const clientSrc = readFileSync(clientTarget, 'utf8');
  writeFileSync(clientTarget, `${clientSrc.trimEnd()}\n`);
}
