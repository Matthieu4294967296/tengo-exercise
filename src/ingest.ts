import { readdir } from 'node:fs/promises';
import path from 'node:path';

const FIXTURES_DIR = path.resolve(import.meta.dirname, '..', 'fixtures');

async function main(): Promise<void> {
  const boampFiles = await readdir(path.join(FIXTURES_DIR, 'boamp'));
  const platformFiles = await readdir(path.join(FIXTURES_DIR, 'platform'));

  console.log(`BOAMP notices: ${boampFiles.filter((file) => file.endsWith('.xml')).length}`);
  console.log(`Platform pages: ${platformFiles.filter((file) => file.endsWith('.html')).length}`);
  console.log('Nothing is ingested yet: this is where your pipeline starts.');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
