import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const args = process.argv.slice(2);
const manifestFlagIndex = args.indexOf('--manifest');
const manifestPath = manifestFlagIndex >= 0 ? args[manifestFlagIndex + 1] : undefined;

const key = process.env.CHROME_EXTENSION_KEY;

if (!key) {
  console.error('Missing CHROME_EXTENSION_KEY.');
  console.error(
    'Set CHROME_EXTENSION_KEY locally or configure the GitHub Actions secret before building release artifacts.',
  );
  process.exit(1);
}

let publicKeyBytes;
try {
  publicKeyBytes = Buffer.from(key, 'base64');
} catch (error) {
  console.error('CHROME_EXTENSION_KEY is not valid base64.');
  process.exit(1);
}

if (publicKeyBytes.length === 0) {
  console.error('CHROME_EXTENSION_KEY decoded to an empty value.');
  process.exit(1);
}

function computeExtensionId(bytes) {
  const digest = createHash('sha256').update(bytes).digest().subarray(0, 16);
  return digest
    .toString('hex')
    .replace(/[0-9a-f]/g, (char) => String.fromCharCode('a'.charCodeAt(0) + parseInt(char, 16)));
}

function readExpectedExtensionId() {
  const constantFile = path.resolve(
    process.cwd(),
    'app/native-server/src/scripts/constant.ts',
  );
  const source = fs.readFileSync(constantFile, 'utf8');
  const match = source.match(/EXTENSION_ID\s*=\s*'([a-p]{32})'/);
  if (!match) {
    throw new Error(`Unable to read EXTENSION_ID from ${constantFile}`);
  }
  return match[1];
}

const computedExtensionId = computeExtensionId(publicKeyBytes);
const expectedExtensionId = readExpectedExtensionId();

if (computedExtensionId !== expectedExtensionId) {
  console.error('CHROME_EXTENSION_KEY does not match the extension ID expected by the native host.');
  console.error(`Expected EXTENSION_ID: ${expectedExtensionId}`);
  console.error(`Computed from key:   ${computedExtensionId}`);
  process.exit(1);
}

console.log(`Verified CHROME_EXTENSION_KEY for extension ID ${computedExtensionId}.`);

if (manifestPath) {
  const absoluteManifestPath = path.resolve(process.cwd(), manifestPath);
  if (!fs.existsSync(absoluteManifestPath)) {
    console.error(`Manifest file not found: ${absoluteManifestPath}`);
    process.exit(1);
  }

  const manifest = JSON.parse(fs.readFileSync(absoluteManifestPath, 'utf8'));
  if (manifest.key !== key) {
    console.error(`Built manifest does not contain the expected key: ${absoluteManifestPath}`);
    process.exit(1);
  }

  console.log(`Verified manifest key in ${absoluteManifestPath}.`);
}
