import postgres from 'postgres';

try {
  process.loadEnvFile();
} catch {
  // no .env file
}

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  throw new Error('DATABASE_URL is not set (see .env.example)');
}

// One shared connection pool for the whole process.
export const sql = postgres(DATABASE_URL);
