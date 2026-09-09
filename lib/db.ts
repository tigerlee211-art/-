import Database from "better-sqlite3";
import { DB_PATH } from "@/lib/paths";

// ⚠️ 7-17: Next.js dev의 HMR이 이 모듈을 여러 번 평가한다. globalThis에 캐싱하지 않으면
// SQLite 커넥션(파일 핸들)이 요청마다 계속 늘어난다.
declare global {
  // eslint-disable-next-line no-var
  var __blogDb: Database.Database | undefined;
}

function createDb(): Database.Database {
  const db = new Database(DB_PATH);
  db.pragma("journal_mode = WAL"); // SSE 폴링과 쓰기가 동시에 일어나므로 필수
  db.pragma("foreign_keys = ON");
  migrate(db);
  return db;
}

export function getDb(): Database.Database {
  if (!globalThis.__blogDb) {
    globalThis.__blogDb = createDb();
  }
  return globalThis.__blogDb;
}

// 컬럼 존재 여부를 PRAGMA table_info로 확인한 뒤 없으면만 ALTER TABLE 한다.
// 기존 DB를 날리지 않기 위해 CREATE TABLE IF NOT EXISTS 와 조합한다.
function ensureColumn(db: Database.Database, table: string, column: string, ddl: string) {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[];
  if (!cols.some((c) => c.name === column)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${ddl}`);
  }
}

function migrate(db: Database.Database) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS jobs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      keyword TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      stage TEXT,
      auto INTEGER NOT NULL DEFAULT 1,
      mode TEXT NOT NULL DEFAULT 'auto',
      inputs TEXT,
      error TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS sources (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      job_id INTEGER NOT NULL REFERENCES jobs(id),
      type TEXT NOT NULL,
      title TEXT NOT NULL,
      summary TEXT,
      url TEXT,
      content TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS ideas (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      job_id INTEGER NOT NULL REFERENCES jobs(id),
      title TEXT NOT NULL,
      angle TEXT,
      rationale TEXT,
      chosen INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS drafts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      job_id INTEGER NOT NULL REFERENCES jobs(id),
      idea_id INTEGER REFERENCES ideas(id),
      title TEXT NOT NULL,
      body_json TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS images (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      job_id INTEGER NOT NULL REFERENCES jobs(id),
      draft_id INTEGER REFERENCES drafts(id),
      query TEXT,
      src_url TEXT,
      local_path TEXT,
      source_site TEXT NOT NULL,
      verdict_ok INTEGER NOT NULL DEFAULT 0,
      verdict_reason TEXT,
      section_index INTEGER,
      gen_prompt TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS posts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      job_id INTEGER NOT NULL REFERENCES jobs(id),
      draft_id INTEGER REFERENCES drafts(id),
      status TEXT NOT NULL DEFAULT 'pending',
      blog_url TEXT,
      screenshot TEXT,
      note TEXT,
      published_at TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS job_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      job_id INTEGER NOT NULL REFERENCES jobs(id),
      level TEXT NOT NULL DEFAULT 'info',
      message TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_sources_job ON sources(job_id);
    CREATE INDEX IF NOT EXISTS idx_ideas_job ON ideas(job_id);
    CREATE INDEX IF NOT EXISTS idx_drafts_job ON drafts(job_id);
    CREATE INDEX IF NOT EXISTS idx_images_job ON images(job_id);
    CREATE INDEX IF NOT EXISTS idx_posts_job ON posts(job_id);
    CREATE INDEX IF NOT EXISTS idx_job_logs_job ON job_logs(job_id);
  `);

  // 스키마 변경은 여기에 ensureColumn으로 추가한다. 기존 DB를 날리지 않는다.
  ensureColumn(db, "jobs", "auto", "auto INTEGER NOT NULL DEFAULT 1");
}
