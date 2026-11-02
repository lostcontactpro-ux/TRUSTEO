import OpenAI from 'openai';
import type { AITransport } from '@trusteo/core/ai/replies';
import { HttpError } from './security';
export const aiTransport:AITransport=async(system,user)=>{if(!process.env.OPENAI_API_KEY)throw new HttpError(503,'Configurez OpenAI pour générer les réponses.');const client=new OpenAI({apiKey:process.env.OPENAI_API_KEY,timeout:25000,maxRetries:2});const response=await client.chat.completions.create({model:process.env.OPENAI_MODEL||'gpt-4.1-mini',response_format:{type:'json_object'},messages:[{role:'system',content:system},{role:'user',content:user}],max_completion_tokens:2000});const text=response.choices[0]?.message.content;if(!text)throw new HttpError(502,'Réponse IA vide');return text;};
