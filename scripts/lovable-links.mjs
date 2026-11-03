#!/usr/bin/env node
import { buildLovableIntegration } from '../packages/core/src/integration-links.ts';

const usage = 'Usage : node scripts/lovable-links.mjs <origine HTTPS publique réelle de l’application Next.js> [--json]';
const args = process.argv.slice(2);
if (args.length === 1 && ['--help', '-h'].includes(args[0])) {
  process.stdout.write(`${usage}\n`);
} else {
  const positional = args.filter(value => value !== '--json');
  const jsonOnly = args.includes('--json');
  if (positional.length !== 1 || args.length !== positional.length + Number(jsonOnly) || positional[0].startsWith('--')) {
    process.stderr.write(`${usage}\n`);
    process.exitCode = 2;
  } else {
    try {
      const integration = buildLovableIntegration(positional[0]);
      if (jsonOnly) process.stdout.write(`${JSON.stringify(integration, null, 2)}\n`);
      else {
        const { prompt, ...destinations } = integration;
        process.stdout.write(`${JSON.stringify(destinations, null, 2)}\n\nPrompt à coller dans Lovable :\n\n${prompt}\n`);
      }
    } catch {
      // Do not echo rejected input: a mistakenly supplied URL can contain secrets.
      process.stderr.write('Origine refusée. Fournissez uniquement l’origine HTTPS publique réelle de l’application Next.js, sans secret ni chemin. Le site Lovable et les adresses locales ou d’exemple sont refusés.\n');
      process.exitCode = 2;
    }
  }
}
