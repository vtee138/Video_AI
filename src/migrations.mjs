import {createHash} from 'node:crypto';
import {readFile, readdir} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const directory = fileURLToPath(new URL('../migrations/', import.meta.url));

export async function migrateDatabase(pool) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('SELECT pg_advisory_xact_lock(736194, 1)');
    await client.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
      version text PRIMARY KEY,
      checksum text NOT NULL,
      applied_at timestamptz NOT NULL DEFAULT now()
    )`);
    const files = (await readdir(directory)).filter(name => /^\d+_[a-z0-9_]+\.sql$/.test(name)).sort();
    for (const file of files) {
      const sql = await readFile(path.join(directory, file), 'utf8');
      const checksum = createHash('sha256').update(sql).digest('hex');
      const {rows} = await client.query('SELECT checksum FROM schema_migrations WHERE version = $1', [file]);
      if (rows.length) {
        if (rows[0].checksum !== checksum) throw new Error(`Migration ${file} đã thay đổi sau khi chạy`);
        continue;
      }
      await client.query(sql);
      await client.query('INSERT INTO schema_migrations (version, checksum) VALUES ($1, $2)', [file, checksum]);
      console.log(`Đã áp dụng migration ${file}`);
    }
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}
