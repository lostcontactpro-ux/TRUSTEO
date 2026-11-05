#!/usr/bin/env node
// Run only on the server. No secret, customer data or raw Stripe error is logged.
import Stripe from 'stripe';
import { paymentLinks, pricing, amountFor } from '../packages/core/src/pricing.ts';

const args = process.argv.slice(2);
if (args.length > 1 || args.some(arg => !['--check', '--apply'].includes(arg))) {
  process.stderr.write('Usage: npm run stripe:links -- [--check|--apply]\n');
  process.exitCode = 2;
} else if (!process.env.STRIPE_SECRET_KEY) {
  process.stderr.write('STRIPE_SECRET_KEY manque dans les variables sécurisées du serveur. Aucun appel Stripe effectué.\n');
  process.exitCode = 2;
} else {
  const apply = args.includes('--apply');
  const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, { maxNetworkRetries: 2, timeout: 20_000 });
  const selections = ['essential', 'pro'].flatMap(plan => ['month', 'year'].map(interval => ({ plan, interval, url: paymentLinks[plan][interval] })));
  try {
    const found = new Map();
    for await (const link of stripe.paymentLinks.list({ limit: 100 })) {
      const selection = selections.find(item => item.url === link.url);
      if (selection) found.set(selection.url, { selection, link });
      if (found.size === selections.length) break;
    }
    if (found.size !== selections.length) throw new Error('LINKS_MISSING');
    const priceIds = new Map();
    // Validate all four immutable price mappings before updating any link.
    for (const { selection, link } of found.values()) {
      const lines = await stripe.paymentLinks.listLineItems(link.id, { limit: 2 });
      const line = lines.data[0];
      const price = line?.price;
      if (!link.active || lines.has_more || lines.data.length !== 1 || line.quantity !== 1 ||
          !price?.active || price.currency !== 'eur' || price.unit_amount !== amountFor(selection.plan, selection.interval) ||
          price.recurring?.interval !== selection.interval || price.recurring.interval_count !== 1) {
        throw new Error('PRICE_MISMATCH');
      }
      priceIds.set(link.id, price.id);
    }
    const results = [];
    for (const { selection, link } of found.values()) {
      const updated = apply ? await stripe.paymentLinks.update(link.id, {
        payment_method_collection: 'always', payment_method_types: ['card'],
        subscription_data: selection.interval === 'year'
          ? { trial_period_days: '', trial_settings: '' }
          : { trial_period_days: pricing.trialDays, trial_settings: { end_behavior: { missing_payment_method: 'cancel' } } },
      }) : link;
      const trialDays = updated.subscription_data?.trial_period_days ?? 0;
      const expectedTrialDays = selection.interval === 'year' ? 0 : pricing.trialDays;
      const cardRequired = updated.payment_method_collection === 'always' &&
        updated.payment_method_types?.length === 1 && updated.payment_method_types[0] === 'card';
      const valid = trialDays === expectedTrialDays && cardRequired;
      results.push({ plan: selection.plan, interval: selection.interval, url: selection.url, priceId: priceIds.get(link.id), liveMode: updated.livemode, trialDays, cardRequired, valid });
    }
    process.stdout.write(`${JSON.stringify({ applied: apply, links: results }, null, 2)}\n`);
    if (results.some(item => !item.valid)) {
      process.stderr.write('Réglages non conformes. Après configuration du webhook et des emails, utiliser --apply puis revérifier.\n');
      process.exitCode = 1;
    }
  } catch (error) {
    const message = error instanceof Error && error.message === 'LINKS_MISSING'
      ? 'Les quatre liens ne sont pas tous présents dans ce compte et ce mode Stripe.'
      : error instanceof Error && error.message === 'PRICE_MISMATCH'
        ? 'Un lien est inactif ou son prix, sa devise ou sa récurrence ne correspond pas à pricing.ts. Aucun réglage de prix n’a été changé.'
        : 'Vérification ou modification Stripe interrompue. Vérifiez les droits de la clé, le réseau et les réglages dans Stripe, puis relancez --check. Des changements antérieurs peuvent avoir été appliqués.';
    process.stderr.write(`${message}\n`);
    process.exitCode = 1;
  }
}
