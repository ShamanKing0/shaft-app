-- شفط: قاعدة البيانات

CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  phone TEXT UNIQUE NOT NULL,
  role TEXT NOT NULL CHECK(role IN ('customer','driver','admin')),
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS drivers (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL UNIQUE REFERENCES users(id),
  city TEXT,
  area TEXT,
  is_available INTEGER DEFAULT 0,
  is_verified INTEGER DEFAULT 0,
  status TEXT DEFAULT 'pending' CHECK(status IN ('pending','approved','rejected','suspended')),
  current_latitude REAL,
  current_longitude REAL,
  rating_avg REAL DEFAULT 0,
  rating_count INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS trucks (
  id TEXT PRIMARY KEY,
  driver_id TEXT NOT NULL REFERENCES drivers(id),
  plate_number TEXT NOT NULL,
  truck_type TEXT NOT NULL,
  capacity TEXT NOT NULL,
  photo_url TEXT,
  document_url TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS service_requests (
  id TEXT PRIMARY KEY,
  customer_id TEXT NOT NULL REFERENCES users(id),
  driver_id TEXT REFERENCES drivers(id),
  service_type TEXT NOT NULL,
  notes TEXT,
  customer_notes TEXT,
  latitude REAL NOT NULL,
  longitude REAL NOT NULL,
  address TEXT,
  contact_name TEXT,
  contact_phone TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'searching'
    CHECK(status IN ('pending','searching','accepted','on_the_way','arrived','in_service','completed','cancelled')),
  search_radius_km INTEGER DEFAULT 5,
  created_at TEXT DEFAULT (datetime('now')),
  accepted_at TEXT,
  completed_at TEXT
);

CREATE TABLE IF NOT EXISTS request_status_history (
  id TEXT PRIMARY KEY,
  request_id TEXT NOT NULL REFERENCES service_requests(id),
  status TEXT NOT NULL,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS ratings (
  id TEXT PRIMARY KEY,
  request_id TEXT NOT NULL REFERENCES service_requests(id),
  customer_id TEXT NOT NULL REFERENCES users(id),
  driver_id TEXT NOT NULL REFERENCES drivers(id),
  rating INTEGER NOT NULL CHECK(rating BETWEEN 1 AND 5),
  comment TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS notifications (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  title TEXT NOT NULL,
  body TEXT,
  read INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_requests_status ON service_requests(status);
CREATE INDEX IF NOT EXISTS idx_drivers_available ON drivers(is_available, is_verified, status);
