import { Client } from 'pg';
import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
// Prisma's official WASM diff generates these SQL files. PostgreSQL executes
// them transactionally; a checksum ledger prevents changed applied migrations.
const directory=fileURLToPath(new URL('../apps/web/prisma/migrations/',import.meta.url));
if(!process.env.DATABASE_URL)throw new Error('DATABASE_URL is required');
const client=new Client({connectionString:process.env.DATABASE_URL});
await client.connect();
try {
 await client.query('SELECT pg_advisory_lock(734621091)');
 await client.query('CREATE TABLE IF NOT EXISTS "_trusteo_migrations" (name text PRIMARY KEY, checksum text NOT NULL, applied_at timestamptz NOT NULL DEFAULT now())');
 for(const name of (await readdir(directory,{withFileTypes:true})).filter(d=>d.isDirectory()).map(d=>d.name).sort()){
  const sql=await readFile(`${directory}/${name}/migration.sql`,'utf8');
  if(!sql.trim())throw new Error(`Empty migration: ${name}`);
  const checksum=createHash('sha256').update(sql).digest('hex');
  const {rows}=await client.query('SELECT checksum FROM "_trusteo_migrations" WHERE name=$1',[name]);
  if(rows.length){if(rows[0].checksum!==checksum)throw new Error(`Applied migration changed: ${name}`);continue;}
  await client.query('BEGIN');
  try{await client.query(sql);await client.query('INSERT INTO "_trusteo_migrations" (name,checksum) VALUES($1,$2)',[name,checksum]);await client.query('COMMIT');console.log(`Applied ${name}`);}
  catch(error){await client.query('ROLLBACK');throw error;}
 }
 console.log('Database migrations up to date.');
}finally{await client.query('SELECT pg_advisory_unlock(734621091)').catch(()=>{});await client.end();}
