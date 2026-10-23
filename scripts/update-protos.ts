/**
 * Downloads the official Google .proto files into `./protos/` from the latest upstream revisions:
 *   google/protobuf/*            protocolbuffers/protobuf (latest release tag)
 *   google/type/*, google/api/*  googleapis/googleapis (latest commit, pinned by SHA)
 * The revisions that were used are recorded in `protos/README.md`.
 * Usage: node ./scripts/update-protos.ts   (set GITHUB_TOKEN to avoid API rate limits)
 */
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { z } from 'zod';

interface ProtoSource {
  repo: string;
  ref: string;
  prefix: string;
}

const PROTOBUF_FILES = [
  'any',
  'api',
  'descriptor',
  'duration',
  'empty',
  'field_mask',
  'source_context',
  'struct',
  'timestamp',
  'type',
  'wrappers',
  'compiler/plugin',
].map((name) => `google/protobuf/${name}.proto`);

const Environment = z.object({ GITHUB_TOKEN: z.string().min(1).optional() });
const Release = z.object({ tag_name: z.string().min(1) });
const Commit = z.object({ sha: z.string().min(1) });

const IMPORT_PATTERN = /^import\s+(?:public\s+|weak\s+|option\s+)?"([^"]+)";/gm;

const DirectoryListing = z.array(z.object({ type: z.string(), name: z.string() }));

const outDir = path.join(import.meta.dirname, '..', 'protos');

const { GITHUB_TOKEN } = Environment.parse(process.env);

const get = async (url: string): Promise<Response> => {
  const response = await fetch(url, {
    headers: GITHUB_TOKEN ? { Authorization: `Bearer ${GITHUB_TOKEN}` } : {},
  });
  if (!response.ok) {
    throw new Error(`fetch failed with status ${response.status} for URL: ${url}`);
  }
  return response;
};

const listProtos = async (source: ProtoSource, directory: string): Promise<string[]> => {
  const response = await get(
    `https://api.github.com/repos/${source.repo}/contents/${directory}?ref=${source.ref}`,
  );
  return DirectoryListing.parse(await response.json())
    .filter((entry) => entry.type === 'file' && entry.name.endsWith('.proto'))
    .map((entry) => `${directory}/${entry.name}`);
};

const fetchProto = async (logicalName: string): Promise<string> => {
  const source = logicalName.startsWith('google/protobuf/') ? PROTOBUF_SOURCE : GOOGLEAPIS_SOURCE;
  const response = await get(
    `https://raw.githubusercontent.com/${source.repo}/${source.ref}/${source.prefix}${logicalName}`,
  );
  return response.text();
};

const fetchLicense = async (source: ProtoSource): Promise<string> =>
  (await get(`https://raw.githubusercontent.com/${source.repo}/${source.ref}/LICENSE`)).text();

const PROTOBUF_SOURCE: ProtoSource = {
  repo: 'protocolbuffers/protobuf',
  ref: Release.parse(
    await (
      await get('https://api.github.com/repos/protocolbuffers/protobuf/releases/latest')
    ).json(),
  ).tag_name,
  prefix: 'src/',
};
const GOOGLEAPIS_SOURCE: ProtoSource = {
  repo: 'googleapis/googleapis',
  ref: Commit.parse(
    await (await get('https://api.github.com/repos/googleapis/googleapis/commits/master')).json(),
  ).sha,
  prefix: '',
};

const wanted = [
  ...PROTOBUF_FILES,
  ...(await listProtos(GOOGLEAPIS_SOURCE, 'google/type')),
  ...(await listProtos(GOOGLEAPIS_SOURCE, 'google/api')),
];

rmSync(path.join(outDir, 'google'), { recursive: true, force: true });
const done = new Set<string>();
const queue = [...wanted];
for (let logicalName = queue.shift(); logicalName !== undefined; logicalName = queue.shift()) {
  if (done.has(logicalName)) {
    continue;
  }
  done.add(logicalName);
  const text = await fetchProto(logicalName);
  const file = path.join(outDir, logicalName);
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, text);
  for (const match of text.matchAll(IMPORT_PATTERN)) {
    const imported = match[1];
    if (imported !== undefined && !done.has(imported)) {
      queue.push(imported);
    }
  }
  console.log(logicalName);
}

writeFileSync(
  path.join(outDir, 'README.md'),
  `Official Google .proto files, downloaded with \`scripts/update-protos.ts\`.

- google/protobuf/*: protocolbuffers/protobuf @ ${PROTOBUF_SOURCE.ref} (BSD-3-Clause)
- google/type/*, google/api/* (and their imports): googleapis/googleapis @ ${GOOGLEAPIS_SOURCE.ref} (Apache-2.0)

Do not edit by hand: rerun the script instead.
`,
);
writeFileSync(path.join(outDir, 'LICENSE.protobuf'), await fetchLicense(PROTOBUF_SOURCE));
writeFileSync(path.join(outDir, 'LICENSE.googleapis'), await fetchLicense(GOOGLEAPIS_SOURCE));
