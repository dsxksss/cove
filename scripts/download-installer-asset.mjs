import { writeFile } from 'node:fs/promises';

const [url, path] = process.argv.slice(2);
if (!url || !path || !url.startsWith('https://')) throw new Error('HTTPS URL and output path required');
const response = await fetch(url);
if (!response.ok) throw new Error(`HTTP ${response.status}: ${url}`);
await writeFile(path, Buffer.from(await response.arrayBuffer()));
