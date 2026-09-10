$env:DATABASE_URL='postgresql://neondb_owner:npg_UXJl0qDiKM1m@ep-bitter-silence-ayq89y8b-pooler.c-5.us-east-2.aws.neon.tech/neondb?sslmode=require&channel_binding=require'
Set-Location 'C:\Users\hp\Downloads\kgroupmanagement'
node scripts/migrate.mjs
node --input-type=module -e 'import { neon } from "@neondatabase/serverless"; const sql = neon(process.env.DATABASE_URL); const rows = await sql`select current_database() as db, current_user as user, (select count(*) from information_schema.tables where table_schema = ''public'') as table_count`; console.log(JSON.stringify(rows[0]));'
