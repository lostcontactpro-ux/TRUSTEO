import { providerDefinitions } from './registry.generated';
import { ProviderError, type PlatformId, type ProviderConfig, type ProviderDefinition, type ReviewProvider } from './types';

export * from './types';
export * from './email';
export { GoogleProvider } from './google';
export { TrustpilotProvider } from './trustpilot';
export { providerDefinitions };
export const providerRegistry = new Map<PlatformId, ProviderDefinition>(providerDefinitions.map(definition => [definition.id, definition]));
if (providerRegistry.size !== providerDefinitions.length) throw new Error('Duplicate review provider ID.');
export function createProvider(id: string, config: ProviderConfig): ReviewProvider {
  const definition = providerRegistry.get(id as PlatformId);
  if (!definition) throw new ProviderError('Unknown review platform.', 'configuration');
  return definition.create(config);
}
