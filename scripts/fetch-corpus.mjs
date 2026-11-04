// scripts/fetch-corpus.mjs — S0 of the experimental protocol (spec §14.4).
//
// CodeXGLUE does not publish the processed JavaScript code-to-text split. The
// official route is: the repository's `dataset.zip` (one URL per line) plus the
// CodeSearchNet archive on Zenodo, intersected by `url` with the upstream
// `preprocess.py`. This script reproduces that intersection and freezes the
// result as `corpus/raw.jsonl`.
//
// Artifacts (outside git):
//   .cache/corpus-src/dataset.zip       URL index, 12 MB
//   .cache/corpus-src/javascript.zip    CodeSearchNet JS archive, 1.66 GB
//   corpus/raw.jsonl                    3 291 functions, one JSON per line
//   corpus/raw.sha256                   digest of raw.jsonl
//   corpus/download.json                provenance of the download

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import { fileURLToPath } from 'node:url';
import zlib from 'node:zlib';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const CACHE = path.join(ROOT, '.cache', 'corpus-src');
const CORPUS = path.join(ROOT, 'corpus');

const INDEX_URL =
  'https://raw.githubusercontent.com/microsoft/CodeXGLUE/b8590790716d3251a6950e860cd43fd82f5a35a6/Code-Text/code-to-text/dataset.zip';
const INDEX_BYTES = 12396864;
const INDEX_SHA256 = '31ec750805302ecd71b278a492d23d2ac916269f7ec645bba4f23b6f7c4bf217';
const INDEX_ENTRY = 'dataset/javascript/test.txt';

const SOURCE_URL = 'https://zenodo.org/api/records/7857872/files/javascript.zip/content';
const SOURCE_BYTES = 1664713350;
const SOURCE_MD5 = '7649178a02f7b5c8fbccb64abe7946b6';

const EXPECTED_FUNCTIONS = 3291;
const EOCD_SIGNATURE = 0x06054b50;
const CENTRAL_SIGNATURE = 0x02014b50;
const LOCAL_SIGNATURE = 0x04034b50;

const cli = parseArgs(process.argv.slice(2));
const indexPath = cli.index ?? path.join(CACHE, 'dataset.zip');
const sourcePath = cli.zip ?? path.join(CACHE, 'javascript.zip');

/**
 * Parses `--flag value` pairs from the command line.
 *
 * @param {string[]} argv - Arguments without the Node binary and script path.
 * @returns {Record<string, string>} Flag values keyed by name.
 */
function parseArgs(argv) {
  const flags = {};
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (!token.startsWith('--')) continue;
    const next = argv[i + 1];
    flags[token.slice(2)] = next !== undefined && !next.startsWith('--') ? next : 'true';
    if (flags[token.slice(2)] !== 'true') i += 1;
  }
  return flags;
}

/**
 * Reads a byte range from an open file descriptor.
 *
 * @param {number} fd - Open file descriptor.
 * @param {number} position - Absolute offset.
 * @param {number} length - Byte count.
 * @returns {Buffer} The bytes read (may be shorter at end of file).
 */
function readAt(fd, position, length) {
  const buffer = Buffer.allocUnsafe(length);
  const read = fs.readSync(fd, buffer, 0, length, position);
  return buffer.subarray(0, read);
}

/**
 * Lists the central directory of a ZIP archive.
 *
 * @param {string} zipPath - Absolute path of the archive.
 * @returns {Array<{name: string, method: number, compressedSize: number, localOffset: number}>} Entries.
 */
function listEntries(zipPath) {
  const fd = fs.openSync(zipPath, 'r');
  try {
    const size = fs.fstatSync(fd).size;
    const tailLength = Math.min(size, 66000);
    const tail = readAt(fd, size - tailLength, tailLength);

    let eocd = -1;
    for (let i = tail.length - 22; i >= 0; i -= 1) {
      if (tail.readUInt32LE(i) === EOCD_SIGNATURE) {
        eocd = i;
        break;
      }
    }
    if (eocd < 0) throw new Error(`${path.basename(zipPath)}: no end-of-central-directory record`);

    const directorySize = tail.readUInt32LE(eocd + 12);
    const directoryOffset = tail.readUInt32LE(eocd + 16);
    const directory = readAt(fd, directoryOffset, directorySize);

    const entries = [];
    let cursor = 0;
    while (
      cursor + 46 <= directory.length &&
      directory.readUInt32LE(cursor) === CENTRAL_SIGNATURE
    ) {
      const method = directory.readUInt16LE(cursor + 10);
      const compressedSize = directory.readUInt32LE(cursor + 20);
      const nameLength = directory.readUInt16LE(cursor + 28);
      const extraLength = directory.readUInt16LE(cursor + 30);
      const commentLength = directory.readUInt16LE(cursor + 32);
      const localOffset = directory.readUInt32LE(cursor + 42);
      const name = directory.toString('utf8', cursor + 46, cursor + 46 + nameLength);
      entries.push({ name, method, compressedSize, localOffset });
      cursor += 46 + nameLength + extraLength + commentLength;
    }
    return entries;
  } finally {
    fs.closeSync(fd);
  }
}

