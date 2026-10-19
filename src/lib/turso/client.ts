/**
 * Adaptador SQLite persistente para POSVEN Pro.
 * Usa sql.js (SQLite compilado a WebAssembly) para evitar dependencias nativas
 * y problemas de compilación en Windows/Electron. Cada escritura se vuelca a
 * un archivo temporal y se renombra atómicamente al archivo principal.
 */
import initSqlJs from 'sql.js';
import type { Database, SqlJsStatic, Statement } from 'sql.js';
import { AsyncLocalStorage } from 'node:async_hooks';
import fs from 'node:fs';
import path from 'node:path';

export type TursoStatement = { sql: string; args?: unknown[]; wantRows?: boolean };
export type TursoTransactionContext = { execute: (statement: TursoStatement) => Promise<any> };

const context = new AsyncLocalStorage<{ inTransaction: boolean }>();
let dbPromise: Promise<Database> | null = null;
let queue: Promise<unknown> = Promise.resolve();

function dbPath() {
  return process.env.POSVEN_SQLITE_PATH || path.join(process.cwd(), 'data', 'posven.sqlite');
}

async function getDatabase(): Promise<Database> {
  if (!dbPromise) {
    dbPromise = (async () => {
      const filename = dbPath();
      fs.mkdirSync(path.dirname(filename), { recursive: true });
      const SQL: SqlJsStatic = await initSqlJs({
        locateFile: (file: string) => path.join(path.dirname(require.resolve('sql.js')), file),
      });
      let db: Database;
      if (fs.existsSync(filename)) db = new SQL.Database(new Uint8Array(fs.readFileSync(filename)));
      else db = new SQL.Database();
      db.run('PRAGMA foreign_keys = ON');
      db.run('PRAGMA synchronous = FULL');
      return db;
    })();
  }
  return dbPromise;
}

function serialize<T>(work: () => T | Promise<T>): Promise<T> {
  const run = queue.then(work, work) as Promise<T>;
  queue = run.then(() => undefined, () => undefined);
  return run;
}

async function persist(db: Database) {
  const filename = dbPath();
  fs.mkdirSync(path.dirname(filename), { recursive: true });
  const temp = filename + '.tmp';
  const bytes = Buffer.from(db.export());
  const fd = fs.openSync(temp, 'w');
  try { fs.writeFileSync(fd, bytes); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
  fs.renameSync(temp, filename);
  try {
    const dirFd = fs.openSync(path.dirname(filename), 'r');
    try { fs.fsyncSync(dirFd); } finally { fs.closeSync(dirFd); }
  } catch {}
}

async function executeDirect(statement: TursoStatement) {
  const db = await getDatabase();
  const sql = String(statement.sql || '').trim();
  const prepared: Statement = db.prepare(sql);
  const args = (statement.args || []).map(value => value === undefined ? null : value) as any[];
  try {
    if (statement.wantRows !== false && prepared.getColumnNames().length > 0) {
      prepared.bind(args);
      const rows: Record<string, unknown>[] = [];
      while (prepared.step()) rows.push(prepared.getAsObject());
      return { rows, cols: prepared.getColumnNames().map(name => ({ name })), affected_row_count: 0 };
    }
  } finally { prepared.free(); }

  db.run(sql, args);
  const result = { rows: [], cols: [], affected_row_count: db.getRowsModified(), last_insert_rowid: String(db.exec('SELECT last_insert_rowid() AS id')[0]?.values?.[0]?.[0] ?? 0) };
  if (!context.getStore()?.inTransaction) await persist(db);
  return result;
}

export function isTursoConfigured(): boolean {
  return true;
}

export async function tursoExecute(statement: TursoStatement) {
  if (context.getStore()?.inTransaction) return executeDirect(statement);
  return serialize(() => executeDirect(statement));
}

export async function tursoBatch(statements: TursoStatement[]) {
  if (!statements.length) return [];
  return serialize(async () => {
    const db = await getDatabase();
    db.run('BEGIN IMMEDIATE');
    try {
      const result = await context.run({ inTransaction: true }, async () => {
        const rows = [];
        for (const statement of statements) rows.push(await executeDirect(statement));
        return rows;
      });
      db.run('COMMIT');
      await persist(db);
      return result;
    } catch (error) {
      try { db.run('ROLLBACK'); } catch {}
      throw error;
    }
  });
}

export async function tursoTransaction(statements: TursoStatement[]) {
  return tursoBatch(statements);
}

export async function tursoInteractiveTransaction<T>(callback: (tx: TursoTransactionContext) => Promise<T>): Promise<T> {
  return serialize(async () => {
    const db = await getDatabase();
    db.run('BEGIN IMMEDIATE');
    try {
      const value = await context.run({ inTransaction: true }, () => callback({ execute: async statement => executeDirect(statement) }));
      db.run('COMMIT');
      await persist(db);
      return value;
    } catch (error) {
      try { db.run('ROLLBACK'); } catch {}
      throw error;
    }
  });
}
