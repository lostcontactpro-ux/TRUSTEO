import { cpSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repositoryRoot = fileURLToPath(new URL('../', import.meta.url));
const web = path.join(repositoryRoot, 'apps/web');
const standaloneRoot = path.join(web, '.next/standalone');
const target = path.join(standaloneRoot, 'apps/web');
const applicationRequire = createRequire(path.join(web, 'package.json'));
const compilerSource = applicationRequire.resolve('.prisma/client/query_compiler_bg.wasm');
const relativeCompiler = path.relative(repositoryRoot, compilerSource);
if (relativeCompiler.startsWith(`..${path.sep}`) || path.isAbsolute(relativeCompiler)) {
  throw new Error('Prisma query compiler must resolve inside the repository tracing root.');
}
const tracedCompiler = path.join(standaloneRoot, relativeCompiler);
if (!existsSync(tracedCompiler)) {
  throw new Error('Standalone is missing the Prisma query compiler WASM. Check outputFileTracingIncludes before deploying.');
}
const checksum = file => createHash('sha256').update(readFileSync(file)).digest('hex');
if (checksum(compilerSource) !== checksum(tracedCompiler)) {
  throw new Error('Standalone Prisma query compiler differs from the generated client. Rebuild before deploying.');
}
mkdirSync(path.join(target, '.next'), { recursive: true });
cpSync(path.join(web, 'public'), path.join(target, 'public'), { recursive: true });
cpSync(path.join(web, '.next/static'), path.join(target, '.next/static'), { recursive: true });
