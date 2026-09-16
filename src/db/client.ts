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
export const sql = postgres(DATABASE_URL, {
  // Keep DATE as 'YYYY-MM-DD'. The default would be a JS Date at local midnight,
  // which shifts the day depending on the machine timezone.
  types: {
    date: {
      to: 1082,
      from: [1082],
      serialize: (value: string | Date) =>
        value instanceof Date ? value.toISOString().slice(0, 10) : value,
      parse: (value: string) => value,
    },
  },
});
