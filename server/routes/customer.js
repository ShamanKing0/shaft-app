const express = require('express');
const { nanoid } = require('nanoid');
const db = require('../db');
const { requireAuth, requireRole } = require('../auth');

const router = express.Router();
router.use(requireAuth, requireRole('customer'));

function logStatus(requestId, status) {
  db.prepare(
    'INSERT INTO request_status_history (id, request_id, status) VALUES (?, ?, ?)'
  ).run(nanoid(), requestId, status);
}

// إنشاء طلب شاحنة جديد
router.post('/requests', (req, res) => {
  const { service_type, notes, latitude, longitude, address, contact_name, contact_phone } = req.body;
  if (!latitude || !longitude) {
    return res.status(400).json({ error: 'يرجى تحديد الموقع أولاً.' });
  }
  if (!service_type) {
    return res.status(400).json({ error: 'يرجى اختيار نوع الخدمة.' });
  }
  if (!contact_phone) {
    return res.status(400).json({ error: 'يرجى إدخال رقم الهاتف.' });
  }

  const id = nanoid();
  db.prepare(
    `INSERT INTO service_requests
     (id, customer_id, service_type, notes, latitude, longitude, address, contact_name, contact_phone, status, search_radius_km)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'searching', 5)`
  ).run(id, req.user.id, service_type, notes || null, latitude, longitude, address || null, contact_name || req.user.name, contact_phone);
  logStatus(id, 'searching');

  const request = db.prepare('SELECT * FROM service_requests WHERE id = ?').get(id);
  res.json({ ok: true, request });
});

// عرض طلبات العميل (حالية وسابقة)
router.get('/requests', (req, res) => {
  const requests = db
    .prepare('SELECT * FROM service_requests WHERE customer_id = ? ORDER BY created_at DESC')
    .all(req.user.id);
  res.json({ requests });
});

// تفاصيل طلب واحد + بيانات السائق إن قبل الطلب (للـ polling)
router.get('/requests/:id', (req, res) => {
  const request = db
    .prepare('SELECT * FROM service_requests WHERE id = ? AND customer_id = ?')
    .get(req.params.id, req.user.id);
  if (!request) return res.status(404).json({ error: 'الطلب غير موجود.' });

  let driver = null;
  if (request.driver_id) {
    driver = db
      .prepare(
        `SELECT d.id, d.rating_avg, d.rating_count, d.current_latitude, d.current_longitude,
                u.name, u.phone, t.truck_type, t.capacity
         FROM drivers d
         JOIN users u ON u.id = d.user_id
         LEFT JOIN trucks t ON t.driver_id = d.id
         WHERE d.id = ?`
      )
      .get(request.driver_id);
  }
  res.json({ request, driver });
});

// إلغاء طلب
router.post('/requests/:id/cancel', (req, res) => {
  const request = db
    .prepare('SELECT * FROM service_requests WHERE id = ? AND customer_id = ?')
    .get(req.params.id, req.user.id);
  if (!request) return res.status(404).json({ error: 'الطلب غير موجود.' });
  if (['completed', 'cancelled'].includes(request.status)) {
    return res.status(400).json({ error: 'لا يمكن إلغاء هذا الطلب.' });
  }
  db.prepare("UPDATE service_requests SET status = 'cancelled' WHERE id = ?").run(request.id);
  logStatus(request.id, 'cancelled');
  res.json({ ok: true });
});

// تقييم الخدمة بعد الإكمال
router.post('/requests/:id/rate', (req, res) => {
  const { rating, comment } = req.body;
  const request = db
    .prepare('SELECT * FROM service_requests WHERE id = ? AND customer_id = ?')
    .get(req.params.id, req.user.id);
  if (!request) return res.status(404).json({ error: 'الطلب غير موجود.' });
  if (request.status !== 'completed') {
    return res.status(400).json({ error: 'يمكن التقييم بعد اكتمال الخدمة فقط.' });
  }
  if (!rating || rating < 1 || rating > 5) {
    return res.status(400).json({ error: 'التقييم يجب أن يكون بين 1 و5.' });
  }
  const existing = db.prepare('SELECT * FROM ratings WHERE request_id = ?').get(request.id);
  if (existing) return res.status(400).json({ error: 'تم تقييم هذا الطلب مسبقًا.' });

  db.prepare(
    'INSERT INTO ratings (id, request_id, customer_id, driver_id, rating, comment) VALUES (?, ?, ?, ?, ?, ?)'
  ).run(nanoid(), request.id, req.user.id, request.driver_id, rating, comment || null);

  const stats = db
    .prepare('SELECT AVG(rating) as avg, COUNT(*) as cnt FROM ratings WHERE driver_id = ?')
    .get(request.driver_id);
  db.prepare('UPDATE drivers SET rating_avg = ?, rating_count = ? WHERE id = ?').run(
    stats.avg,
    stats.cnt,
    request.driver_id
  );

  res.json({ ok: true });
});

module.exports = router;
