import { cpSync,mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
const web=fileURLToPath(new URL('../apps/web/',import.meta.url));
const target=`${web}.next/standalone/apps/web`;
mkdirSync(`${target}/.next`,{recursive:true});
cpSync(`${web}public`,`${target}/public`,{recursive:true});
cpSync(`${web}.next/static`,`${target}/.next/static`,{recursive:true});
