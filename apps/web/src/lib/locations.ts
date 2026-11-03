import {z} from 'zod';
export const locationInput = z.object({name:z.string().trim().min(2).max(100),address:z.string().trim().min(3).max(200),city:z.string().trim().min(2).max(100),reviewUrl:z.union([z.url().startsWith('https://'),z.literal('')]).optional()});
