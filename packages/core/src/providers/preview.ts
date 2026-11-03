import { businessPreviewSchema,isSafeSourceUrl,ProviderError,type BusinessPreview } from './types';

/** Whitelist profile fields and redact URL credentials; never return raw API objects. */
export function parseBusinessPreview(value:unknown,secretValues:readonly(string|undefined)[]=[]):BusinessPreview {
  const parsed=businessPreviewSchema.safeParse(value);
  if(!parsed.success)throw new ProviderError('The provider returned an invalid business profile.','upstream');
  const serialized=JSON.stringify(parsed.data);
  if(secretValues.some(secret=>secret&&serialized.includes(secret)))throw new ProviderError('The provider returned an invalid business profile.','upstream');
  return parsed.data;
}
export function safeProfileUrl(value:unknown):string|null {
  if(typeof value!=='string'||!isSafeSourceUrl(value))return null;
  const url=new URL(value);
  // Public listing URLs may include place IDs; authentication parameters are never exposed.
  for(const name of [...url.searchParams.keys()]){
    if(/^(?:api[-_]?key|key|access[-_]?token|refresh[-_]?token|token|client[-_]?secret|authorization|auth|signature|code|state)$/i.test(name))url.searchParams.delete(name);
  }
  url.hash='';return url.toString();
}
export function finiteRating(value:unknown):number|null {
  return typeof value==='number'&&Number.isFinite(value)&&value>=0&&value<=5?value:null;
}
export function reviewCount(value:unknown):number|null {
  return typeof value==='number'&&Number.isSafeInteger(value)&&value>=0?value:null;
}
