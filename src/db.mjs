import {readFile, readdir, stat} from 'node:fs/promises';
import path from 'node:path';
import pg from 'pg';
import {migrateDatabase} from './migrations.mjs';
import {outputDir, root} from './common.mjs';
import {withoutSourceAppendix} from './caption.mjs';
import {publicationStatus} from './publication.mjs';
import {summarizeSession} from './session.mjs';
import {validateSuperFootageRepair, validateSuperRetry} from './super-auto.mjs';
import {mediaReference} from './storage.mjs';
export {publicationStatus} from './publication.mjs';

const {Pool} = pg;

function connectionString() {
  if (process.env.RUNNING_IN_DOCKER !== '1' && process.env.DATABASE_URL &&
      !process.env.DATABASE_URL.includes('<')) return process.env.DATABASE_URL;
  const password = process.env.POSTGRES_PASSWORD;
  if (!password) throw new Error('Thiếu POSTGRES_PASSWORD hoặc DATABASE_URL trong .env.');
  const user = encodeURIComponent(process.env.POSTGRES_USER || 'video_studio');
  const database = encodeURIComponent(process.env.POSTGRES_DB || 'video_studio');
  const port = Number(process.env.POSTGRES_PORT || 5433);
  const host = process.env.POSTGRES_HOST || '127.0.0.1';
  return `postgresql://${user}:${encodeURIComponent(password)}@${host}:${port}/${database}`;
}

const pool = new Pool({connectionString: connectionString(), max: 5,
  connectionTimeoutMillis: 5000, idleTimeoutMillis: 30000});
pool.on('error', error => console.error('PostgreSQL:', error.message));

export async function migrateOnly() {
  await migrateDatabase(pool);
}

export async function initDatabase() {
  await migrateOnly();
  const storedVideos = await pool.query('SELECT output_name FROM videos');
  for (const row of storedVideos.rows) {
    const fallbackUrl = `/output/${encodeURIComponent(row.output_name)}`;
    const storage = mediaReference(path.join(outputDir, row.output_name), {fallbackUrl});
    await pool.query(`UPDATE videos SET storage_provider=$2, storage_key=$3, media_url=$4
      WHERE output_name=$1`, [row.output_name, storage.provider, storage.key, storage.url]);
  }
  await pool.query(`UPDATE flow_jobs SET state=CASE
      WHEN state IN ('generating_image', 'queued_image') THEN 'ready_image'
      ELSE 'ready_video' END,
    error='App đã khởi động lại; hãy tiếp tục job trong trang Flow.'
    WHERE state IN ('generating_image', 'queued_image', 'generating_video', 'queued_video')`);
  await pool.query(`UPDATE jobs SET status = 'interrupted',
    step = 'Server đã dừng; có thể khôi phục footage hoặc tạo lại phiên', updated_at = now()
    WHERE status NOT IN ('done', 'error', 'interrupted')`);
  const active = await pool.query('SELECT id, results FROM posts');
  for (const row of active.rows) {
    let changed = false;
    const results = {...row.results};
    for (const result of Object.values(results)) {
      if (['queued', 'uploading'].includes(result.state)) {
        result.state = 'interrupted';
        result.error = 'Server đã dừng trong lúc tải lên. Kiểm tra tài khoản trước khi đăng lại.';
        changed = true;
      }
    }
    if (changed) await pool.query('UPDATE posts SET results = $2::jsonb, updated_at = now() WHERE id = $1',
      [row.id, JSON.stringify(results)]);
  }
  await pool.query(`UPDATE super_items SET status = 'failed', recovery_pending = true,
    error = 'Server khởi động lại khi đang tạo video; hệ thống sẽ tự tiếp tục lượt này.', updated_at = now()
    WHERE status IN ('planning', 'producing')`);
  await pool.query(`UPDATE super_campaigns SET status = 'attention',
    error = 'Server dừng khi đang đăng. Hãy kiểm tra nền tảng trước khi tiếp tục.', updated_at = now()
    WHERE id IN (SELECT campaign_id FROM super_items WHERE status = 'publishing')`);
  await pool.query(`UPDATE super_items SET status = 'needs_review',
    error = 'Có thể bài đã được gửi trước khi server dừng; không tự đăng lại.', updated_at = now()
    WHERE status = 'publishing'`);
}

const flowAsset = row => ({id: row.id, kind: row.kind, name: row.name,
  createdAt: row.created_at.toISOString()});
const flowJob = row => ({id: row.id, state: row.state, category: row.category,
  duration: row.duration, backgroundId: row.background_id, modelId: row.model_id,
  hasAction: row.has_action, continuousVideo: row.continuous_video,
  sourceSeconds: row.source_seconds, error: row.error,
  createdAt: row.created_at.toISOString(), updatedAt: row.updated_at.toISOString()});

