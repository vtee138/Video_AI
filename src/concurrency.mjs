function boundedInteger(value, fallback, maximum) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isInteger(parsed) || parsed < 1) return fallback;
  return Math.min(parsed, maximum);
}

export function concurrencyConfig(env = process.env) {
  return {
    jobs: boundedInteger(env.MAX_CONCURRENT_JOBS, 2, 8),
    renders: boundedInteger(env.MAX_CONCURRENT_RENDERS, 1, 4),
    downloads: boundedInteger(env.MAX_CONCURRENT_DOWNLOADS, 2, 8),
    publishes: boundedInteger(env.MAX_CONCURRENT_PUBLISHES, 2, 8),
  };
}

export class Semaphore {
  constructor(limit) {
    if (!Number.isInteger(limit) || limit < 1) throw new Error('Giới hạn đồng thời phải là số nguyên dương.');
    this.limit = limit;
    this.active = 0;
    this.waiters = [];
  }

  acquire() {
    return new Promise(resolve => {
      const enter = () => {
        this.active++;
        let released = false;
        resolve(() => {
          if (released) return;
          released = true;
          this.active--;
          this.waiters.shift()?.();
        });
      };
      if (this.active < this.limit) enter();
      else this.waiters.push(enter);
    });
  }

  async use(task) {
    const release = await this.acquire();
    try { return await task(); }
    finally { release(); }
  }

  snapshot() {
    return {limit: this.limit, active: this.active, waiting: this.waiters.length};
  }
}
