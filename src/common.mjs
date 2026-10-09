import {readFileSync} from 'node:fs';
import {mkdir, writeFile} from 'node:fs/promises';
import path from 'node:path';
import {createInterface} from 'node:readline/promises';
import {loadEnvFile} from 'node:process';

export const root = path.resolve(import.meta.dirname, '..');
const envFile = path.join(root, '.env');
try { loadEnvFile(envFile); } catch (error) { if (error.code !== 'ENOENT') throw error; }

// node:process.loadEnvFile keeps a UTF-8 BOM as part of the first variable name.
// Normalize it so a file saved by Windows editors cannot silently disable that setting.
export function normalizeBomEnvironment(environment = process.env) {
  for (const key of Object.keys(environment)) {
    if (!key.startsWith('\uFEFF')) continue;
    const cleanKey = key.slice(1);
    if (cleanKey && !environment[cleanKey]) environment[cleanKey] = environment[key];
    delete environment[key];
  }
  return environment;
}

normalizeBomEnvironment();

// Windows background tasks can inherit empty user-level variables. Node treats
// those as already defined and will not fill them from .env, so fill only blank
// values while preserving every non-empty environment override.
export function fillMissingEnvironment(contents, environment = process.env) {
  for (const rawLine of String(contents || '').replace(/^\uFEFF/, '').split(/\r?\n/)) {
    const match = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/.exec(rawLine);
    if (!match || environment[match[1]]) continue;
    let value = match[2];
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (value) environment[match[1]] = value;
  }
  return environment;
}

try { fillMissingEnvironment(readFileSync(envFile, 'utf8')); } catch (error) { if (error.code !== 'ENOENT') throw error; }
export const publicDir = path.join(root, 'public');
export const outputDir = path.join(root, 'output');

export async function saveJson(file, data) {
  await mkdir(path.dirname(file), {recursive: true});
  await writeFile(file, JSON.stringify(data, null, 2), 'utf8');
}

export async function ask(question) {
  const rl = createInterface({input: process.stdin, output: process.stdout});
  try { return (await rl.question(question)).trim(); }
  finally { rl.close(); }
}

export function requireEnv(name) {
  const value = process.env[name];
  if (!value) throw new Error(`Thiếu ${name}. Xem .env.example và README.md.`);
  return value;
}

export function slug(text) {
  return text.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
    .replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 55) || 'ranking';
}