/**
 * Extracts one entry fully into memory. Only for small entries such as the URL
 * index; the data partition is read as a stream.
 *
 * @param {string} zipPath - Absolute path of the archive.
 * @param {{method: number, compressedSize: number, localOffset: number}} entry - Entry to read.
 * @returns {Buffer} Decompressed content.
 */
function readEntry(zipPath, entry) {
  const fd = fs.openSync(zipPath, 'r');
  try {
    const header = readAt(fd, entry.localOffset, 30);
    if (header.readUInt32LE(0) !== LOCAL_SIGNATURE) {
      throw new Error(`${entry}: bad local header`);
    }
    const nameLength = header.readUInt16LE(26);
    const extraLength = header.readUInt16LE(28);
    const start = entry.localOffset + 30 + nameLength + extraLength;
    const raw = readAt(fd, start, entry.compressedSize);
    return entry.method === 0 ? raw : zlib.inflateRawSync(raw);
  } finally {
    fs.closeSync(fd);
  }
}

/**
 * Opens the decompressed byte stream of one entry.
 *
 * @param {string} zipPath - Absolute path of the archive.
 * @param {{method: number, compressedSize: number, localOffset: number}} entry - Entry to stream.
 * @returns {import('node:stream').Readable} Byte stream of the entry content.
 */
function openEntryStream(zipPath, entry) {
  const fd = fs.openSync(zipPath, 'r');
  const header = readAt(fd, entry.localOffset, 30);
  fs.closeSync(fd);
  if (header.readUInt32LE(0) !== LOCAL_SIGNATURE) {
    throw new Error(`${entry}: bad local header`);
  }
  const nameLength = header.readUInt16LE(26);
  const extraLength = header.readUInt16LE(28);
  const start = entry.localOffset + 30 + nameLength + extraLength;
  const readable = fs.createReadStream(zipPath, {
    start,
    end: start + entry.compressedSize - 1,
  });
  return entry.method === 0 ? readable : readable.pipe(zlib.createInflateRaw());
}

/**
 * Streams a file through a hash function.
 *
 * @param {string} file - Absolute path.
 * @param {string} algorithm - Any `crypto.createHash` algorithm.
 * @returns {Promise<string>} Lowercase hexadecimal digest.
 */
async function hashFile(file, algorithm) {
  const hash = crypto.createHash(algorithm);
  await new Promise((resolve, reject) => {
    fs.createReadStream(file)
      .on('data', (chunk) => hash.update(chunk))
      .on('end', resolve)
      .on('error', reject);
  });
  return hash.digest('hex');
}

/**
 * Downloads a URL to a file, hashing the bytes as they arrive.
 *
 * @param {string} url - Source address.
 * @param {string} target - Destination path.
 * @returns {Promise<{bytes: number, sha256: string}>} Size and digest of the file written.
 */
async function download(url, target) {
  const response = await fetch(url);
  if (!response.ok || response.body === null) {
    throw new Error(`${url}: HTTP ${response.status}`);
  }
  fs.mkdirSync(path.dirname(target), { recursive: true });
  const partial = `${target}.part`;
  const hash = crypto.createHash('sha256');
  const sink = fs.createWriteStream(partial);
  let bytes = 0;

  await new Promise((resolve, reject) => {
    response.body.on('data', (chunk) => {
      hash.update(chunk);
      bytes += chunk.length;
    });
    response.body.pipe(sink);
    sink.on('finish', resolve);
    sink.on('error', reject);
    response.body.on('error', reject);
  });

  fs.renameSync(partial, target);
  return { bytes, sha256: hash.digest('hex') };
}

/**
 * Ensures a source archive is present and matches its frozen digest.
 *
 * @param {string} file - Local path.
 * @param {{url: string, bytes: number, algorithm: 'sha256'|'md5', digest: string}} expected - Frozen facts.
 * @returns {Promise<void>}
 */
async function ensureArchive(file, expected) {
  if (!fs.existsSync(file) || cli.force !== undefined) {
    console.log(`downloading ${expected.url}`);
    const written = await download(expected.url, file);
    if (expected.algorithm === 'sha256' && written.sha256 !== expected.digest) {
      throw new Error(
        `${path.basename(file)}: sha256 ${written.sha256} does not match ${expected.digest}`,
      );
    }
  }

  const size = fs.statSync(file).size;
  if (size !== expected.bytes) {
    throw new Error(`${path.basename(file)}: ${size} bytes, expected ${expected.bytes}`);
  }
  const digest = await hashFile(file, expected.algorithm);
  if (digest !== expected.digest) {
    throw new Error(
      `${path.basename(file)}: ${expected.algorithm} ${digest} does not match ${expected.digest}`,
    );
  }
  console.log(`${path.basename(file)} ok (${size} bytes, ${expected.algorithm} ${digest})`);
}

