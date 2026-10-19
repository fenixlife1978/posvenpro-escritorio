/**
 * SQLite local para POSVEN Pro. El archivo reside en el equipo servidor.
 * Interfaz compatible temporalmente con los módulos POS existentes.
 */
import Database from 'better-sqlite3';
import { AsyncLocalStorage } from 'node:async_hooks';
import fs from 'node:fs';
import path from 'node:path';

export type TursoStatement = { sql: string; args?: unknown[]; wantRows?: boolean };
export type TursoTransactionContext = { execute: (statement: TursoStatement) => Promise<any> };

const context = new AsyncLocalStorage<{ inTransaction: boolean }>();
let database: Database.Database | null = null;
let queue: Promise<unknown> = Promise.resolve();

function getDatabase() {
  if (database) return database;
  const filename = process.env.POSVEN_SQLITE_PATH || path.join(process.cwd(), 'data', 'posven.sqlite');
  fs.mkdirSync(path.dirname(filename), { recursive: true });
  database = new Database(filename, { timeout: 10000 });
  database.pragma('journal_mode = WAL');
  database.pragma('synchronous = FULL');
  database.pragma('foreign_keys = ON');
  database.pragma('busy_timeout = 10000');
  return database;
}

function serialize<T>(work: () => T | Promise<T>): Promise<T> {
  const run = queue.then(work, work) as Promise<T>;
  queue = run.then(() => undefined, () => undefined);
  return run;
}

function executeDirect(statement: TursoStatement) {
  const db = getDatabase();
  const prepared = db.prepare(statement.sql);
  const args = (statement.args || []).map(value => value === undefined ? null : value) as any[];
  if (statement.wantRows !== false && prepared.reader) {
    const rows = prepared.all(...args) as Record<string, unknown>[];
    return { rows, cols: rows.length ? Object.keys(rows[0]).map(name => ({ name })) : [], affected_row_count: 0 };
  }
  const result = prepared.run(...args);
  return { rows: [], cols: [], affected_row_count: result.changes, last_insert_rowid: String(result.lastInsertRowid) };
}

export function isTursoConfigured(): boolean {
  try { getDatabase().prepare('SELECT 1').get(); return true; } catch { return false; }
}

export async function tursoExecute(statement: TursoStatement) {
  if (context.getStore()?.inTransaction) return executeDirect(statement);
  return serialize(() => executeDirect(statement));
}

export async function tursoBatch(statements: TursoStatement[]) {
  if (!statements.length) return [];
  return serialize(() => {
    const db = getDatabase();
    return db.transaction(() => statements.map(executeDirect))();
  });
}

export async function tursoTransaction(statements: TursoStatement[]) {
  return tursoBatch(statements);
}

export async function tursoInteractiveTransaction<T>(callback: (tx: TursoTransactionContext) => Promise<T>): Promise<T> {
  return serialize(async () => {
    const db = getDatabase();
    db.exec('BEGIN IMMEDIATE');
    try {
      const value = await context.run({ inTransaction: true }, () => callback({ execute: async statement => executeDirect(statement) }));
      db.exec('COMMIT');
      return value;
    } catch (error) {
      try { db.exec('ROLLBACK'); } catch {}
      throw error;
    }
  });
}
