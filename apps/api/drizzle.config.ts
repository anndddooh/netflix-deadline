import { defineConfig } from 'drizzle-kit';

// drizzle-kit はスキーマから SQL マイグレーションを生成するのみ。
// 生成された SQL の適用は `wrangler d1 migrations apply` で行う。
export default defineConfig({
  dialect: 'sqlite',
  schema: './src/db/schema.ts',
  out: './drizzle',
});
