CREATE TABLE IF NOT EXISTS notifications (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  message TEXT NOT NULL,
  target TEXT NOT NULL DEFAULT 'all',
  link_url TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS user_notification_reads (
  user_id TEXT NOT NULL,
  notification_id TEXT NOT NULL,
  read_at TEXT NOT NULL,
  PRIMARY KEY (user_id, notification_id)
);

CREATE INDEX IF NOT EXISTS idx_notifications_created_at ON notifications (created_at DESC);
