const express = require('express');
const { nanoid } = require('nanoid');
const db = require('../db');
const { requireAuth, requireRole } = require('../auth');
const { distanceKm } = require('../utils/geo');

const router = express.Router();
router.use(requireAuth, requireRole('driver'));

function getDriver(userId) {
  return db.prepare('SELECT * FROM drivers WHERE user_id = ?').get(userId);
}

function logStatus(requestId, status) {
  db.prepare(
    'INSERT INTO request_status_history (id, request_id, status) VALUES (?, ?, ?)'
  ).run(nanoid(), requestId, status);
}

// ملف السائق الحالي (بيانات + شاحنة)
router.get('/me', (req, res) => {
  const driver = getDriver(req.user.id);
  const truck = db.prepare('SELECT * FROM trucks WHERE driver_id = ?').get(driver.id);
  res.json({ driver, truck, user: req.user });
});

// إكمال بيانات التسجيل: المدينة/المنطقة + الشاحنة
router.post('/profile', (req, res) => {
  const { city, area, plate_number, truck_type, capacity } = req.body;
  const driver = getDriver(req.user.id);
  if (!driver) return res.status(404).json({ error: 'حساب السائق غير موجود.' });

  db.prepare('UPDATE drivers SET city = ?, area = ?, updated_at = datetime("now") WHERE id = ?').run(
    city || null,
    area || null,
    driver.id
  );

  const existingTruck = db.prepare('SELECT * FROM trucks WHERE driver_id = ?').get(driver.id);
  if (plate_number && truck_type && capacity) {
    if (existingTruck) {
      db.prepare(
        'UPDATE trucks SET plate_number = ?, truck_type = ?, capacity = ?, updated_at = datetime("now") WHERE id = ?'
      ).run(plate_number, truck_type, capacity, existingTruck.id);
    } else {
      db.prepare(
        'INSERT INTO trucks (id, driver_id, plate_number, truck_type, capacity) VALUES (?, ?, ?, ?, ?)'
      ).run(nanoid(), driver.id, plate_number, truck_type, capacity);
    }
  }
  res.json({ ok: true });
});

// تحديث الموقع الحالي للسائق
router.post('/location', (req, res) => {
  const { latitude, longitude } = req.body;
  const driver = getDriver(req.user.id);
  db.prepare(
    'UPDATE drivers SET current_latitude = ?, current_longitude = ?, updated_at = datetime("now") WHERE id = ?'
  ).run(latitude, longitude, driver.id);
  res.json({ ok: true });
});

// تشغيل / إيقاف استقبال الطلبات
router.post('/availability', (req, res) => {
  const { is_available } = req.body;
  const driver = getDriver(req.user.id);
  if (!driver.is_verified || driver.status !== 'approved') {
    return res.status(403).json({ error: 'حسابك بانتظار التحقق من الإدارة.' });
  }
  db.prepare('UPDATE drivers SET is_available = ? WHERE id = ?').run(is_available ? 1 : 0, driver.id);
  res.json({ ok: true });
});

// الطلبات القريبة المتاحة (نظام المطابقة: توسيع نطاق البحث 5 -> 10 -> 20 كم)
router.get('/nearby-requests', (req, res) => {
  const driver = getDriver(req.user.id);
  if (!driver.current_latitude || !driver.current_longitude) {
    return res.json({ requests: [], message: 'يرجى تفعيل الموقع لرؤية الطلبات القريبة.' });
  }
  const pending = db
    .prepare("SELECT * FROM service_requests WHERE status = 'searching'")
    .all();

  const radii = [5, 10, 20];
  let matched = [];
  for (const r of radii) {
    matched = pending
      .map((req_) => ({
        ...req_,
        distance_km: distanceKm(driver.current_latitude, driver.current_longitude, req_.latitude, req_.longitude),
      }))
      .filter((req_) => req_.distance_km <= r)
      .sort((a, b) => a.distance_km - b.distance_km);
    if (matched.length > 0) break;
  }
  res.json({ requests: matched });
});

// قبول طلب - عملية آمنة (atomic) لمنع أكثر من سائق من قبول نفس الطلب
router.post('/requests/:id/accept', (req, res) => {
  const driver = getDriver(req.user.id);
  if (!driver.is_verified || driver.status !== 'approved') {
    return res.status(403).json({ error: 'حسابك بانتظار التحقق من الإدارة.' });
  }

  const result = db
    .prepare(
      "UPDATE service_requests SET driver_id = ?, status = 'accepted', accepted_at = datetime('now') WHERE id = ? AND status = 'searching'"
    )
    .run(driver.id, req.params.id);

  if (result.changes === 0) {
    return res.status(409).json({ error: 'تم قبول هذا الطلب من سائق آخر بالفعل.' });
  }
  logStatus(req.params.id, 'accepted');
  res.json({ ok: true });
});

// تحديث حالة الطلب (الطريق -> وصل -> بدأ -> اكتمل)
const STATUS_FLOW = {
  accepted: 'on_the_way',
  on_the_way: 'arrived',
  arrived: 'in_service',
  in_service: 'completed',
};

router.post('/requests/:id/advance', (req, res) => {
  const driver = getDriver(req.user.id);
  const request = db
    .prepare('SELECT * FROM service_requests WHERE id = ? AND driver_id = ?')
    .get(req.params.id, driver.id);
  if (!request) return res.status(404).json({ error: 'الطلب غير موجود.' });

  const next = STATUS_FLOW[request.status];
  if (!next) return res.status(400).json({ error: 'لا يمكن تحديث حالة هذا الطلب.' });

  const completedAt = next === 'completed' ? ", completed_at = datetime('now')" : '';
  db.prepare(`UPDATE service_requests SET status = ?${completedAt} WHERE id = ?`).run(next, request.id);
  logStatus(request.id, next);
  res.json({ ok: true, status: next });
});

// رفض طلب (لا يغير حالته العامة، فقط يخفيه عن هذا السائق مؤقتًا - MVP: تجاهل من الواجهة)
router.post('/requests/:id/reject', (req, res) => {
  res.json({ ok: true });
});

// الطلب الحالي النشط للسائق
router.get('/current-request', (req, res) => {
  const driver = getDriver(req.user.id);
  const request = db
    .prepare(
      `SELECT * FROM service_requests WHERE driver_id = ? AND status IN ('accepted','on_the_way','arrived','in_service') ORDER BY created_at DESC LIMIT 1`
    )
    .get(driver.id);
  res.json({ request: request || null });
});

// سجل الطلبات السابقة للسائق
router.get('/requests', (req, res) => {
  const driver = getDriver(req.user.id);
  const requests = db
    .prepare('SELECT * FROM service_requests WHERE driver_id = ? ORDER BY created_at DESC')
    .all(driver.id);
  res.json({ requests });
});

module.exports = router;
