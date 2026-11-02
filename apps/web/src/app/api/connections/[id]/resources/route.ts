import { providerRequest } from '@trusteo/core/providers/http';
import { requireUser } from '@/lib/auth';
import { db } from '@/lib/db';
import { apiError, HttpError, rateLimit } from '@/lib/security';
import { checkProviderSubscription, makeProvider, ownedConnection, readProviderCredentials, providerApiError } from '@/lib/providers';

// Discovery uses only fixed official API hosts; user-supplied account IDs are path segments.
export async function GET(request:Request,{params}:{params:Promise<{id:string}>}){try{
  const user=await requireUser();checkProviderSubscription(user.subscription);await rateLimit(`provider-resources:${user.id}`,20);
  const {id}=await params;const connection=await ownedConnection(id,user.id);
  if(connection.mode!=='api')throw new HttpError(409,'La découverte est réservée aux connexions API.');
  if(connection.platform==='trustpilot')return Response.json({accounts:[],locations:[],requiresBusinessUnitId:true});
  if(connection.platform!=='google')throw new HttpError(409,'Découverte API indisponible.');
  const accountId=new URL(request.url).searchParams.get('accountId');
  if(accountId&&!/^[A-Za-z0-9_-]{1,200}$/.test(accountId))throw new HttpError(400,'Compte Google invalide.');
  await makeProvider(connection).connect(); // Refresh expired access token, persist rotating tokens.
  const stored=await db.providerConnection.findUniqueOrThrow({where:{id}});
  const credentials=readProviderCredentials(stored);
  if(!credentials.accessToken)throw new HttpError(409,'Effectuez d’abord la connexion OAuth.');
  const headers={Authorization:`Bearer ${credentials.accessToken}`};
  const accounts:Array<{id:string;name:string}>=[];
  let pageToken='';const seenPages=new Set<string>();
  for(let page=0;page<100;page++){
    const url=new URL('https://mybusinessaccountmanagement.googleapis.com/v1/accounts');
    url.search=new URLSearchParams({pageSize:'20',...(pageToken?{pageToken}:{})}).toString();
    const result=await providerRequest<{accounts?:Array<{name:string;accountName?:string}>;nextPageToken?:string}>(fetch,url.toString(),{headers});
    for(const account of result.accounts??[])accounts.push({id:account.name.replace(/^accounts\//,''),name:account.accountName??account.name});
    if(!result.nextPageToken){pageToken='';break;}
    if(seenPages.has(result.nextPageToken))throw new HttpError(502,'Pagination Google invalide.');
    seenPages.add(result.nextPageToken);pageToken=result.nextPageToken;
  }
  if(pageToken)throw new HttpError(502,'Trop de comptes Google pour une découverte complète.');
  const locations:Array<{id:string;title:string;address:string;accountId:string}>=[];
  if(accountId){
    if(!accounts.some(account=>account.id===accountId))throw new HttpError(403,'Compte Google non autorisé.');
    pageToken='';seenPages.clear();
    for(let page=0;page<100;page++){
      const url=new URL(`https://mybusinessbusinessinformation.googleapis.com/v1/accounts/${encodeURIComponent(accountId)}/locations`);
      url.search=new URLSearchParams({pageSize:'100',readMask:'name,title,storefrontAddress',...(pageToken?{pageToken}:{})}).toString();
      const result=await providerRequest<{locations?:Array<{name:string;title?:string;storefrontAddress?:{addressLines?:string[];locality?:string;postalCode?:string}}>;nextPageToken?:string}>(fetch,url.toString(),{headers});
      for(const location of result.locations??[])locations.push({id:location.name.replace(/^locations\//,''),title:location.title??location.name,address:[...(location.storefrontAddress?.addressLines??[]),location.storefrontAddress?.postalCode,location.storefrontAddress?.locality].filter(Boolean).join(', '),accountId});
      if(!result.nextPageToken){pageToken='';break;}
      if(seenPages.has(result.nextPageToken))throw new HttpError(502,'Pagination Google invalide.');
      seenPages.add(result.nextPageToken);pageToken=result.nextPageToken;
    }
    if(pageToken)throw new HttpError(502,'Trop d’établissements Google pour une découverte complète.');
  }
  return Response.json({accounts,locations});
}catch(error){try{providerApiError(error)}catch(mapped){return apiError(mapped)}}}