/**
 * Reads the upstream URL index that fixes which CodeSearchNet rows belong to
 * the code-to-text test split.
 *
 * @param {string} zipPath - Path of `dataset.zip`.
 * @returns {Set<string>} URLs in upstream order.
 */
function readUrlIndex(zipPath) {
  const entry = listEntries(zipPath).find((candidate) => candidate.name === INDEX_ENTRY);
  if (entry === undefined) throw new Error(`${zipPath}: missing ${INDEX_ENTRY}`);
  const content = readEntry(zipPath, entry).toString('utf8');
  const urls = content
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  console.log(`url index: ${urls.length} entries`);
  return new Set(urls);
}

/**
 * Walks the archives and collects the rows whose `url` is in the index.
 *
 * @param {string} zipPath - Path of `javascript.zip`.
 * @param {Set<string>} urls - Upstream URL index.
 * @returns {Promise<Map<string, object>>} Row per URL.
 */
async function collectRows(zipPath, urls) {
  const entries = listEntries(zipPath).filter(
    (entry) =>
      (entry.name.startsWith('javascript/final/jsonl/test/') ||
        entry.name.includes('javascript_test')) &&
      entry.name.endsWith('.jsonl.gz'),
  );
  if (entries.length === 0) {
    const preview = listEntries(zipPath)
      .map((entry) => entry.name)
      .filter((name) => name.includes('test'))
      .slice(0, 10);
    throw new Error(
      `no test shards in ${path.basename(zipPath)}; candidates: ${preview.join(', ')}`,
    );
  }

  const rows = new Map();
  let scanned = 0;
  let duplicates = 0;

  for (const entry of entries) {
    const compressed = openEntryStream(zipPath, entry).pipe(zlib.createGunzip());
    const lines = readline.createInterface({ input: compressed, crlfDelay: Infinity });
    for await (const line of lines) {
      if (line.length === 0) continue;
      const record = JSON.parse(line);
      scanned += 1;
      if (!urls.has(record.url)) continue;
      if (rows.has(record.url)) duplicates += 1;
      rows.set(record.url, record);
    }
    console.log(`read ${entry.name} (total scanned ${scanned})`);
  }

  console.log(`scanned ${scanned} rows, kept ${rows.size}, duplicates ${duplicates}`);
  return rows;
}

/**
 * Writes the frozen corpus and its provenance.
 *
 * @param {Map<string, object>} rows - Rows keyed by URL.
 * @param {string[]} order - Upstream URL order.
 * @returns {Promise<void>}
 */
async function writeCorpus(rows, order) {
  fs.mkdirSync(CORPUS, { recursive: true });
  const target = path.join(CORPUS, 'raw.jsonl');
  const lines = order.map((url) => JSON.stringify(rows.get(url)));
  fs.writeFileSync(target, `${lines.join('\n')}\n`, 'utf8');

  const digest = await hashFile(target, 'sha256');
  const bytes = fs.statSync(target).size;
  fs.writeFileSync(path.join(CORPUS, 'raw.sha256'), `${digest}  raw.jsonl\n`, 'utf8');

  const sourceDigest = await hashFile(sourcePath, 'sha256');
  const manifest = {
    dataset: 'microsoft/CodeXGLUE · Code-Text/code-to-text · JavaScript test',
    downloadedAt: new Date().toISOString(),
    functions: lines.length,
    raw: { bytes, sha256: digest },
    sources: {
      urlIndex: { url: INDEX_URL, bytes: INDEX_BYTES, sha256: INDEX_SHA256 },
      archive: { url: SOURCE_URL, bytes: SOURCE_BYTES, md5: SOURCE_MD5, sha256: sourceDigest },
    },
  };
  fs.writeFileSync(
    path.join(CORPUS, 'download.json'),
    `${JSON.stringify(manifest, null, 2)}\n`,
    'utf8',
  );

  console.log(`wrote corpus/raw.jsonl (${lines.length} functions, ${bytes} bytes)`);
  console.log(`raw.jsonl sha256 ${digest}`);
}

/**
 * Runs the download, verification and extraction.
 *
 * @returns {Promise<void>}
 */
async function main() {
  await ensureArchive(indexPath, {
    url: INDEX_URL,
    bytes: INDEX_BYTES,
    algorithm: 'sha256',
    digest: INDEX_SHA256,
  });
  await ensureArchive(sourcePath, {
    url: SOURCE_URL,
    bytes: SOURCE_BYTES,
    algorithm: 'md5',
    digest: SOURCE_MD5,
  });

  const urls = readUrlIndex(indexPath);
  const rows = await collectRows(sourcePath, urls);

  const missing = [...urls].filter((url) => !rows.has(url));
  if (missing.length > 0) {
    throw new Error(`${missing.length} indexed functions not found, e.g. ${missing[0]}`);
  }
  if (rows.size !== EXPECTED_FUNCTIONS) {
    throw new Error(`${rows.size} functions kept, expected ${EXPECTED_FUNCTIONS}`);
  }

  await writeCorpus(rows, [...urls]);
}

await main();
