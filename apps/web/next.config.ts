import type { NextConfig } from 'next';
import { createRequire } from 'node:module';
import path from 'node:path';
import createNextIntlPlugin from 'next-intl/plugin';
const applicationRequire = createRequire(path.join(__dirname, 'package.json'));
const repositoryRoot = path.resolve(__dirname, '../..');
// Prisma loads this compiler via fs at runtime; its generated dynamic path is
// not discovered automatically by Next's dependency tracing.
// The config may be inspected before prisma generate; the installed package
// exists then, while the generated WASM is checked after the build.
const prismaPackageDirectory = path.dirname(applicationRequire.resolve('@prisma/client/package.json'));
const compilerWasm = path.resolve(prismaPackageDirectory, '../../.prisma/client/query_compiler_bg.wasm');
const compilerTracePath = path.relative(__dirname, compilerWasm).split(path.sep).join('/');

const config: NextConfig = {
  outputFileTracingRoot: repositoryRoot,
  outputFileTracingIncludes: { '/*': [compilerTracePath] },
  devIndicators:false, allowedDevOrigins:['127.0.0.1'], output: 'standalone', serverExternalPackages:['bullmq','ioredis'], transpilePackages: ['@trusteo/core'],
  experimental: { cpus: 2 },
  async headers() { return [{source:'/(.*)',headers:[
    {key:'X-Content-Type-Options',value:'nosniff'},
    {key:'Referrer-Policy',value:'strict-origin-when-cross-origin'},
    {key:'X-Frame-Options',value:'DENY'},
    {key:'Permissions-Policy',value:'camera=(), microphone=(), geolocation=()'},
    {key:'Content-Security-Policy',value:`default-src 'self'; script-src 'self' 'unsafe-inline' ${process.env.NODE_ENV==='development'?"'unsafe-eval'":''} https://js.stripe.com; style-src 'self' 'unsafe-inline'; img-src 'self' data: https:; font-src 'self'; connect-src 'self'; frame-src https://js.stripe.com https://checkout.stripe.com; object-src 'none'; base-uri 'self'; frame-ancestors 'none'; form-action 'self' https://checkout.stripe.com`}
  ]}]; }
};
export default createNextIntlPlugin('./src/i18n/request.ts')(config);
