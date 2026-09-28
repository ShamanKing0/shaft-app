// بيانات تجريبية: 5 عملاء، 5 سائقين، 5 شاحنات، 10 طلبات، admin واحد
const { nanoid } = require('nanoid');
const db = require('./db');

// مركز الخرطوم تقريبًا
const CENTER = { lat: 15.5007, lng: 32.5599 };
function jitter(v, range = 0.05) {
  return v + (Math.random() - 0.5) * range;
}

function upsertUser(name, phone, role) {
  let u = db.prepare('SELECT * FROM users WHERE phone = ?').get(phone);
  if (!u) {
    const id = nanoid();
    db.prepare('INSERT INTO users (id, name, phone, role) VALUES (?, ?, ?, ?)').run(id, name, phone, role);
    u = db.prepare('SELECT * FROM users WHERE id = ?').get(id);
  }
  return u;
}

console.log('جاري إدخال البيانات التجريبية...');

// admin
upsertUser('مدير النظام', '0900000000', 'admin');

// عملاء
const customers = [
  ['أحمد الطيب', '0911111111'],
  ['فاطمة الحسن', '0911111112'],
  ['محمد عثمان', '0911111113'],
  ['مريم إبراهيم', '0911111114'],
  ['خالد النور', '0911111115'],
];
const customerUsers = customers.map(([n, p]) => upsertUser(n, p, 'customer'));

// سائقين + شاحنات
const driverDefs = [
  ['محمد الفاتح', '0922222221', 'أم درمان', 'الثورة', '10,000 لتر'],
  ['عثمان بشير', '0922222222', 'الخرطوم', 'الرياض', '5,000 لتر'],
  ['إبراهيم آدم', '0922222223', 'بحري', 'الكدرو', '15,000 لتر'],
  ['حسن الطاهر', '0922222224', 'الخرطوم', 'الأزهري', '20,000 لتر'],
  ['يوسف كمال', '0922222225', 'أم درمان', 'العمارات', '10,000 لتر'],
];

const drivers = driverDefs.map(([name, phone, city, area, capacity], i) => {
  const u = upsertUser(name, phone, 'driver');
  let d = db.prepare('SELECT * FROM drivers WHERE user_id = ?').get(u.id);
  const lat = jitter(CENTER.lat);
  const lng = jitter(CENTER.lng);
  if (!d) {
    const id = nanoid();
    db.prepare(
      `INSERT INTO drivers (id, user_id, city, area, is_available, is_verified, status, current_latitude, current_longitude)
       VALUES (?, ?, ?, ?, 1, 1, 'approved', ?, ?)`
    ).run(id, u.id, city, area, lat, lng);
    d = db.prepare('SELECT * FROM drivers WHERE id = ?').get(id);
  }
  const truck = db.prepare('SELECT * FROM trucks WHERE driver_id = ?').get(d.id);
  if (!truck) {
    db.prepare(
      'INSERT INTO trucks (id, driver_id, plate_number, truck_type, capacity) VALUES (?, ?, ?, ?, ?)'
    ).run(nanoid(), d.id, `SD-${1000 + i}`, 'شاحنة شفط', capacity);
  }
  return d;
});

// 10 طلبات بحالات مختلفة
const serviceTypes = ['شفط بيارة', 'شفط خزان صرف صحي', 'شفط مياه راكدة'];
const statuses = ['searching', 'accepted', 'on_the_way', 'arrived', 'in_service', 'completed', 'completed', 'cancelled', 'searching', 'completed'];

statuses.forEach((status, i) => {
  const customer = customerUsers[i % customerUsers.length];
  const existing = db
    .prepare('SELECT COUNT(*) c FROM service_requests WHERE customer_id = ?')
    .get(customer.id).c;
  if (existing > i) return; // تجنب التكرار عند إعادة التشغيل

  const id = nanoid();
  const lat = jitter(CENTER.lat);
  const lng = jitter(CENTER.lng);
  const hasDriver = status !== 'searching';
  const driver = hasDriver ? drivers[i % drivers.length] : null;

  db.prepare(
    `INSERT INTO service_requests
     (id, customer_id, driver_id, service_type, latitude, longitude, address, contact_name, contact_phone, status, accepted_at, completed_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    id,
    customer.id,
    driver ? driver.id : null,
    serviceTypes[i % serviceTypes.length],
    lat,
    lng,
    'حي تجريبي، الخرطوم',
    customer.name,
    customer.phone,
    status,
    hasDriver ? new Date().toISOString() : null,
    status === 'completed' ? new Date().toISOString() : null
  );
  db.prepare('INSERT INTO request_status_history (id, request_id, status) VALUES (?, ?, ?)').run(
    nanoid(),
    id,
    status
  );

  if (status === 'completed' && driver) {
    const already = db.prepare('SELECT * FROM ratings WHERE request_id = ?').get(id);
    if (!already) {
      db.prepare(
        'INSERT INTO ratings (id, request_id, customer_id, driver_id, rating, comment) VALUES (?, ?, ?, ?, ?, ?)'
      ).run(nanoid(), id, customer.id, driver.id, 4 + (i % 2), 'خدمة ممتازة وسريعة');
      const stats = db
        .prepare('SELECT AVG(rating) as avg, COUNT(*) as cnt FROM ratings WHERE driver_id = ?')
        .get(driver.id);
      db.prepare('UPDATE drivers SET rating_avg = ?, rating_count = ? WHERE id = ?').run(
        stats.avg,
        stats.cnt,
        driver.id
      );
    }
  }
});

console.log('تم إدخال البيانات التجريبية بنجاح ✅');
console.log('---');
console.log('حسابات للتجربة (رمز التحقق دائمًا: 0000):');
console.log('عميل:', customers[0][1]);
console.log('سائق:', driverDefs[0][1]);
console.log('أدمن:', '0900000000');
