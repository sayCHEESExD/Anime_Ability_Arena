/**
 * THE DOCKER BUILD CONTEXT, without Docker.
 *
 * `.dockerignore` is the easiest way to break a deploy that looks fine
 * locally: exclude one workspace manifest and `npm ci` fails inside the image
 * with an error nobody sees until CI runs. This applies the ignore rules the
 * way the builder does and then asserts that EVERY path the Dockerfile copies
 * is still in the context - and that the context stays small.
 *
 * It parses the real Dockerfile, so a new COPY is checked without touching
 * this file. It does not build an image; it proves the build would have the
 * files it asks for.
 *
 *   node scripts/verify-docker-context.mjs
 *   STAGE_DIR=/tmp/ctx node scripts/verify-docker-context.mjs   # also copy the context out,
 *                                                               # to run the Dockerfile's steps without Docker
 */
import { copyFileSync, mkdirSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
let failures = 0;
const fail = (message) => {
  failures += 1;
  console.log(`  FAIL  ${message}`);
};
const check = (condition, message) => (condition ? console.log(`  ok    ${message}`) : fail(message));

/** One `.dockerignore` line: a pattern, and whether it re-includes (`!`). */
const rules = readFileSync(join(root, '.dockerignore'), 'utf8')
  .split(/\r?\n/)
  .map((line) => line.trim())
  .filter((line) => line && !line.startsWith('#'))
  .map((line) => (line.startsWith('!') ? { pattern: line.slice(1), include: true } : { pattern: line, include: false }));

/** A `.dockerignore` segment to a regex: `*` stops at a separator, `**` does not. */
const segmentRe = (segment) =>
  segment
    .split('')
    .map((char) => {
      if (char === '*') return null;
      if (char === '?') return '[^/]';
      return char.replace(/[.+^${}()|[\]\\]/g, '\\$&');
    })
    .join('')
    .replace(/\u0000/g, '');

const patternRe = (pattern) => {
  const parts = pattern.split('/').map((part) => {
    if (part === '**') return '.*';
    let out = '';
    for (const char of part) {
      if (char === '*') out += '[^/]*';
      else if (char === '?') out += '[^/]';
      else out += char.replace(/[.+^${}()|[\]\\]/g, '\\$&');
    }
    return out;
  });
  // A pattern matches the path itself and, being a directory, everything under it.
  return new RegExp(`^${parts.join('/').replace(/\.\*\//g, '(?:.*/)?')}(/.*)?$`);
};

const compiled = rules.map((rule) => ({ ...rule, re: patternRe(rule.pattern) }));

/** Docker keeps the LAST matching rule: a later `!pattern` re-includes. */
const excluded = (path) => {
  let out = false;
  for (const rule of compiled) if (rule.re.test(path)) out = !rule.include;
  return out;
};

/** Every file the builder would receive, and what it weighs. */
const context = [];
let bytes = 0;
const walk = (dir) => {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    const path = relative(root, full).split(sep).join('/');
    if (entry.isDirectory()) {
      // A directory whose every child is excluded is still walked: an
      // exception like `!client/package.json` lives under one.
      if (excluded(path) && !compiled.some((rule) => rule.include && rule.re.source.startsWith(`^${path}/`))) continue;
      walk(full);
      continue;
    }
    if (excluded(path)) continue;
    context.push(path);
    bytes += statSync(full).size;
  }
};
walk(root);

const inContext = new Set(context);
const has = (path) => inContext.has(path) || context.some((entry) => entry.startsWith(`${path.replace(/\/$/, '')}/`));

console.log(`\nBuild context: ${context.length} files, ${(bytes / 1024 / 1024).toFixed(2)} MB\n`);

// Every COPY source in the Dockerfile, except those copied from an earlier stage.
const dockerfile = readFileSync(join(root, 'Dockerfile'), 'utf8').replace(/\\\r?\n/g, ' ');
const copies = [...dockerfile.matchAll(/^\s*COPY\s+(.+)$/gim)]
  .map((match) => match[1].trim())
  .filter((line) => !/^--from=/.test(line))
  .flatMap((line) => line.split(/\s+/).slice(0, -1));

console.log('Dockerfile COPY sources (from the context):');
for (const source of copies) {
  const path = source.replace(/^\.\//, '');
  if (path === './' || path === '.') continue;
  check(has(path), `${path} is in the context`);
}

// The manifests npm resolves the workspace tree from: every one, or `npm ci` fails.
console.log('\nWorkspace manifests npm ci needs:');
const manifests = ['package.json', 'package-lock.json', ...JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).workspaces.map((w) => `${w}/package.json`)];
for (const manifest of manifests) check(inContext.has(manifest), `${manifest}`);

// What must NOT be shipped: the host's modules, stale builds, the art the server never opens.
console.log('\nKept out of the context:');
for (const path of ['node_modules/three/package.json', 'shared/dist/index.js', 'assets/audio/music.mp3', 'client/src/main.ts', 'server/data/profiles.json']) {
  const present = inContext.has(path);
  if (path.startsWith('server/data') && !present) {
    console.log(`  ok    ${path} (absent here anyway)`);
    continue;
  }
  check(!present, `${path} is excluded`);
}

check(bytes < 12 * 1024 * 1024, `the context stays small (${(bytes / 1024 / 1024).toFixed(2)} MB)`);

const stage = process.env.STAGE_DIR;
if (stage) {
  for (const path of context) {
    const target = join(stage, ...path.split('/'));
    mkdirSync(dirname(target), { recursive: true });
    copyFileSync(join(root, ...path.split('/')), target);
  }
  console.log(`\nstaged the ${context.length}-file context in ${stage}`);
}

if (failures > 0) {
  console.log(`\n${failures} docker context problem(s).`);
  process.exit(1);
}
console.log('\ndocker context OK');
