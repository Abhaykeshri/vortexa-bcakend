import { Pool } from 'pg';
import { createClient } from 'redis';

export async function checkPostgres(databaseUrl: string): Promise<boolean> {
  const pool = new Pool({
    connectionString: databaseUrl,
    connectionTimeoutMillis: 5000,
    max: 1,
  });

  try {
    const result = await pool.query<{ connected: number }>('SELECT 1 AS connected');
    return result.rows[0]?.connected === 1;
  } finally {
    await pool.end();
  }
}

export async function checkRedis(redisUrl: string): Promise<boolean> {
  const client = createClient({
    url: redisUrl,
    socket: {
      connectTimeout: 5000,
      reconnectStrategy: false,
    },
  });

  client.on('error', () => {});

  try {
    await client.connect();
    return (await client.ping()) === 'PONG';
  } finally {
    if (client.isOpen) {
      await client.close();
    }
  }
}
