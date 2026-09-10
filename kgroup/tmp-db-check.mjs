import { neon } from '@neondatabase/serverless';

const url = 'postgresql://neondb_owner:npg_UXJl0qDiKM1m@ep-bitter-silence-ayq89y8b-pooler.c-5.us-east-2.aws.neon.tech/neondb?sslmode=require&channel_binding=require';
const sql = neon(url);

const rows = await sql`select current_database() as db, current_user as user, (select count(*) from information_schema.tables where table_schema = 'public') as table_count`;
console.log(JSON.stringify(rows[0]));

const tables = await sql`select table_name from information_schema.tables where table_schema='public' order by table_name`;
console.log(JSON.stringify(tables.map(r => r.table_name)));
