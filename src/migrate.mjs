import {closeDatabase, migrateOnly} from './db.mjs';

try {
  await migrateOnly();
  console.log('Schema PostgreSQL đã cập nhật.');
} finally {
  await closeDatabase();
}
