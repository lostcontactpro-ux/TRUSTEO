import { ProviderError, type ConnectInput, type ConnectionResult, type NormalizedReview, type PlatformId, type ProviderCapabilities, type ProviderConfig, type ProviderDefinition, type ReplyResult, type ReviewProvider } from './types';

/** This fallback never pretends to read or publish through an unavailable API. */
export class AssistedProvider implements ReviewProvider {
  readonly capabilities: ProviderCapabilities;
  constructor(readonly id: PlatformId, readonly label: string, readonly config: ProviderConfig, requiresPartnership: boolean) {
    this.capabilities = { canRead: false, canReply: false, realtime: false, requiresPartnership };
  }
  async connect(input: ConnectInput = {}): Promise<ConnectionResult> {
    if (input.mode === 'api') throw new ProviderError(`${this.label}: official API transport is not enabled. Use email or assisted mode.`, 'unsupported');
    return input.mode === 'email'
      ? { status: 'pending', mode: 'email', instructions: 'Forward authentic review notification emails to your private Trusteo inbox. The first verified import activates ingestion.' }
      : { status: 'assisted', mode: 'assisted', instructions: 'Import an authentic notification or a real customer review; copy your response and publish it on the source platform.' };
  }
  async fetchReviews(_since?: Date): Promise<NormalizedReview[]> {
    throw new ProviderError(`${this.label}: polling is unavailable; reviews must arrive through authenticated email ingestion.`, 'unsupported');
  }
  async reply(_reviewId: string, _text: string): Promise<ReplyResult> {
    throw new ProviderError(`${this.label}: copy the response and publish it on the source platform.`, 'unsupported');
  }
}
export function assistedDefinition(id: PlatformId, label: string, requiresPartnership = true): ProviderDefinition {
  return {
    id, label, modes: ['email', 'assisted'],
    capabilities: { canRead: false, canReply: false, realtime: false, requiresPartnership },
    create: config => new AssistedProvider(id, label, config, requiresPartnership),
  };
}
