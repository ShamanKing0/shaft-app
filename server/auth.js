const crypto = require('crypto');
const db = require('./db');

// جلسات بسيطة في الذاكرة (كافية لـ MVP، يمكن استبدالها بـ JWT لاحقًا)
const sessions = new Map(); // token -> userId

function createToken(userId) {
  const token = crypto.randomBytes(24).toString('hex');
  sessions.set(token, userId);
  return token;
}

function requireAuth(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token || !sessions.has(token)) {
    return res.status(401).json({ error: 'غير مصرح. سجل الدخول مرة أخرى.' });
  }
  const userId = sessions.get(token);
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(userId);
  if (!user) return res.status(401).json({ error: 'المستخدم غير موجود.' });
  req.user = user;
  next();
}

function requireRole(role) {
  return (req, res, next) => {
    if (req.user.role !== role) {
      return res.status(403).json({ error: 'ليس لديك صلاحية للوصول لهذا القسم.' });
    }
    next();
  };
}

module.exports = { createToken, requireAuth, requireRole, sessions };
