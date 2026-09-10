process.env.DATABASE_URL = 'postgresql://neondb_owner:npg_UXJl0qDiKM1m@ep-bitter-silence-ayq89y8b-pooler.c-5.us-east-2.aws.neon.tech/neondb?sslmode=require&channel_binding=require';
const { default: handler } = await import('./netlify/functions/api.mjs');
const res = await handler(new Request('http://localhost/api/health'));
console.log(res.status);
console.log(await res.text());
