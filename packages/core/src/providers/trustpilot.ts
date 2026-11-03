import { Buffer } from 'node:buffer';
import { encodePath, providerRequest, requireValue, validReply } from './http';
import { OAuthProvider } from './oauth';
import { finiteRating,parseBusinessPreview,reviewCount,safeProfileUrl } from './preview';
import { normalizedReviewSchema, ProviderError, type BusinessPreview, type ConnectInput, type ConnectionResult, type NormalizedReview, type ProviderDefinition, type ReplyResult, type ReviewProvider } from './types';

type TrustpilotReview = {
  id: string; stars: number; title?: string; text?: string; language?: string; createdAt: string; updatedAt?: string;
  consumer?: { displayName?: string }; companyReply?: { text?: string };
};
export class TrustpilotProvider extends OAuthProvider implements ReviewProvider {
  readonly id = 'trustpilot' as const;
  readonly label = 'Trustpilot';
  get capabilities(){return {canRead:true,canReply:!this.credentials.apiKey,realtime:false,requiresPartnership:true};}
  protected readonly tokenUrl = 'https://api.trustpilot.com/v1/oauth/oauth-business-users-for-applications/accesstoken';
  protected tokenHeaders() {
    const clientId = requireValue(this.config.oauth?.clientId, 'Trustpilot clientId');
    const clientSecret = requireValue(this.config.oauth?.clientSecret, 'Trustpilot clientSecret');
    return { Authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString('base64')}` };
  }
  protected tokenParameters() { return {}; }
  async connect(input: ConnectInput = {}): Promise<ConnectionResult> {
    if (input.mode && input.mode !== 'api') return { mode: input.mode, status: input.mode === 'assisted' ? 'assisted' : 'pending', instructions: 'Use a trusted notification email or open Trustpilot to reply.' };
    if(this.credentials.apiKey){
      if(input.code)throw new ProviderError('Remove the stored API key before connecting an OAuth account.','configuration');
      await this.businessDetails();
      return {mode:'api',status:'connected',instructions:'Public read-only API access; this does not verify management rights and cannot publish replies.'};
    }
    if (input.code) {
      await this.tokenRequest({ grant_type: 'authorization_code', code: input.code, redirect_uri: requireValue(this.config.oauth?.redirectUri, 'Trustpilot redirectUri') });
      return { mode: 'api', status: 'connected' };
    }
    if (this.credentials.accessToken || this.credentials.refreshToken) {
      await this.accessToken();
      return { mode: 'api', status: 'connected' };
    }
    const url = new URL('https://authenticate.trustpilot.com/');
    url.search = new URLSearchParams({
      client_id: requireValue(this.config.oauth?.clientId, 'Trustpilot clientId'),
      redirect_uri: requireValue(this.config.oauth?.redirectUri, 'Trustpilot redirectUri'),
      response_type: 'code', state: requireValue(input.state, 'OAuth state'),
    }).toString();
    return { status: 'pending', mode: 'api', authorizationUrl: url.toString() };
  }
  private async businessDetails(){
    const businessUnit=requireValue(this.credentials.businessUnitId,'Trustpilot businessUnitId');
    const url=`https://api.trustpilot.com/v1/business-units/${encodePath(businessUnit)}`;
    type Details={id?:string;displayName?:string;name?:{identifying?:string};websiteUrl?:string;address?:{street?:string;postalCode?:string;city?:string;country?:string};score?:{stars?:number;trustScore?:number};numberOfReviews?:{total?:number}};
    if(this.credentials.apiKey)return providerRequest<Details>(this.request,url,{headers:{apikey:this.credentials.apiKey}});
    return this.authorized<Details>(url,{headers:{apikey:requireValue(this.config.oauth?.clientId,'Trustpilot application API key')}});
  }
  private async reviewPage(businessUnit:string,page:number,perPage:number){
    const isKey=!!this.credentials.apiKey;
    const url=new URL(`https://api.trustpilot.com/v1/${isKey?'':'private/'}business-units/${encodePath(businessUnit)}/reviews`);
    url.search=new URLSearchParams({page:String(page),perPage:String(perPage),orderBy:'createdat.desc'}).toString();
    const data=isKey
      ?await providerRequest<{reviews?:TrustpilotReview[]}>(this.request,url.toString(),{headers:{apikey:this.credentials.apiKey!}})
      :await this.authorized<{reviews?:TrustpilotReview[]}>(url.toString());
    if(!Array.isArray(data.reviews))throw new ProviderError('Trustpilot returned an invalid reviews collection.','upstream');
    return data.reviews;
  }
  private normalizeReview(review:TrustpilotReview):NormalizedReview {
    if(!Number.isInteger(review.stars)||review.stars<1||review.stars>5)throw new ProviderError('Trustpilot returned an invalid star rating.','upstream');
    const parsed=normalizedReviewSchema.safeParse({
      externalId:review.id,platform:this.id,locationId:this.config.locationId,
      author:review.consumer?.displayName||'Trustpilot user',rating:review.stars,
      text:[review.title,review.text].filter(Boolean).join('\n\n'),language:review.language||'und',publishedAt:new Date(review.createdAt),
      responseStatus:review.companyReply?.text?'replied':'pending',sourceUrl:`https://www.trustpilot.com/reviews/${encodePath(review.id)}`,reply:review.companyReply?.text,
    });
    if(!parsed.success)throw new ProviderError('Trustpilot returned invalid review fields.','upstream');
    return parsed.data;
  }
  async previewBusiness():Promise<BusinessPreview>{
    const businessUnit=requireValue(this.credentials.businessUnitId,'Trustpilot businessUnitId');
    const business=await this.businessDetails();
    if(business.id&&business.id!==businessUnit)throw new ProviderError('Trustpilot returned a different business unit.','upstream');
    const domain=business.name?.identifying;
    if(!domain||typeof domain!=='string')throw new ProviderError('Trustpilot returned an invalid business profile.','upstream');
    const website=safeProfileUrl(business.websiteUrl)??safeProfileUrl(domain.startsWith('https://')?domain:`https://${domain}`);
    const address=business.address;
    return parseBusinessPreview({
      platform:this.id,businessId:businessUnit,name:business.displayName,
      address:address?[address.street,address.postalCode,address.city,address.country].filter(Boolean).join(', ')||null:null,
      website,sourceUrl:`https://www.trustpilot.com/review/${encodePath(domain)}`,
      rating:finiteRating(business.score?.trustScore??business.score?.stars),reviewCount:reviewCount(business.numberOfReviews?.total),
      reviews:(await this.reviewPage(businessUnit,1,3)).slice(0,3).map(review=>this.normalizeReview(review)),
      authMethod:this.credentials.apiKey?'apiKey':'oauth',managementVerified:!this.credentials.apiKey,
    },[this.credentials.accessToken,this.credentials.refreshToken,this.credentials.apiKey,this.config.oauth?.clientSecret]);
  }
  async fetchReviews(since?: Date): Promise<NormalizedReview[]> {
    const businessUnit = requireValue(this.credentials.businessUnitId, 'Trustpilot businessUnitId');
    const result = new Map<string, NormalizedReview>();
    for (let page = 1; page <= 1000; page++) {
      const reviews=await this.reviewPage(businessUnit,page,100);
      for (const review of reviews) {
        const date = new Date(review.createdAt);
        const changedAt = new Date(review.updatedAt ?? review.createdAt);
        if (Number.isNaN(date.getTime()) || Number.isNaN(changedAt.getTime())) throw new ProviderError('Trustpilot returned an invalid review date.', 'upstream');
        if (since && changedAt < since) continue;
        const normalized=this.normalizeReview(review);
        result.set(normalized.externalId, normalized);
      }
      // Trustpilot is sorted by creation date: older edited reviews may still appear later.
      // Scan to the end before moving the sync cursor, even if this page has no new reviews.
      if (reviews.length < 100) return [...result.values()];
    }
    throw new ProviderError('Trustpilot pagination safety limit reached; synchronization is incomplete.', 'upstream');
  }
  async reply(reviewId: string, text: string): Promise<ReplyResult> {
    if(this.credentials.apiKey)throw new ProviderError('Trustpilot API-key access is read-only. Connect an authorized OAuth business account to publish replies.','unsupported');
    if (!reviewId) throw new ProviderError('Review ID is required.', 'validation');
    await this.authorized(`https://api.trustpilot.com/v1/private/reviews/${encodePath(reviewId)}/reply`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ message: validReply(text) }),
    });
    return { externalId: reviewId, status: 'published' };
  }
}
export const definition: ProviderDefinition = {
  id: 'trustpilot', label: 'Trustpilot',
  capabilities: { canRead: true, canReply: true, realtime: false, requiresPartnership: true },
  authMethods:['oauth','apiKey'],
  allowedReviewHosts: ['trustpilot.com'],
  modes: ['api', 'email', 'assisted'], create: config => new TrustpilotProvider(config),
};
