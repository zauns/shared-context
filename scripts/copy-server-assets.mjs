import fs from 'node:fs';
import path from 'node:path';

const source = path.resolve('src/server/db/migrations');
const destination = path.resolve('dist/server/db/migrations');

fs.mkdirSync(destination, { recursive: true });
for (const name of fs.readdirSync(source)) {
  if (!name.endsWith('.sql')) continue;
  fs.copyFileSync(path.join(source, name), path.join(destination, name));
}
