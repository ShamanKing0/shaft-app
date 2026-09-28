const express = require('express');
const db = require('../db');
const { requireAuth, requireRole } = require('../auth');

const router = express.Router();
router.use(requireAuth, requireRole('admin'));

// إحصائيات سريعة للوحة الرئيسية
router.get('/stats', (req, res) => {
  const customers = db.prepare("SELECT COUNT(*) c FROM users WHERE role = 'customer'").get().c;
  const drivers = db.prepare("SELECT COUNT(*) c FROM drivers").get().c;
  const pendingDrivers = db.prepare("SELECT COUNT(*) c FROM drivers WHERE status = 'pending'").get().c;
  const requests = db.prepare("SELECT COUNT(*) c FROM service_requests").get().c;
  const activeRequests = db
    .prepare("SELECT COUNT(*) c FROM service_requests WHERE status NOT IN ('completed','cancelled')")
    .get().c;
  res.json({ customers, drivers, pendingDrivers, requests, activeRequests });
});

// قائمة العملاء
router.get('/customers', (req, res) => {
  const customers = db.prepare("SELECT * FROM users WHERE role = 'customer' ORDER BY created_at DESC").all();
  res.json({ customers });
});

// قائمة أصحاب الشاحنات مع بيانات الشاحنة
router.get('/drivers', (req, res) => {
  const drivers = db
    .prepare(
      `SELECT d.*, u.name, u.phone, t.plate_number, t.truck_type, t.capacity
       FROM drivers d
       JOIN users u ON u.id = d.user_id
       LEFT JOIN trucks t ON t.driver_id = d.id
       ORDER BY d.created_at DESC`
    )
    .all();
  res.json({ drivers });
});

// قبول / رفض / تعليق سائق
router.post('/drivers/:id/status', (req, res) => {
  const { status } = req.body; // approved | rejected | suspended | pending
  if (!['approved', 'rejected', 'suspended', 'pending'].includes(status)) {
    return res.status(400).json({ error: 'حالة غير صحيحة.' });
  }
  const is_verified = status === 'approved' ? 1 : 0;
  db.prepare('UPDATE drivers SET status = ?, is_verified = ?, updated_at = datetime("now") WHERE id = ?').run(
    status,
    is_verified,
    req.params.id
  );
  if (status !== 'approved') {
    db.prepare('UPDATE drivers SET is_available = 0 WHERE id = ?').run(req.params.id);
  }
  res.json({ ok: true });
});

// كل الطلبات مع فلاتر
router.get('/requests', (req, res) => {
  const { status } = req.query;
  let requests;
  if (status) {
    requests = db
      .prepare(
        `SELECT sr.*, cu.name as customer_name, du.name as driver_name
         FROM service_requests sr
         JOIN users cu ON cu.id = sr.customer_id
         LEFT JOIN drivers d ON d.id = sr.driver_id
         LEFT JOIN users du ON du.id = d.user_id
         WHERE sr.status = ? ORDER BY sr.created_at DESC`
      )
      .all(status);
  } else {
    requests = db
      .prepare(
        `SELECT sr.*, cu.name as customer_name, du.name as driver_name
         FROM service_requests sr
         JOIN users cu ON cu.id = sr.customer_id
         LEFT JOIN drivers d ON d.id = sr.driver_id
         LEFT JOIN users du ON du.id = d.user_id
         ORDER BY sr.created_at DESC`
      )
      .all();
  }
  res.json({ requests });
});

module.exports = router;
