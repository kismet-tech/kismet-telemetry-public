// The package root is "type": "module"; dist/cjs must opt back out so Node treats
// its .js files as CommonJS.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
fs.writeFileSync(
    path.resolve(here, '../dist/cjs/package.json'),
    JSON.stringify({ type: 'commonjs' }, null, 2) + '\n'
);
