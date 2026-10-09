import {closeDatabase, initDatabase, listVideos, seedExistingOutputs} from './db.mjs';

try {
  await initDatabase({markInterrupted: false});
  const seeded = await seedExistingOutputs();
  const total = (await listVideos(10000)).length;
  console.log(`Đã seed ${seeded.videos} MP4 và ${seeded.jobs} job mới. Tổng video: ${total}.`);
} finally {
  await closeDatabase();
}
