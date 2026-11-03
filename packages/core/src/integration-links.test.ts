import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { buildLovableIntegration, LOVABLE_SITE_ORIGIN } from './integration-links';

// Syntactic unit fixture only: this address is never probed or claimed deployed.
const appOrigin = 'https://console.unit-fixture.fr';
const script = fileURLToPath(new URL('../../../scripts/lovable-links.mjs', import.meta.url));

describe('Lovable navigation integration', () => {
  it('maps signup, login, four pricing choices and enterprise to existing application routes', () => {
    const result = buildLovableIntegration(appOrigin);
    expect(result.siteOrigin).toBe('https://trus-teo.lovable.app');
    expect(result.appOrigin).toBe(appOrigin);
    expect(result.links).toEqual({
      signup: `${appOrigin}/signup`, login: `${appOrigin}/login`,
      essentialMonth: `${appOrigin}/signup?plan=essential&interval=month`,
      essentialYear: `${appOrigin}/signup?plan=essential&interval=year`,
      proMonth: `${appOrigin}/signup?plan=pro&interval=month`,
      proYear: `${appOrigin}/signup?plan=pro&interval=year`,
      enterprise: `${appOrigin}/contact`,
    });
    for (const [key, value] of Object.entries(result.links)) {
      const url = new URL(value);
      expect(url.origin).toBe(appOrigin);
      expect(url.pathname).toBe(key === 'login' ? '/login' : key === 'enterprise' ? '/contact' : '/signup');
    }
  });
  it('preserves exact plan and interval parameters for every pricing button', () => {
    const { links } = buildLovableIntegration(appOrigin);
    for (const [name, plan, interval] of [
      ['essentialMonth', 'essential', 'month'], ['essentialYear', 'essential', 'year'],
      ['proMonth', 'pro', 'month'], ['proYear', 'pro', 'year'],
    ] as const) {
      expect([...new URL(links[name]).searchParams]).toEqual([['plan', plan], ['interval', interval]]);
    }
  });
  it('canonicalizes an optional root slash and the standard HTTPS port', () => {
    expect(buildLovableIntegration('https://CONSOLE.UNIT-FIXTURE.FR:443/').appOrigin).toBe(appOrigin);
  });
  it.each([
    '', 'not-a-url', 'http://console.unit-fixture.fr', 'https://localhost', 'https://app.localhost',
    'https://localhost.fr', 'https://trusteo', 'https://127.0.0.1', 'https://192.168.1.5', 'https://8.8.8.8',
    'https://0x7f000001', 'https://127.1', 'https://[::1]', 'https://[2001:4860:4860::8888]',
    'https://app.local', 'https://app.internal', 'https://app.lan', 'https://app.test',
    'https://app.example.com', 'https://example.net',
    'https://console.unit-fixture.fr:3000', 'https://console.unit-fixture.fr/app',
    'https://console.unit-fixture.fr/anything/..', 'https://console.unit-fixture.fr/?plan=pro',
    'https://console.unit-fixture.fr/#app', 'https://console.unit-fixture.fr/?', 'https://console.unit-fixture.fr/#',
    'https://user:secret@console.unit-fixture.fr', 'https://console.unit-fixture.fr\\@other.fr',
    'https://console.unit-fixture.fr.', 'https://console..unit-fixture.fr',
    LOVABLE_SITE_ORIGIN, `${LOVABLE_SITE_ORIGIN}:443/`,
  ])('rejects non-public, non-origin, example or current-site input: %s', value => {
    expect(() => buildLovableIntegration(value)).toThrow();
  });
  it('accepts legitimate app names without guessing whether a hostname is a placeholder',()=>{expect(buildLovableIntegration('https://my-business.vercel.app').appOrigin).toBe('https://my-business.vercel.app');});
  it('does not expose credential-bearing rejected input through error messages', () => {
    const secret = 'private-key-do-not-echo';
    let message = '';
    try { buildLovableIntegration(`https://user:${secret}@console.unit-fixture.fr`); }
    catch (error) { message = (error as Error).message; }
    expect(message).toBeTruthy(); expect(message).not.toContain(secret); expect(message).not.toContain('console.unit-fixture.fr');
  });
  it('produces a copyable navigation-only prompt without duplicate auth, billing or client keys', () => {
    const integration = buildLovableIntegration(appOrigin);
    for (const value of Object.values(integration.links)) expect(integration.prompt).toContain(value);
    expect(integration.prompt).toContain(LOVABLE_SITE_ORIGIN);
    expect(integration.prompt).toContain('conserve le design');
    expect(integration.prompt).toContain('Ne crée pas une seconde authentification');
    expect(integration.prompt).toContain('N’ajoute aucune clé API ou clé Stripe dans le code client');
    expect(integration.prompt).toContain('sans iframe');
    expect(integration.prompt).toContain('N’appelle pas les API authentifiées');
  });
  it('runs with Node directly and prints parseable complete JSON when requested', () => {
    const command = spawnSync(process.execPath, [script, appOrigin, '--json'], { encoding: 'utf8' });
    expect(command.status, command.stderr).toBe(0);
    expect(JSON.parse(command.stdout)).toEqual(buildLovableIntegration(appOrigin));
  });
  it('prints the links and copyable prompt by default', () => {
    const command = spawnSync(process.execPath, [script, appOrigin], { encoding: 'utf8' });
    expect(command.status, command.stderr).toBe(0);
    expect(command.stdout).toContain('Prompt à coller dans Lovable :');
    expect(command.stdout).toContain(`${appOrigin}/signup?plan=pro&interval=year`);
  });
  it('CLI rejects secret-bearing URL input without echoing the URL or secret', () => {
    const command = spawnSync(process.execPath, [script, 'https://user:private-value@console.unit-fixture.fr'], { encoding: 'utf8' });
    expect(command.status).toBe(2);
    expect(command.stdout).toBe('');
    expect(command.stderr).not.toContain('private-value');
    expect(command.stderr).not.toContain('console.unit-fixture.fr');
  });
  it.each([[], [appOrigin, 'unexpected'], ['--json', '--json', appOrigin], ['--unknown', appOrigin]].map(args=>({args})))('requires exactly one origin argument: $args', ({args}) => {
    const command = spawnSync(process.execPath, [script, ...args], { encoding: 'utf8' });
    expect(command.status).toBe(2); expect(command.stdout).toBe('');
  });
});
