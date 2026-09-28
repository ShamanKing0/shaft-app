const express = require('express');
const { nanoid } = require('nanoid');
const db = require('../db');
const { createToken } = require('../auth');

const router = express.Router();

// خطوة 1: طلب رمز التحقق (OTP وهمي أثناء التطوير - الرمز الثابت 0000)
router.post('/request-otp', (req, res) => {
  const { phone } = req.body;
  if (!phone || phone.length < 8) {
    return res.status(400).json({ error: 'رقم الهاتف غير صحيح.' });
  }
  // في الإنتاج: أرسل رسالة SMS حقيقية عبر مزود مثل Twilio.
  // في MVP: الرمز ثابت 0000 لتسهيل الاختبار.
  return res.json({ ok: true, message: 'تم إرسال رمز التحقق (استخدم 0000 للتجربة).' });
});

// خطوة 2: التحقق من الرمز وإنشاء/تسجيل دخول المستخدم
router.post('/verify-otp', (req, res) => {
  const { phone, otp, name, role } = req.body;
  if (!phone || !otp) {
    return res.status(400).json({ error: 'الرجاء إدخال رقم الهاتف والرمز.' });
  }
  if (otp !== '0000') {
    return res.status(400).json({ error: 'رمز التحقق غير صحيح.' });
  }

  let user = db.prepare('SELECT * FROM users WHERE phone = ?').get(phone);
  if (!user) {
    if (!name) {
      return res.status(400).json({ error: 'الرجاء إدخال الاسم.' });
    }
    const id = nanoid();
    db.prepare(
      'INSERT INTO users (id, name, phone, role) VALUES (?, ?, ?, ?)'
    ).run(id, name, phone, role === 'driver' ? 'driver' : 'customer');
    user = db.prepare('SELECT * FROM users WHERE id = ?').get(id);

    if (user.role === 'driver') {
      const driverId = nanoid();
      db.prepare(
        'INSERT INTO drivers (id, user_id, status) VALUES (?, ?, ?)'
      ).run(driverId, user.id, 'pending');
    }
  }

  const token = createToken(user.id);
  res.json({ ok: true, token, user });
});

router.get('/me', (req, res) => {
  const { requireAuth } = require('../auth');
  requireAuth(req, res, () => res.json({ user: req.user }));
});

module.exports = router;
