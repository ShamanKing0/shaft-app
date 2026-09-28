require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');

const authRoutes = require('./routes/auth');
const customerRoutes = require('./routes/customer');
const driverRoutes = require('./routes/driver');
const adminRoutes = require('./routes/admin');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

app.use('/api/auth', authRoutes);
app.use('/api/customer', customerRoutes);
app.use('/api/driver', driverRoutes);
app.use('/api/admin', adminRoutes);

app.use(express.static(path.join(__dirname, '..', 'public')));

// معالج أخطاء عام - لا نعرض تفاصيل تقنية للمستخدم
app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: 'حدث خطأ. حاول مرة أخرى.' });
});

app.listen(PORT, () => {
  console.log(`شفط يعمل على المنفذ ${PORT}`);
});
