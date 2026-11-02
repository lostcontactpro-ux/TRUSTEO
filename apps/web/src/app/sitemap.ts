import type {MetadataRoute} from 'next';
export default function sitemap():MetadataRoute.Sitemap{const base=process.env.APP_URL||'http://localhost:3000';return ['','/pricing','/contact','/legal','/terms','/privacy'].map(path=>({url:`${base}${path}`,changeFrequency:'monthly',priority:path===''?1:.6}));}
