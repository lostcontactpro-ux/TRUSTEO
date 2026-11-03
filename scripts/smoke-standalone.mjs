import { cp, mkdtemp, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { randomBytes, randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import { tmpdir } from 'node:os';
import { createServer } from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Run after npm run build. This tests a copy outside the repository, so Node
// cannot silently fill missing standalone dependencies from parent node_modules.
const repositoryRoot = fileURLToPath(new URL('../', import.meta.url));
const envFile = path.join(repositoryRoot, '.env');
if (existsSync(envFile)) process.loadEnvFile(envFile);
const applicationOrigin = 'https://standalone-smoke.example.test';
const port = Number(process.env.STANDALONE_SMOKE_PORT || 3123);
const fixture = { firstName: 'Standalone', lastName: 'SmokeFixture', email: `standalone-smoke-${randomUUID()}@example.test`, password: randomBytes(24).toString('base64url'), consent: true };
let phase = 'configuration';
let temporaryRoot; let server; let serverClosed; let control; let controlConnected = false;
let fixtureMayExist = false; let completed = false; let cleanupSucceeded = true;
const delay = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));
class SmokeError extends Error {}

try {
  if (!process.env.DATABASE_URL) throw new SmokeError('DATABASE_URL is required.');
  const databaseUrl = new URL(process.env.DATABASE_URL);
  if (!['postgres:', 'postgresql:'].includes(databaseUrl.protocol) || !['localhost', '127.0.0.1', '[::1]', '::1'].includes(databaseUrl.hostname)) {
    throw new SmokeError('Only a loopback PostgreSQL database is allowed for this smoke test.');
  }
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new SmokeError('The local smoke-test port is invalid.');
  const source = path.join(repositoryRoot, 'apps/web/.next/standalone');
  if (!existsSync(path.join(source, 'apps/web/server.js'))) throw new SmokeError('Build the standalone server before running this test.');
  const sourceRequire = createRequire(path.join(repositoryRoot, 'apps/web/package.json'));
  const compilerSource = sourceRequire.resolve('.prisma/client/query_compiler_bg.wasm');
  const relativeCompiler = path.relative(repositoryRoot, compilerSource);
  if (relativeCompiler.startsWith(`..${path.sep}`) || path.isAbsolute(relativeCompiler) || !existsSync(path.join(source, relativeCompiler))) {
    throw new SmokeError('The standalone artifact is missing its Prisma query compiler WASM.');
  }
  phase = 'local database preflight';
  const { Client } = sourceRequire('pg');
  control = new Client({ connectionString: process.env.DATABASE_URL, connectionTimeoutMillis: 5000, query_timeout: 5000 });
  await control.connect(); controlConnected = true;
  const collision = await control.query('SELECT id FROM "User" WHERE email=$1', [fixture.email]);
  if (collision.rows.length) throw new SmokeError('The generated fixture email already exists; no existing account will be modified.');

  phase = 'isolated artifact preparation';
  temporaryRoot = await mkdtemp(path.join(tmpdir(), 'trusteo-standalone-smoke-'));
  const artifact = path.join(temporaryRoot, 'application');
  await cp(source, artifact, { recursive: true });
  // Refuse to attach to an unrelated server already listening on the test port.
  const probe = createServer();
  await new Promise((resolve, reject) => { probe.once('error', reject); probe.listen(port, '127.0.0.1', resolve); });
  await new Promise((resolve, reject) => probe.close(error => error ? reject(error) : resolve()));

  phase = 'standalone server startup';
  server = spawn(process.execPath, [path.join(artifact, 'apps/web/server.js')], {
    cwd: artifact,
    env: { ...process.env, NODE_ENV: 'production', HOSTNAME: '127.0.0.1', PORT: String(port), APP_URL: applicationOrigin,
      NEXT_TELEMETRY_DISABLED: '1', STRIPE_SECRET_KEY: '', STRIPE_WEBHOOK_SECRET: '', OPENAI_API_KEY: '', TRUSTEO_OPENAI_API_KEY: '', RESEND_API_KEY: '',
      GOOGLE_CLIENT_ID: '', GOOGLE_CLIENT_SECRET: '', TRUSTPILOT_CLIENT_ID: '', TRUSTPILOT_CLIENT_SECRET: '', TWILIO_AUTH_TOKEN: '', VAPID_PRIVATE_KEY: '', INBOUND_WEBHOOK_SECRET: '',
    },
    // Application errors can contain customer data: do not echo raw server logs.
    stdio: ['ignore', 'ignore', 'ignore'],
  });
  let spawnFailed = false;
  server.once('error', () => { spawnFailed = true; });
  serverClosed = new Promise(resolve => server.once('close', resolve));
  const localOrigin = `http://127.0.0.1:${port}`;
  let ready = false;
  for (let attempt = 0; attempt < 100; attempt++) {
    if (spawnFailed || server.exitCode !== null) throw new SmokeError('The copied standalone server exited before readiness.');
    try { ready = (await fetch(`${localOrigin}/login`, { signal: AbortSignal.timeout(1000) })).ok; } catch { /* bounded startup polling */ }
    if (ready) break;
    await delay(200);
  }
  if (!ready) throw new SmokeError('The copied standalone server did not become ready.');

  phase = 'database-backed signup';
  fixtureMayExist = true;
  const signup = await fetch(`${localOrigin}/api/auth/signup`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Origin: applicationOrigin },
    body: JSON.stringify(fixture), signal: AbortSignal.timeout(15000),
  });
  if (signup.status !== 201) throw new SmokeError(`Standalone signup returned HTTP ${signup.status}.`);
  const account = await signup.json();
  if (account.user?.email !== fixture.email || account.user?.firstName !== fixture.firstName) throw new SmokeError('The signup response did not match its fixture.');
  const session = signup.headers.getSetCookie().find(cookie => cookie.startsWith('trusteo_session='));
  if (!session || !/;\s*Secure(?:;|$)/i.test(session) || !/;\s*HttpOnly(?:;|$)/i.test(session)) throw new SmokeError('The production session cookie is missing its security flags.');

  phase = 'database-backed account request';
  // HTTP is local transport only; Origin simulates HTTPS termination at a proxy.
  // The Secure session token remains in memory and is never logged or persisted.
  const response = await fetch(`${localOrigin}/api/account`, { headers: { Cookie: session.split(';')[0] }, signal: AbortSignal.timeout(10000) });
  if (response.status !== 200) throw new SmokeError(`Standalone account request returned HTTP ${response.status}.`);
  const returned = await response.json();
  if (returned.user?.id !== account.user.id || returned.user?.email !== fixture.email || returned.user?.firstName !== fixture.firstName) throw new SmokeError('The account response did not match its database-backed session.');
  completed = true;
} catch (error) {
  // Deliberately print neither database connection strings nor raw framework errors.
  console.error(`Standalone database smoke failed during ${phase}${error instanceof SmokeError ? `: ${error.message}` : '.'}`);
  process.exitCode = 1;
} finally {
  if (server) {
    server.kill('SIGTERM');
    await Promise.race([serverClosed, delay(5000)]);
    if (server.exitCode === null && server.signalCode === null) { server.kill('SIGKILL'); await serverClosed; }
  }
  if (controlConnected && fixtureMayExist) {
    try {
      const { rows } = await control.query('SELECT id, "firstName", "lastName" FROM "User" WHERE email=$1', [fixture.email]);
      if (rows.length) {
        if (rows.length !== 1 || rows[0].firstName !== fixture.firstName || rows[0].lastName !== fixture.lastName) throw new SmokeError('Fixture identity mismatch; existing account left untouched.');
        const deleted = await control.query('DELETE FROM "User" WHERE id=$1 AND email=$2', [rows[0].id, fixture.email]);
        if (deleted.rowCount !== 1) throw new SmokeError('Fixture cleanup did not delete exactly one account.');
      } else if (completed) throw new SmokeError('The expected smoke-test fixture was not found during cleanup.');
    } catch { cleanupSucceeded = false; process.exitCode = 1; console.error('Standalone database smoke fixture cleanup failed; inspect the local database before retrying.'); }
  }
  if (control) await control.end().catch(() => { cleanupSucceeded = false; process.exitCode = 1; });
  if (temporaryRoot) await rm(temporaryRoot, { recursive: true, force: true }).catch(() => { cleanupSucceeded = false; process.exitCode = 1; });
}
if (completed && cleanupSucceeded) console.log(JSON.stringify({ standaloneDatabaseSmoke: 'passed', isolatedArtifact: true, checks: ['Prisma compiler WASM', 'real PostgreSQL signup', 'Secure HttpOnly session', 'authenticated account read'], fixtureRemoved: true }));