export async function createFlowAsset({id, kind, name}) {
  const {rows} = await pool.query(`INSERT INTO flow_assets (id,kind,name) VALUES ($1,$2,$3) RETURNING *`,
    [id, kind, name]);
  return flowAsset(rows[0]);
}
export async function listFlowAssets() {
  const {rows} = await pool.query('SELECT * FROM flow_assets ORDER BY created_at DESC');
  return rows.map(flowAsset);
}
export async function getFlowAsset(id) {
  const {rows} = await pool.query('SELECT * FROM flow_assets WHERE id=$1', [id]);
  return rows[0] ? flowAsset(rows[0]) : null;
}
export async function createFlowJob(job) {
  const {rows} = await pool.query(`INSERT INTO flow_jobs
    (id,state,category,duration,background_id,model_id,has_action,continuous_video)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
    [job.id, 'uploading', job.category, job.duration, job.backgroundId, job.modelId,
      job.hasAction, job.continuousVideo]);
  return flowJob(rows[0]);
}
export async function getFlowJob(id) {
  const {rows} = await pool.query('SELECT * FROM flow_jobs WHERE id=$1', [id]);
  return rows[0] ? flowJob(rows[0]) : null;
}
export async function listFlowJobs() {
  const {rows} = await pool.query('SELECT * FROM flow_jobs ORDER BY updated_at DESC LIMIT 100');
  return rows.map(flowJob);
}
export async function updateFlowJob(id, patch) {
  const columns = {state: 'state', error: 'error', duration: 'duration',
    sourceSeconds: 'source_seconds'};
  const keys = Object.keys(patch).filter(key => columns[key]);
  if (!keys.length) return getFlowJob(id);
  const assignments = keys.map((key, index) => `${columns[key]}=$${index + 2}`);
  const {rows} = await pool.query(`UPDATE flow_jobs SET ${assignments.join(',')},updated_at=now()
    WHERE id=$1 RETURNING *`, [id, ...keys.map(key => patch[key])]);
  return rows[0] ? flowJob(rows[0]) : null;
}

const campaignFromRow = row => ({id: row.id, status: row.status, template: row.template, mode: row.mode,
  focus: row.focus, intervalMinutes: row.interval_minutes, nextAt: row.next_at.toISOString(),
  readyAfter: row.ready_after.toISOString(), lastStartedAt: row.last_started_at?.toISOString() || null,
  autoSettings: row.auto_settings, error: row.error, createdAt: row.created_at.toISOString(),
  updatedAt: row.updated_at.toISOString()});
const itemFromRow = row => ({id: row.id, campaignId: row.campaign_id, topic: row.topic,
  jobId: row.job_id, scheduledAt: row.scheduled_at.toISOString(), status: row.status,
  outputName: row.output_name, postId: row.post_id, targets: row.targets, error: row.error,
  recoveryPending: row.recovery_pending, retryRequested: row.retry_requested,
  postResults: row.post_results || null,
  createdAt: row.created_at.toISOString()});

export async function createSuperCampaign(campaign) {
  const {rows} = await pool.query(`INSERT INTO super_campaigns
    (id,status,template,mode,focus,interval_minutes,next_at,auto_settings)
    VALUES ($1,'active',$2,$3,$4,$5,$6,$7::jsonb) RETURNING *`,
  [campaign.id, campaign.template, campaign.mode, campaign.focus, campaign.intervalMinutes,
    campaign.startAt, JSON.stringify(campaign.autoSettings)]);
  return campaignFromRow(rows[0]);
}

export async function listSuperCampaigns(limit = 10) {
  const {rows} = await pool.query('SELECT * FROM super_campaigns ORDER BY created_at DESC LIMIT $1', [limit]);
  if (!rows.length) return [];
  const {rows: countRows} = await pool.query(`SELECT campaign_id, status, count(*)::integer AS total
    FROM super_items WHERE campaign_id = ANY($1::text[]) GROUP BY campaign_id, status`,
  [rows.map(row => row.id)]);
  const countsByCampaign = new Map();
  for (const count of countRows) {
    if (!countsByCampaign.has(count.campaign_id)) countsByCampaign.set(count.campaign_id, {});
    countsByCampaign.get(count.campaign_id)[count.status] = count.total;
  }
  const campaigns = [];
  for (const row of rows) {
    const {rows: items} = await pool.query(`SELECT i.*, p.results AS post_results FROM super_items i
      LEFT JOIN posts p ON p.id = i.post_id WHERE i.campaign_id = $1
      ORDER BY i.created_at DESC LIMIT 50`, [row.id]);
    const byStatus = countsByCampaign.get(row.id) || {};
    campaigns.push({...campaignFromRow(row), counts: {
      total: Object.values(byStatus).reduce((sum, value) => sum + value, 0),
      sent: byStatus.sent || 0, scheduled: byStatus.scheduled || 0,
      producing: (byStatus.planning || 0) + (byStatus.producing || 0),
      manualReview: byStatus.manual_review || 0,
      publishing: byStatus.publishing || 0, failed: byStatus.failed || 0,
      needsReview: byStatus.needs_review || 0, canceled: byStatus.canceled || 0,
    }, items: items.map(itemFromRow)});
  }
  return campaigns;
}

export async function activeSuperCampaigns() {
  const {rows} = await pool.query("SELECT * FROM super_campaigns WHERE status = 'active' ORDER BY created_at");
  return rows.map(campaignFromRow);
}

export async function interruptedSuperRetries() {
  const {rows} = await pool.query(`SELECT DISTINCT ON (i.campaign_id)
    i.campaign_id, i.id AS item_id
    FROM super_items i JOIN super_campaigns c ON c.id = i.campaign_id
    WHERE i.status = 'failed' AND i.recovery_pending = true AND c.status = 'active'
    ORDER BY i.campaign_id, i.created_at DESC`);
  return rows.map(row => ({campaignId: row.campaign_id, itemId: row.item_id}));
}

export async function queueFailedSuperRetries(campaignId, autoSettings = null) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const {rows: campaigns} = await client.query(
      'SELECT * FROM super_campaigns WHERE id = $1 FOR UPDATE', [campaignId]);
    if (!campaigns.length) throw new Error('Không tìm thấy chiến dịch Super Auto.');
    const {rows: unsafe} = await client.query(`SELECT id FROM super_items
      WHERE campaign_id = $1 AND status IN ('publishing','needs_review') LIMIT 1`, [campaignId]);
    if (unsafe.length) throw new Error('Còn bài đăng cần kiểm tra trước khi Retry hàng loạt.');
    const {rowCount} = await client.query(`UPDATE super_items i SET retry_requested = true,
      error = NULL, updated_at = now()
      WHERE i.campaign_id = $1 AND i.status = 'failed' AND i.post_id IS NULL
      AND NOT EXISTS (SELECT 1 FROM posts p WHERE p.output_name = i.output_name)`, [campaignId]);
    if (!rowCount) throw new Error('Không có video lỗi an toàn để Retry.');
    await client.query(`UPDATE super_campaigns SET status = 'active', error = NULL,
      failure_count = 0, ready_after = now(),
      auto_settings = COALESCE($2::jsonb, auto_settings), updated_at = now()
      WHERE id = $1`, [campaignId, autoSettings ? JSON.stringify(autoSettings) : null]);
    await client.query('COMMIT');
    return rowCount;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally { client.release(); }
}

export async function claimNextSuperRetry(campaignId) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const {rows} = await client.query(`SELECT i.* FROM super_items i
      JOIN super_campaigns c ON c.id = i.campaign_id
      WHERE i.campaign_id = $1 AND i.status = 'failed' AND i.retry_requested = true
      AND c.status = 'active' ORDER BY i.created_at ASC LIMIT 1 FOR UPDATE OF i SKIP LOCKED`, [campaignId]);
    if (!rows.length) { await client.query('COMMIT'); return null; }
    const {rows: claimed} = await client.query(`UPDATE super_items i SET status = 'producing',
      retry_requested = false, recovery_pending = false, error = NULL,
      scheduled_at = GREATEST(now(), c.next_at,
        COALESCE(c.last_started_at + make_interval(mins => c.interval_minutes), now())),
      updated_at = now() FROM super_campaigns c
      WHERE i.id = $1 AND c.id = i.campaign_id RETURNING i.*`, [rows[0].id]);
    await client.query('COMMIT');
    return itemFromRow(claimed[0]);
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally { client.release(); }
}

export async function openSuperItem(campaign) {
  const {rows: current} = await pool.query(`SELECT id FROM super_items WHERE campaign_id = $1
    AND status IN ('planning','producing','manual_review','scheduled','publishing') LIMIT 1`, [campaign.id]);
  return current.length > 0;
}

export async function recentSuperTopics(campaignId) {
  const {rows} = await pool.query(`SELECT topic FROM super_items WHERE campaign_id = $1 AND topic IS NOT NULL
    ORDER BY created_at DESC LIMIT 20`, [campaignId]);
  return rows.map(row => row.topic);
}

export async function createSuperItem(id, campaignId, scheduledAt) {
  const {rows} = await pool.query(`INSERT INTO super_items (id,campaign_id,scheduled_at,status)
    VALUES ($1,$2,$3,'planning') RETURNING *`, [id, campaignId, scheduledAt]);
  return itemFromRow(rows[0]);
}

export async function updateSuperItem(id, fields) {
  const columns = {status: 'status', topic: 'topic', jobId: 'job_id', outputName: 'output_name',
    postId: 'post_id', targets: 'targets', error: 'error'};
  const entries = Object.entries(fields).filter(([key]) => columns[key]);
  if (!entries.length) return;
  const assignments = entries.map(([key], index) => `${columns[key]} = $${index + 2}${key === 'targets' ? '::jsonb' : ''}`);
  const values = entries.map(([key, value]) => key === 'targets' ? JSON.stringify(value) : value);
  await pool.query(`UPDATE super_items SET ${assignments.join(', ')}, updated_at = now() WHERE id = $1`,
    [id, ...values]);
}

export async function scheduleSuperItem(id, outputName, targets) {
  const {rows} = await pool.query(`UPDATE super_items i SET status = 'scheduled',
    output_name = $2, targets = $3::jsonb, updated_at = now()
    FROM super_campaigns c WHERE i.id = $1 AND c.id = i.campaign_id AND c.status = 'active'
    RETURNING i.id`, [id, outputName, JSON.stringify(targets)]);
  if (!rows.length) await updateSuperItem(id, {status: 'canceled', outputName});
  return Boolean(rows.length);
}

export async function failSuperItem(id, message) {
  await updateSuperItem(id, {status: 'failed', error: message});
  await pool.query(`UPDATE super_campaigns SET
    failure_count = failure_count + 1,
    status = CASE WHEN failure_count + 1 >= 3 THEN 'attention' ELSE status END,
    error = CASE WHEN failure_count + 1 >= 3 THEN
      'Ba lượt liên tiếp không thể hoàn tất. Kiểm tra cấu hình rồi tiếp tục. Lỗi gần nhất: ' || $2 ELSE $2 END,
    ready_after = now() + make_interval(mins => LEAST(interval_minutes, 30)), updated_at = now()
    WHERE id = (SELECT campaign_id FROM super_items WHERE id = $1) AND status = 'active'`, [id, message]);
}

export async function claimSuperItemRetry(campaignId, itemId) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const {rows: campaignRows} = await client.query(
      'SELECT * FROM super_campaigns WHERE id = $1 FOR UPDATE', [campaignId]);
    const {rows: itemRows} = await client.query(
      'SELECT * FROM super_items WHERE id = $1 AND campaign_id = $2 FOR UPDATE', [itemId, campaignId]);
    const campaign = campaignRows[0];
    const item = itemRows[0];
    if (!campaign || !item) throw new Error('Không tìm thấy video trong chiến dịch Super Auto.');
    let hasPostHistory = false;
    if (item.output_name) {
      const {rows: postRows} = await client.query(
        'SELECT id FROM posts WHERE output_name = $1 LIMIT 1', [item.output_name]);
      hasPostHistory = postRows.length > 0;
    }
    const {rows: reviewRows} = await client.query(`SELECT id FROM super_items
      WHERE campaign_id = $1 AND status = 'needs_review' LIMIT 1`, [campaignId]);
    const {rows: openRows} = await client.query(`SELECT id FROM super_items
      WHERE campaign_id = $1 AND id <> $2
      AND status IN ('planning','producing','manual_review','scheduled','publishing') LIMIT 1`, [campaignId, itemId]);
    validateSuperRetry({campaignStatus: campaign.status, itemStatus: item.status,
      postId: item.post_id, hasPostHistory, hasNeedsReview: reviewRows.length > 0,
      hasOpenItem: openRows.length > 0});
    const {rows: retriedRows} = await client.query(`UPDATE super_items i SET
      status = 'producing', error = NULL, recovery_pending = false, retry_requested = false,
      scheduled_at = GREATEST(now(), c.next_at,
        COALESCE(c.last_started_at + make_interval(mins => c.interval_minutes), now())),
      updated_at = now()
      FROM super_campaigns c WHERE i.id = $1 AND c.id = i.campaign_id RETURNING i.*`, [itemId]);
    const {rows: resumedRows} = await client.query(`UPDATE super_campaigns SET status = 'active',
      error = NULL, failure_count = 0, ready_after = now(), updated_at = now()
      WHERE id = $1 RETURNING *`, [campaignId]);
    await client.query('COMMIT');
    return {campaign: campaignFromRow(resumedRows[0]), item: itemFromRow(retriedRows[0])};
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally { client.release(); }
}

export async function claimSuperItemFootageRepair(campaignId, itemId) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const {rows: campaignRows} = await client.query(
      'SELECT * FROM super_campaigns WHERE id = $1 FOR UPDATE', [campaignId]);
    const {rows: itemRows} = await client.query(
      'SELECT * FROM super_items WHERE id = $1 AND campaign_id = $2 FOR UPDATE', [itemId, campaignId]);
    const campaign = campaignRows[0];
    const item = itemRows[0];
    if (!campaign || !item) throw new Error('Không tìm thấy video trong chiến dịch Super Auto.');
    let hasPostHistory = false;
    if (item.output_name) {
      const {rows: postRows} = await client.query(
        'SELECT id FROM posts WHERE output_name = $1 LIMIT 1', [item.output_name]);
      hasPostHistory = postRows.length > 0;
    }
    validateSuperFootageRepair({itemStatus: item.status, jobId: item.job_id,
      postId: item.post_id, hasPostHistory, error: item.error});
    const originalStatus = item.status;
    const originalError = item.error;
    const {rows: repairedRows} = await client.query(`UPDATE super_items SET
      status = 'manual_review', error = NULL, recovery_pending = false, retry_requested = false,
      updated_at = now() WHERE id = $1 RETURNING *`, [itemId]);
    await client.query('COMMIT');
    return {campaign: campaignFromRow(campaign), item: itemFromRow(repairedRows[0]),
      originalStatus, originalError};
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally { client.release(); }
}

export async function flagSuperAttention(id, message) {
  await updateSuperItem(id, {status: 'needs_review', error: message});
  await pool.query(`UPDATE super_campaigns SET status = 'attention', error = $2, updated_at = now()
    WHERE id = (SELECT campaign_id FROM super_items WHERE id = $1) AND status = 'active'`, [id, message]);
}

export async function claimDueSuperItem() {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const {rows} = await client.query(`SELECT i.* FROM super_items i
      JOIN super_campaigns c ON c.id = i.campaign_id
      WHERE i.status = 'scheduled' AND c.status = 'active'
        AND i.scheduled_at <= now()
        AND (c.last_started_at IS NULL OR c.last_started_at + make_interval(mins => c.interval_minutes) <= now())
      ORDER BY i.scheduled_at FOR UPDATE OF i SKIP LOCKED LIMIT 1`);
    if (!rows.length) { await client.query('COMMIT'); return null; }
    const item = rows[0];
    await client.query("UPDATE super_items SET status = 'publishing', updated_at = now() WHERE id = $1", [item.id]);
    await client.query('UPDATE super_campaigns SET last_started_at = now(), updated_at = now() WHERE id = $1',
      [item.campaign_id]);
    await client.query('COMMIT');
    return itemFromRow(item);
  } catch (error) { await client.query('ROLLBACK'); throw error; }
  finally { client.release(); }
}

export async function finishSuperItem(id, postId, failed) {
  await updateSuperItem(id, {status: failed ? 'failed' : 'sent', postId,
    error: failed ? 'Tất cả nền tảng báo lỗi; kiểm tra trước khi đăng lại.' : null});
  await pool.query(`UPDATE super_campaigns SET
    next_at = GREATEST(next_at, last_started_at + make_interval(mins => interval_minutes)),
    failure_count = CASE WHEN $2 THEN failure_count + 1 ELSE 0 END,
    status = CASE WHEN $2 AND failure_count + 1 >= 3 AND status = 'active' THEN 'attention' ELSE status END,
    error = CASE WHEN $2 THEN 'Các nền tảng đều báo lỗi đăng. Kiểm tra tài khoản.' ELSE NULL END,
    ready_after = now(), updated_at = now()
    WHERE id = (SELECT campaign_id FROM super_items WHERE id = $1)`, [id, failed]);
}

export async function stopSuperCampaign(id) {
  const {rowCount} = await pool.query(`UPDATE super_campaigns SET status = 'stopped', updated_at = now()
    WHERE id = $1 AND status IN ('active','attention')`, [id]);
  if (!rowCount) throw new Error('Chiến dịch không còn hoạt động.');
  await pool.query(`UPDATE super_items SET status = 'canceled', updated_at = now()
    WHERE campaign_id = $1 AND status = 'scheduled'`, [id]);
}

export async function resumeSuperCampaign(id) {
  const {rowCount} = await pool.query(`UPDATE super_campaigns SET status = 'active', error = NULL,
    failure_count = 0, ready_after = now(), next_at = GREATEST(next_at, now()), updated_at = now()
    WHERE id = $1 AND status = 'attention'`, [id]);
  if (!rowCount) throw new Error('Chiến dịch không cần tiếp tục.');
  await pool.query(`UPDATE super_items SET status = 'failed',
    error = 'Đã kiểm tra thủ công; bài này không được gửi lại tự động.', updated_at = now()
    WHERE campaign_id = $1 AND status = 'needs_review'`, [id]);
}

export async function saveVideo(video, legacy = false) {
  const fallbackUrl = `/output/${encodeURIComponent(video.outputName)}`;
  const storage = mediaReference(path.join(outputDir, video.outputName), {fallbackUrl});
  await pool.query(`INSERT INTO videos
    (output_name, run_id, title, caption, template, manual_publication, rendered_at,
      storage_provider, storage_key, media_url)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
    ON CONFLICT (output_name) DO UPDATE SET
      run_id = COALESCE(EXCLUDED.run_id, videos.run_id),
      title = EXCLUDED.title, caption = EXCLUDED.caption,
      template = COALESCE(EXCLUDED.template, videos.template),
      storage_provider = EXCLUDED.storage_provider, storage_key = EXCLUDED.storage_key,
      media_url = EXCLUDED.media_url, updated_at = now()`,
  [video.outputName, video.runId || null, video.title, video.caption || '', video.template || null,
    legacy ? 'unknown' : 'not_posted', video.renderedAt || new Date().toISOString(),
    storage.provider, storage.key, storage.url]);
}

export async function saveJob(job) {
  await pool.query(`INSERT INTO jobs
    (run_id, parent_id, title, template, mode, status, step, progress, error, output_name, auto_mode, auto_settings)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12::jsonb)
    ON CONFLICT (run_id) DO UPDATE SET
      parent_id = EXCLUDED.parent_id, title = EXCLUDED.title, template = EXCLUDED.template,
      mode = EXCLUDED.mode, status = EXCLUDED.status, step = EXCLUDED.step,
      progress = EXCLUDED.progress, error = EXCLUDED.error, output_name = EXCLUDED.output_name,
      auto_mode = jobs.auto_mode OR EXCLUDED.auto_mode,
      auto_settings = COALESCE(EXCLUDED.auto_settings, jobs.auto_settings), updated_at = now()`,
  [job.id, job.parentId || null, job.idea?.title || job.title ||
    (job.prompt ? `Phiên: ${job.prompt.slice(0, 100)}` : 'Video chưa đặt tên'),
    job.template || 'ranking', job.mode || null, job.status, job.step || null,
    job.progress || 0, job.error || null, job.outputName || null, Boolean(job.autoSettings),
    job.autoSettings ? JSON.stringify(job.autoSettings) : null]);
}

export async function loadSessionForRetry(id) {
  const {rows} = await pool.query(`SELECT run_id, parent_id, title, template, mode, status,
    step, progress, error, output_name, auto_mode, auto_settings FROM jobs
    WHERE run_id = $1 OR parent_id = $1 ORDER BY run_id`, [id]);
  return {parent: rows.find(row => row.run_id === id && !row.parent_id),
    children: rows.filter(row => row.parent_id === id)};
}

export async function videoForRun(id) {
  const {rows} = await pool.query(`SELECT output_name FROM videos WHERE run_id = $1
    ORDER BY rendered_at DESC LIMIT 1`, [id]);
  return rows[0]?.output_name || null;
}

export async function superItemsForJobs(ids) {
  if (!ids.length) return new Set();
  const {rows} = await pool.query('SELECT job_id FROM super_items WHERE job_id = ANY($1::text[])', [ids]);
  return new Set(rows.map(row => row.job_id));
}

export async function savePost(post) {
  await pool.query(`INSERT INTO posts (id, output_name, source, results, created_at)
    VALUES ($1,$2,$3,$4::jsonb,$5)
    ON CONFLICT (id) DO UPDATE SET results = EXCLUDED.results, updated_at = now()`,
  [post.id, post.outputName, post.source || 'manual', JSON.stringify(post.results), post.createdAt]);
}

export async function loadPost(id) {
  const {rows} = await pool.query('SELECT * FROM posts WHERE id = $1', [id]);
  const row = rows[0];
  return row ? {id: row.id, outputName: row.output_name, source: row.source,
    createdAt: row.created_at.toISOString(), results: row.results} : null;
}

export async function activePostForOutput(outputName, platforms) {
  const {rows} = await pool.query(`SELECT id, results FROM posts
    WHERE output_name = $1 ORDER BY created_at DESC`, [outputName]);
  return rows.find(row => platforms.some(platform =>
    ['queued', 'uploading', 'processing', 'verifying', 'published'].includes(row.results?.[platform]?.state))) || null;
}

export async function listVideos(limit = null) {
  const {rows} = await pool.query(`SELECT output_name, run_id, title, caption, template,
    manual_publication, rendered_at, storage_provider, storage_key, media_url
    FROM videos ORDER BY rendered_at DESC${limit ? ' LIMIT $1' : ''}`,
  limit ? [limit] : []);
  if (!rows.length) return [];
  const {rows: postRows} = await pool.query(`SELECT id, output_name, source, results, created_at
    FROM posts WHERE output_name = ANY($1::text[]) ORDER BY created_at DESC`, [rows.map(row => row.output_name)]);
  const postsByOutput = new Map();
  for (const row of postRows) {
    if (!postsByOutput.has(row.output_name)) postsByOutput.set(row.output_name, []);
    postsByOutput.get(row.output_name).push({id: row.id, source: row.source,
      createdAt: row.created_at.toISOString(), results: row.results});
  }
  return rows.map(row => {
    const posts = postsByOutput.get(row.output_name) || [];
    return {id: row.run_id || row.output_name, title: row.title, template: row.template,
      status: 'done', outputUrl: row.media_url || `/output/${encodeURIComponent(row.output_name)}`,
      caption: row.caption, modifiedAt: row.rendered_at.toISOString(),
      manualPublication: row.manual_publication,
      publicationStatus: publicationStatus({manualPublication: row.manual_publication}, posts),
      posts};
  });
}

export async function markPublication(outputName, value) {
  if (!['posted', 'not_posted'].includes(value)) throw new Error('Trạng thái đăng không hợp lệ.');
  if (value === 'not_posted') {
    const {rows} = await pool.query('SELECT results FROM posts WHERE output_name = $1', [outputName]);
    if (rows.some(row => Object.values(row.results).some(result => result.state === 'published'))) {
      throw new Error('Nền tảng đã xác nhận bài đăng; không thể đánh dấu video này là chưa đăng.');
    }
  }
  const {rowCount} = await pool.query(`UPDATE videos SET manual_publication = $2,
    updated_at = now() WHERE output_name = $1`, [outputName, value]);
  if (!rowCount) throw new Error('Không tìm thấy video trong PostgreSQL.');
}

export async function listJobs(limit = 50) {
  const {rows} = await pool.query(`SELECT run_id, parent_id, title, template, mode, status,
    step, progress, error, output_name, auto_mode, updated_at
    FROM jobs ORDER BY updated_at DESC LIMIT $1`, [limit]);
  return rows.map(row => ({id: row.run_id, parentId: row.parent_id, title: row.title,
    template: row.template, mode: row.mode, status: row.status, step: row.step,
    progress: row.progress, error: row.error, outputName: row.output_name,
    auto: row.auto_mode, updatedAt: row.updated_at.toISOString()}));
}

export async function listSessions(limit = 500) {
  const {rows: parents} = await pool.query(`SELECT run_id, parent_id, title, template, mode, status,
    step, progress, error, output_name, auto_mode, updated_at FROM jobs
    WHERE parent_id IS NULL ORDER BY updated_at DESC LIMIT $1`, [limit]);
  if (!parents.length) return [];
  const {rows: children} = await pool.query(`SELECT run_id, parent_id, title, template, mode, status,
    step, progress, error, output_name, auto_mode, updated_at FROM jobs
    WHERE parent_id = ANY($1::text[]) ORDER BY run_id`, [parents.map(row => row.run_id)]);
  const map = row => ({id: row.run_id, parentId: row.parent_id, title: row.title,
    template: row.template, mode: row.mode, status: row.status, step: row.step,
    progress: row.progress, error: row.error, outputName: row.output_name,
    auto: row.auto_mode, updatedAt: row.updated_at.toISOString()});
  const grouped = new Map();
  for (const child of children) {
    if (!grouped.has(child.parent_id)) grouped.set(child.parent_id, []);
    grouped.get(child.parent_id).push(map(child));
  }
  return parents.map(parent => summarizeSession(map(parent), grouped.get(parent.run_id) || []));
}

const busyJobStatuses = ['thinking', 'researching', 'preparing', 'downloading', 'rendering',
  'publishing', 'queued', 'render_queued', 'resume_prepared', 'processing'];
const busyPostStatuses = new Set(['queued', 'uploading', 'processing', 'verifying']);
const busySuperStatuses = ['planning', 'producing', 'manual_review', 'scheduled', 'publishing', 'needs_review'];

export async function deleteSessionRecord(id) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const {rows} = await client.query(`SELECT run_id, parent_id, status FROM jobs
      WHERE run_id = $1 OR parent_id = $1 FOR UPDATE`, [id]);
    if (!rows.some(row => row.run_id === id && !row.parent_id)) {
      throw new Error('Không tìm thấy phiên trong PostgreSQL.');
    }
    if (rows.some(row => busyJobStatuses.includes(row.status) &&
      !(row.run_id === id && row.status === 'processing' && rows.length > 1))) {
      throw new Error('Phiên đang xử lý. Hãy đợi hoàn tất trước khi xóa.');
    }
    const ids = rows.map(row => row.run_id);
    const {rows: linked} = await client.query(`SELECT id FROM super_items
      WHERE job_id = ANY($1::text[]) AND status = ANY($2::text[]) LIMIT 1`, [ids, busySuperStatuses]);
    if (linked.length) throw new Error('Phiên còn liên quan đến bài Super Auto đang xử lý hoặc chờ đăng.');
    const {rows: posting} = await client.query(`SELECT p.results FROM posts p
      JOIN videos v ON v.output_name = p.output_name WHERE v.run_id = ANY($1::text[])`, [ids]);
    if (posting.some(row => Object.values(row.results || {}).some(result => busyPostStatuses.has(result.state)))) {
      throw new Error('Phiên có video đang đăng hoặc xác minh. Hãy đợi hoàn tất trước khi xóa.');
    }
    await client.query('INSERT INTO deleted_sessions (id) VALUES ($1) ON CONFLICT DO NOTHING', [id]);
    await client.query('UPDATE videos SET run_id = NULL, updated_at = now() WHERE run_id = ANY($1::text[])', [ids]);
    await client.query('DELETE FROM jobs WHERE run_id = ANY($1::text[])', [ids]);
    await client.query('COMMIT');
    return {ids};
  } catch (error) { await client.query('ROLLBACK'); throw error; }
  finally { client.release(); }
}

export async function deleteVideoRecord(outputName) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const {rows: videos} = await client.query('SELECT output_name, run_id FROM videos WHERE output_name = $1 FOR UPDATE',
      [outputName]);
    if (!videos.length) throw new Error('Không tìm thấy video trong PostgreSQL.');
    const runId = videos[0].run_id;
    const {rows: shared} = runId ? await client.query(`SELECT 1 FROM videos
      WHERE run_id = $1 AND output_name <> $2 UNION ALL
      SELECT 1 FROM jobs WHERE parent_id = $1 LIMIT 1`, [runId, outputName]) : {rows: []};
    const {rows: jobs} = await client.query('SELECT status FROM jobs WHERE output_name = $1 FOR UPDATE', [outputName]);
    if (jobs.some(row => busyJobStatuses.includes(row.status))) {
      throw new Error('Video đang được xử lý. Hãy đợi hoàn tất trước khi xóa.');
    }
    const {rows: linked} = await client.query(`SELECT id FROM super_items
      WHERE output_name = $1 AND status = ANY($2::text[]) LIMIT 1`, [outputName, busySuperStatuses]);
    if (linked.length) throw new Error('Video còn trong lịch Super Auto hoặc cần kiểm tra trước khi đăng.');
    const {rows: posts} = await client.query('SELECT results FROM posts WHERE output_name = $1 FOR UPDATE', [outputName]);
    if (posts.some(row => Object.values(row.results || {}).some(result => busyPostStatuses.has(result.state)))) {
      throw new Error('Video đang được đăng hoặc xác minh. Hãy đợi hoàn tất trước khi xóa.');
    }
    await client.query('DELETE FROM posts WHERE output_name = $1', [outputName]);
    await client.query(`UPDATE super_items SET output_name = NULL, updated_at = now()
      WHERE output_name = $1`, [outputName]);
    await client.query(`UPDATE jobs SET output_name = NULL,
      step = 'Video đã xóa khỏi Thư viện', updated_at = now() WHERE output_name = $1`, [outputName]);
    await client.query('DELETE FROM videos WHERE output_name = $1', [outputName]);
    await client.query('COMMIT');
    return {runId, removeArtifacts: Boolean(runId && !shared.length)};
  } catch (error) { await client.query('ROLLBACK'); throw error; }
  finally { client.release(); }
}

async function readJson(file) {
  try { return JSON.parse(await readFile(file, 'utf8')); }
  catch { return null; }
}

export async function seedExistingOutputs() {
  const {rows: deletedRows} = await pool.query('SELECT id FROM deleted_sessions');
  const deletedSessions = new Set(deletedRows.map(row => row.id));
  const entries = await readdir(outputDir, {withFileTypes: true}).catch(() => []);
  let seededVideos = 0;
  for (const entry of entries) {
    if (!entry.isFile() || !/^[a-zA-Z0-9._-]+\.mp4$/.test(entry.name)) continue;
    const file = path.join(outputDir, entry.name);
    const info = await stat(file);
    if (!info.size) continue;
    const runId = /^(\d{4}-\d{2}-\d{2}T[\d-]+Z(?:-q\d+)?)-/.exec(entry.name)?.[1] || null;
    const folder = runId ? path.join(root, '.tmp', runId) : null;
    const quote = folder ? await readJson(path.join(folder, 'quote-spec.json')) : null;
    const story = folder ? await readJson(path.join(folder, 'story.json')) : null;
    const spec = folder ? await readJson(path.join(folder, 'video-spec.json')) : null;
    const caption = folder ? await readFile(path.join(folder, 'caption.txt'), 'utf8').catch(() => '') : '';
    const title = quote?.title || story?.title || spec?.title || entry.name.replace(/\.mp4$/, '').replace(/-/g, ' ');
    const {rowCount} = await pool.query(`INSERT INTO videos
      (output_name, run_id, title, caption, template, manual_publication, rendered_at)
      VALUES ($1,$2,$3,$4,$5,'unknown',$6) ON CONFLICT DO NOTHING`,
    [entry.name, runId, title, withoutSourceAppendix(caption), quote ? 'quote' : 'ranking', info.mtime.toISOString()]);
    seededVideos += rowCount;
    if (runId && !deletedSessions.has(runId.replace(/-q\d+$/, ''))) await pool.query(`INSERT INTO jobs
      (run_id, parent_id, title, template, status, step, progress, output_name)
      VALUES ($1,$2,$3,$4,'done','Video đã render trước khi có PostgreSQL',1,$5)
      ON CONFLICT DO NOTHING`,
    [runId, /-q\d+$/.test(runId) ? runId.replace(/-q\d+$/, '') : null,
      title, quote ? 'quote' : 'ranking', entry.name]);
  }
  let seededJobs = 0;
  const folders = await readdir(path.join(root, '.tmp'), {withFileTypes: true}).catch(() => []);
  for (const entry of folders) {
    if (!entry.isDirectory() || !/^\d{4}-\d{2}-\d{2}T[\d-]+Z(?:-q\d+)?$/.test(entry.name) ||
      deletedSessions.has(entry.name.replace(/-q\d+$/, ''))) continue;
    const folder = path.join(root, '.tmp', entry.name);
    const [quote, story, research, ideas, spec] = await Promise.all([
      'quote-spec.json', 'story.json', 'research.json', 'ideas.json', 'video-spec.json'
    ].map(name => readJson(path.join(folder, name))));
    if (!quote && !story && !research && !ideas && !spec) continue;
    const title = quote?.title || story?.title || spec?.title || ideas?.[0]?.title || `Phiên ${entry.name}`;
    const step = spec ? 'Render bị gián đoạn trước khi có MP4'
      : story || quote ? 'Đã chuẩn bị nội dung; cần kiểm tra footage'
        : research ? 'Đã nghiên cứu; cần kiểm tra dữ liệu' : 'Đã tạo ý tưởng';
    const progress = spec ? 0.72 : story || quote ? 0.6 : research ? 0.4 : 0.18;
    const {rowCount} = await pool.query(`INSERT INTO jobs
      (run_id, parent_id, title, template, status, step, progress)
      VALUES ($1,$2,$3,$4,'interrupted',$5,$6) ON CONFLICT DO NOTHING`,
    [entry.name, /-q\d+$/.test(entry.name) ? entry.name.replace(/-q\d+$/, '') : null,
      title, quote ? 'quote' : 'ranking', step, progress]);
    seededJobs += rowCount;
  }
  return {videos: seededVideos, jobs: seededJobs};
}

export async function closeDatabase() { await pool.end(); }
