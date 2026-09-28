// ============ شفط - تطبيق طلب شاحنات الصرف الصحي ============

const API = '/api';
const state = {
  token: localStorage.getItem('shaft_token') || null,
  user: JSON.parse(localStorage.getItem('shaft_user') || 'null'),
  screen: 'home',
  params: {},
  pollTimer: null,
};

const SERVICES = [
  { id: 'شفط بيارة', icon: '🟢', label: 'شفط بيارة' },
  { id: 'شفط خزان صرف صحي', icon: '🔵', label: 'شفط خزان صرف صحي' },
  { id: 'شفط مياه راكدة', icon: '🟠', label: 'شفط مياه راكدة' },
  { id: 'أخرى', icon: '⚪', label: 'شيء آخر' },
];

const STATUS_LABELS = {
  pending: 'قيد الانتظار',
  searching: 'جاري البحث عن شاحنة...',
  accepted: 'تم قبول الطلب',
  on_the_way: 'الشاحنة في الطريق إليك',
  arrived: 'وصلت الشاحنة',
  in_service: 'بدأت الخدمة',
  completed: 'تم الانتهاء',
  cancelled: 'تم إلغاء الطلب',
};

// ---------- API helper ----------
async function api(path, opts = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (state.token) headers['Authorization'] = 'Bearer ' + state.token;
  const res = await fetch(API + path, {
    method: opts.method || 'GET',
    headers,
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  let data;
  try { data = await res.json(); } catch { data = {}; }
  if (!res.ok) throw new Error(data.error || 'حدث خطأ. حاول مرة أخرى.');
  return data;
}

function saveSession(token, user) {
  state.token = token;
  state.user = user;
  localStorage.setItem('shaft_token', token);
  localStorage.setItem('shaft_user', JSON.stringify(user));
}
function clearSession() {
  state.token = null;
  state.user = null;
  localStorage.removeItem('shaft_token');
  localStorage.removeItem('shaft_user');
}

function go(screen, params = {}) {
  clearInterval(state.pollTimer);
  state.screen = screen;
  state.params = params;
  render();
  window.scrollTo(0, 0);
}

function el(html) {
  const d = document.createElement('div');
  d.innerHTML = html;
  return d.firstElementChild;
}

function getLocation() {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) return reject(new Error('المتصفح لا يدعم تحديد الموقع.'));
    navigator.geolocation.getCurrentPosition(
      (pos) => resolve({ latitude: pos.coords.latitude, longitude: pos.coords.longitude }),
      () => reject(new Error('يرجى السماح للتطبيق بالوصول إلى موقعك أو تحديد الموقع على الخريطة.')),
      { enableHighAccuracy: true, timeout: 10000 }
    );
  });
}

// ============ الشاشات ============

function topbar(title, backScreen) {
  return `
    <div class="topbar">
      ${backScreen ? `<button class="back" onclick="go('${backScreen}')">←</button>` : '<span class="spacer"></span>'}
      <div class="title">${title}</div>
      <span class="spacer"></span>
    </div>`;
}

// -- الرئيسية --
function screenHome() {
  return `
    <div class="brand">
      <div class="logo">🚛</div>
      <h1>شفط</h1>
      <div class="tagline">خدمة شاحنة الصرف عند بابك</div>
    </div>
    <div class="screen">
      <button class="btn btn-primary btn-lg" onclick="go('customerEntry')">🚛 أطلب شاحنة صرف</button>
      <button class="btn btn-secondary" onclick="go('myRequests')">📋 طلباتي</button>
      <div class="card" style="margin-top:24px;text-align:center">
        <h3>🚛 أنت صاحب شاحنة؟</h3>
        <p>استقبل طلبات من العملاء القريبين منك وزد فرص عملك.</p>
        <button class="btn btn-amber" onclick="go('driverEntry')">سجل شاحنتك معنا</button>
      </div>
      <button class="muted-link" onclick="go('adminLogin')">دخول الإدارة</button>
    </div>`;
}

// -- دخول العميل (سريع، بدون تسجيل مسبق إن لزم) --
function screenCustomerEntry() {
  if (state.user && state.user.role === 'customer') {
    go('locationStep');
    return '';
  }
  return `
    ${topbar('طلب شاحنة', 'home')}
    <div class="screen">
      <h2>سجّل دخولك للمتابعة</h2>
      <p>سنستخدم رقم هاتفك للتواصل معك بخصوص طلبك فقط.</p>
      ${loginForm('customer')}
    </div>`;
}

function loginForm(role) {
  return `
    <div id="login-error"></div>
    <label>رقم الهاتف</label>
    <input id="lf-phone" type="tel" placeholder="09xxxxxxxx" inputmode="numeric">
    <label>الاسم الكامل</label>
    <input id="lf-name" type="text" placeholder="اكتب اسمك">
    <button class="btn btn-primary" onclick="submitOtp('${role}')">إرسال رمز التحقق</button>
    <div id="otp-box" style="display:none">
      <label>رمز التحقق</label>
      <input id="lf-otp" type="tel" placeholder="0000" inputmode="numeric" maxlength="4">
      <div class="hint">للتجربة استخدم الرمز: 0000</div>
      <button class="btn btn-primary" onclick="verifyOtp('${role}')">دخول</button>
    </div>`;
}

let pendingPhone = null, pendingName = null;
async function submitOtp(role) {
  const phone = document.getElementById('lf-phone').value.trim();
  const name = document.getElementById('lf-name').value.trim();
  const errBox = document.getElementById('login-error');
  errBox.innerHTML = '';
  if (!phone || phone.length < 8) { errBox.innerHTML = errMsg('يرجى إدخال رقم هاتف صحيح.'); return; }
  if (!name) { errBox.innerHTML = errMsg('يرجى إدخال الاسم.'); return; }
  try {
    await api('/auth/request-otp', { method: 'POST', body: { phone } });
    pendingPhone = phone; pendingName = name;
    document.getElementById('otp-box').style.display = 'block';
  } catch (e) { errBox.innerHTML = errMsg(e.message); }
}
async function verifyOtp(role) {
  const otp = document.getElementById('lf-otp').value.trim();
  const errBox = document.getElementById('login-error');
  try {
    const data = await api('/auth/verify-otp', { method: 'POST', body: { phone: pendingPhone, otp, name: pendingName, role } });
    saveSession(data.token, data.user);
    if (role === 'driver') go('driverProfileSetup'); else go('locationStep');
  } catch (e) { errBox.innerHTML = errMsg(e.message); }
}
function errMsg(m) { return `<div class="error-msg">${m}</div>`; }
function successMsg(m) { return `<div class="success-msg">${m}</div>`; }

// -- خطوة 1: الموقع --
const requestDraft = {};
function screenLocationStep() {
  return `
    ${topbar('أين تريد الشاحنة؟', 'home')}
    <div class="screen">
      <div id="loc-error"></div>
      <div id="loc-status" class="card" style="text-align:center;display:none">
        <div class="spinner"></div><p>جاري تحديد موقعك...</p>
      </div>
      <button class="btn btn-primary btn-lg" onclick="useCurrentLocation()">📍 استخدام موقعي الحالي</button>
      <button class="btn btn-secondary" onclick="useManualLocation()">🗺️ تحديد الموقع يدويًا</button>
    </div>`;
}
async function useCurrentLocation() {
  document.getElementById('loc-status').style.display = 'block';
  document.getElementById('loc-error').innerHTML = '';
  try {
    const loc = await getLocation();
    requestDraft.latitude = loc.latitude;
    requestDraft.longitude = loc.longitude;
    requestDraft.address = 'الموقع الحالي (GPS)';
    go('serviceStep');
  } catch (e) {
    document.getElementById('loc-status').style.display = 'none';
    document.getElementById('loc-error').innerHTML = errMsg(e.message);
  }
}
function useManualLocation() {
  // تقريب: مركز الخرطوم كموقع افتراضي قابل للتعديل يدويًا (بديل بسيط عن خريطة تفاعلية كاملة)
  requestDraft.latitude = 15.5007 + (Math.random() - 0.5) * 0.02;
  requestDraft.longitude = 32.5599 + (Math.random() - 0.5) * 0.02;
  requestDraft.address = null;
  go('manualAddressStep');
}
function screenManualAddressStep() {
  return `
    ${topbar('حدد العنوان', 'locationStep')}
    <div class="screen">
      <label>اكتب وصف العنوان (الحي، الشارع، أقرب علامة)</label>
      <textarea id="manual-address" placeholder="مثال: حي العمارات، شارع 15، بجوار مسجد النور"></textarea>
      <button class="btn btn-primary" onclick="saveManualAddress()">التالي</button>
    </div>`;
}
function saveManualAddress() {
  requestDraft.address = document.getElementById('manual-address').value.trim() || 'عنوان محدد يدويًا';
  go('serviceStep');
}

// -- خطوة 2: نوع الخدمة --
function screenServiceStep() {
  return `
    ${topbar('ماذا تحتاج؟', 'locationStep')}
    <div class="screen">
      ${SERVICES.map(s => `
        <div class="service-card ${requestDraft.service_type === s.id ? 'selected' : ''}" onclick="selectService('${s.id}')">
          <div class="icon">${s.icon}</div>
          <div class="name">${s.label}</div>
        </div>`).join('')}
      <div id="notes-box" style="display:${requestDraft.service_type === 'أخرى' ? 'block' : 'none'}">
        <label>وصف الخدمة (اختياري)</label>
        <textarea id="service-notes"></textarea>
      </div>
      <button class="btn btn-primary" ${requestDraft.service_type ? '' : 'disabled'} onclick="confirmService()">التالي</button>
    </div>`;
}
function selectService(id) { requestDraft.service_type = id; go('serviceStep'); }
function confirmService() {
  const notesEl = document.getElementById('service-notes');
  requestDraft.notes = notesEl ? notesEl.value.trim() : null;
  go('customerDetailsStep');
}

// -- خطوة 3: بيانات العميل --
function screenCustomerDetailsStep() {
  const u = state.user || {};
  return `
    ${topbar('بياناتك', 'serviceStep')}
    <div class="screen">
      <div id="details-error"></div>
      <label>الاسم</label>
      <input id="cd-name" type="text" value="${u.name || ''}">
      <label>رقم الهاتف</label>
      <input id="cd-phone" type="tel" value="${u.phone || ''}">
      <label>ملاحظات للسائق (اختياري)</label>
      <textarea id="cd-notes" placeholder="مثال: المدخل من الشارع الخلفي"></textarea>
      <button class="btn btn-primary btn-lg" onclick="sendRequest()">إرسال الطلب</button>
    </div>`;
}
async function sendRequest() {
  const errBox = document.getElementById('details-error');
  const contact_name = document.getElementById('cd-name').value.trim();
  const contact_phone = document.getElementById('cd-phone').value.trim();
  const customer_notes = document.getElementById('cd-notes').value.trim();
  if (!contact_name || !contact_phone) { errBox.innerHTML = errMsg('يرجى إدخال الاسم ورقم الهاتف.'); return; }
  try {
    const data = await api('/customer/requests', { method: 'POST', body: {
      service_type: requestDraft.service_type,
      notes: requestDraft.notes,
      latitude: requestDraft.latitude,
      longitude: requestDraft.longitude,
      address: requestDraft.address,
      contact_name, contact_phone,
    }});
    go('trackRequest', { id: data.request.id });
  } catch (e) { errBox.innerHTML = errMsg(e.message); }
}

// -- تتبع الطلب --
function screenTrackRequest() {
  return `
    ${topbar('طلبك', 'home')}
    <div class="screen" id="track-body">
      <div class="center-block"><div class="spinner"></div><p>جاري التحميل...</p></div>
    </div>`;
}
async function loadTrackRequest() {
  const id = state.params.id;
  try {
    const data = await api(`/customer/requests/${id}`);
    renderTrackBody(data.request, data.driver);
  } catch (e) {
    document.getElementById('track-body').innerHTML = errMsg(e.message);
  }
}
function renderTrackBody(request, driver) {
  const box = document.getElementById('track-body');
  if (!box) return;
  let html = '';
  if (request.status === 'searching') {
    html = `
      <div class="center-block">
        <div class="spinner"></div>
        <h2>🔎 جاري البحث عن شاحنة...</h2>
        <p>نبحث الآن عن أقرب شاحنة متاحة.</p>
      </div>
      <div class="card">
        <div class="meta">📍 الموقع: ${request.address || 'الموقع الحالي'}</div>
        <div class="meta">🧹 الخدمة: ${request.service_type}</div>
        <div class="meta">📞 الهاتف: ${request.contact_phone}</div>
      </div>
      <button class="btn btn-danger" onclick="cancelRequest('${request.id}')">إلغاء الطلب</button>`;
  } else if (['accepted', 'on_the_way', 'arrived', 'in_service'].includes(request.status)) {
    html = `
      <div class="center-block">
        <div class="big-icon">🚛</div>
        <h2>${STATUS_LABELS[request.status]}</h2>
      </div>
      ${driver ? `
      <div class="card driver-info-card">
        <div class="avatar">🧑‍✈️</div>
        <h3>${driver.name}</h3>
        <p>${driver.truck_type || ''} ${driver.capacity ? '· ' + driver.capacity : ''}</p>
        ${driver.rating_count > 0 ? `<p>⭐ ${driver.rating_avg.toFixed(1)} (${driver.rating_count} تقييم)</p>` : ''}
      </div>
      <a class="btn btn-blue" href="tel:${driver.phone}" style="text-decoration:none">📞 اتصل بالسائق</a>
      ` : ''}
      <div class="card">
        <span class="status-badge status-${request.status}">${STATUS_LABELS[request.status]}</span>
      </div>`;
  } else if (request.status === 'completed') {
    html = `
      <div class="center-block">
        <div class="big-icon">✅</div>
        <h2>تم الانتهاء من الخدمة</h2>
      </div>
      <div id="rate-box"></div>`;
    box.innerHTML = html;
    loadRatingBox(request.id);
    return;
  } else if (request.status === 'cancelled') {
    html = `<div class="center-block"><div class="big-icon">❌</div><h2>تم إلغاء الطلب</h2></div>
      <button class="btn btn-primary" onclick="go('home')">العودة للرئيسية</button>`;
  }
  box.innerHTML = html;
}
async function cancelRequest(id) {
  if (!confirm('هل تريد إلغاء الطلب؟')) return;
  try { await api(`/customer/requests/${id}/cancel`, { method: 'POST' }); loadTrackRequest(); }
  catch (e) { alert(e.message); }
}
async function loadRatingBox(requestId) {
  const box = document.getElementById('rate-box');
  box.innerHTML = `
    <div class="card">
      <h3 style="text-align:center">كيف كانت الخدمة؟</h3>
      <div class="stars" id="stars">
        ${[1,2,3,4,5].map(n => `<span class="star" data-n="${n}" onclick="setStar(${n})">★</span>`).join('')}
      </div>
      <textarea id="rate-comment" placeholder="اكتب ملاحظتك (اختياري)"></textarea>
      <button class="btn btn-primary" onclick="submitRating('${requestId}')">إرسال التقييم</button>
      <button class="muted-link" onclick="go('home')">تخطي</button>
    </div>`;
}
let currentStar = 0;
function setStar(n) {
  currentStar = n;
  document.querySelectorAll('#stars .star').forEach(s => {
    s.classList.toggle('filled', Number(s.dataset.n) <= n);
  });
}
async function submitRating(requestId) {
  if (!currentStar) { alert('يرجى اختيار عدد النجوم.'); return; }
  try {
    await api(`/customer/requests/${requestId}/rate`, { method: 'POST', body: {
      rating: currentStar, comment: document.getElementById('rate-comment').value.trim(),
    }});
    alert('شكرًا لتقييمك!');
    go('home');
  } catch (e) { alert(e.message); }
}

// -- طلباتي --
function screenMyRequests() {
  if (!state.user || state.user.role !== 'customer') {
    go('customerEntry');
    return '';
  }
  return `
    ${topbar('طلباتي', 'home')}
    <div class="screen" id="myreq-body">
      <div class="center-block"><div class="spinner"></div></div>
    </div>`;
}
async function loadMyRequests() {
  try {
    const data = await api('/customer/requests');
    const box = document.getElementById('myreq-body');
    if (!data.requests.length) {
      box.innerHTML = `<div class="center-block"><div class="big-icon">📋</div><p>لا توجد طلبات بعد.</p>
        <button class="btn btn-primary" onclick="go('customerEntry')">أطلب شاحنة الآن</button></div>`;
      return;
    }
    box.innerHTML = data.requests.map(r => `
      <div class="request-row" onclick="go('trackRequest', {id:'${r.id}'})">
        <div class="row-top">
          <strong>${r.service_type}</strong>
          <span class="status-badge status-${r.status}">${STATUS_LABELS[r.status]}</span>
        </div>
        <div class="meta">📅 ${new Date(r.created_at).toLocaleString('ar-SD')}</div>
      </div>`).join('');
  } catch (e) { document.getElementById('myreq-body').innerHTML = errMsg(e.message); }
}

// ============ صاحب الشاحنة ============
function screenDriverEntry() {
  if (state.user && state.user.role === 'driver') { go('driverDashboard'); return ''; }
  return `
    ${topbar('سجّل شاحنتك معنا', 'home')}
    <div class="screen">
      <div class="card" style="text-align:center">
        <div style="font-size:40px">🚛</div>
        <p><strong>استقبل طلبات من العملاء القريبين منك وزد فرص عملك.</strong></p>
      </div>
      ${loginForm('driver')}
    </div>`;
}

function screenDriverProfileSetup() {
  return `
    ${topbar('بيانات الشاحنة', null)}
    <div class="screen">
      <div id="dp-error"></div>
      <h3>البيانات الشخصية</h3>
      <label>المدينة</label>
      <input id="dp-city" placeholder="مثال: أم درمان">
      <label>المنطقة</label>
      <input id="dp-area" placeholder="مثال: الثورة">
      <h3 style="margin-top:20px">بيانات الشاحنة</h3>
      <label>رقم اللوحة</label>
      <input id="dp-plate" placeholder="SD-1234">
      <label>نوع الشاحنة</label>
      <input id="dp-type" placeholder="شاحنة شفط">
      <label>حجم الشاحنة</label>
      <select id="dp-capacity">
        <option>5,000 لتر</option>
        <option>10,000 لتر</option>
        <option>15,000 لتر</option>
        <option>20,000 لتر</option>
        <option value="custom">حجم آخر...</option>
      </select>
      <input id="dp-capacity-custom" style="display:none;margin-top:8px" placeholder="اكتب الحجم">
      <div class="hint">رفع صور الشاحنة والمستندات غير إلزامي الآن، يمكن إضافته لاحقًا من حسابك.</div>
      <button class="btn btn-primary btn-lg" onclick="saveDriverProfile()">إنهاء التسجيل</button>
    </div>
    <script>
      document.getElementById('dp-capacity').addEventListener('change', function(){
        document.getElementById('dp-capacity-custom').style.display = this.value === 'custom' ? 'block' : 'none';
      });
    </script>`;
}
async function saveDriverProfile() {
  const errBox = document.getElementById('dp-error');
  const capSel = document.getElementById('dp-capacity').value;
  const capacity = capSel === 'custom' ? document.getElementById('dp-capacity-custom').value.trim() : capSel;
  const body = {
    city: document.getElementById('dp-city').value.trim(),
    area: document.getElementById('dp-area').value.trim(),
    plate_number: document.getElementById('dp-plate').value.trim(),
    truck_type: document.getElementById('dp-type').value.trim() || 'شاحنة شفط',
    capacity,
  };
  if (!body.city || !body.plate_number || !capacity) { errBox.innerHTML = errMsg('يرجى تعبئة جميع الحقول.'); return; }
  try {
    await api('/driver/profile', { method: 'POST', body });
    go('driverPendingApproval');
  } catch (e) { errBox.innerHTML = errMsg(e.message); }
}
function screenDriverPendingApproval() {
  return `
    <div class="screen center-block" style="padding-top:60px">
      <div class="big-icon">⏳</div>
      <h2>تم استلام بياناتك</h2>
      <p>حسابك الآن بانتظار مراجعة الإدارة والتحقق منه. سنقوم بإشعارك عند التفعيل.</p>
      <button class="btn btn-secondary" onclick="go('driverDashboard')">الذهاب إلى حسابي</button>
    </div>`;
}

function driverBottomNav(active) {
  const items = [
    ['driverDashboard', '🏠', 'الرئيسية'],
    ['driverRequests', '📋', 'طلباتي'],
    ['driverProfileView', '👤', 'حسابي'],
  ];
  return `<div class="bottom-nav">
    ${items.map(([s, ic, lbl]) => `<button class="nav-item ${active===s?'active':''}" onclick="go('${s}')"><span class="ic">${ic}</span>${lbl}</button>`).join('')}
  </div>`;
}

function screenDriverDashboard() {
  if (!state.user || state.user.role !== 'driver') { go('driverEntry'); return ''; }
  return `
    <div class="screen" id="dd-body">
      <div class="center-block"><div class="spinner"></div></div>
    </div>
    ${driverBottomNav('driverDashboard')}`;
}
async function loadDriverDashboard() {
  const box = document.getElementById('dd-body');
  if (!box) return;
  try {
    const meData = await api('/driver/me');
    const driver = meData.driver;
    if (!driver.city) { go('driverProfileSetup'); return; }
    if (driver.status !== 'approved') {
      box.innerHTML = `
        <div class="brand" style="padding-top:6px"><h1 style="font-size:20px">مرحبًا، ${state.user.name} 👋</h1></div>
        <div class="card center-block">
          <div class="big-icon">⏳</div>
          <h3>حسابك بانتظار التحقق من الإدارة</h3>
          <p>سيتم إشعارك فور الموافقة على حسابك.</p>
        </div>`;
      return;
    }
    const current = await api('/driver/current-request');
    if (current.request) {
      renderDriverCurrentJob(box, current.request);
      return;
    }
    renderDriverAvailable(box, driver);
    await loadNearbyRequests();
    clearInterval(state.pollTimer);
    state.pollTimer = setInterval(async () => {
      const cur = await api('/driver/current-request');
      if (cur.request) { go('driverDashboard'); return; }
      loadNearbyRequests();
    }, 6000);
  } catch (e) { box.innerHTML = errMsg(e.message); }
}
function renderDriverAvailable(box, driver) {
  box.innerHTML = `
    <div class="brand" style="padding-top:6px"><h1 style="font-size:20px">مرحبًا، ${state.user.name} 👋</h1></div>
    <div class="toggle-row">
      <div>
        <strong>${driver.is_available ? '🟢 متاح' : '⚪ غير متاح'}</strong>
        <div class="hint" style="margin:2px 0 0">تشغيل / إيقاف استقبال الطلبات</div>
      </div>
      <label class="switch">
        <input type="checkbox" id="avail-toggle" ${driver.is_available ? 'checked' : ''} onchange="toggleAvailability()">
        <span class="slider-el"></span>
      </label>
    </div>
    <h3>الطلبات الجديدة</h3>
    <div id="nearby-list"><div class="hint">جاري تفعيل الموقع...</div></div>`;
  ensureDriverLocation();
}
async function ensureDriverLocation() {
  try {
    const loc = await getLocation();
    await api('/driver/location', { method: 'POST', body: loc });
    loadNearbyRequests();
  } catch (e) {
    const list = document.getElementById('nearby-list');
    if (list) list.innerHTML = errMsg(e.message);
  }
}
async function toggleAvailability() {
  const checked = document.getElementById('avail-toggle').checked;
  try {
    await api('/driver/availability', { method: 'POST', body: { is_available: checked } });
    loadNearbyRequests();
  } catch (e) {
    alert(e.message);
    document.getElementById('avail-toggle').checked = !checked;
  }
}
async function loadNearbyRequests() {
  const list = document.getElementById('nearby-list');
  if (!list) return;
  try {
    const data = await api('/driver/nearby-requests');
    if (!data.requests || !data.requests.length) {
      list.innerHTML = `<div class="hint">${data.message || 'لا توجد طلبات قريبة حاليًا.'}</div>`;
      return;
    }
    list.innerHTML = data.requests.map(r => `
      <div class="request-row">
        <div class="row-top"><strong>طلب جديد 🚛</strong><span>${r.distance_km.toFixed(1)} كم</span></div>
        <div class="meta">📍 ${r.address || 'موقع محدد'}</div>
        <div class="meta">🧹 ${r.service_type}</div>
        <button class="btn btn-primary" style="margin-top:8px" onclick="viewDriverRequest('${r.id}')">عرض الطلب</button>
      </div>`).join('');
  } catch (e) { list.innerHTML = errMsg(e.message); }
}
function viewDriverRequest(id) { go('driverRequestDetail', { id }); }

function screenDriverRequestDetail() {
  return `${topbar('تفاصيل الطلب', 'driverDashboard')}<div class="screen" id="drd-body"><div class="center-block"><div class="spinner"></div></div></div>`;
}
async function loadDriverRequestDetail() {
  const box = document.getElementById('drd-body');
  const id = state.params.id;
  try {
    const data = await api('/driver/nearby-requests');
    const r = (data.requests || []).find(x => x.id === id) || { id };
    box.innerHTML = `
      <div class="card">
        <div class="meta">📍 الموقع: ${r.address || 'موقع محدد على الخريطة'}</div>
        <div class="meta">🧹 الخدمة: ${r.service_type || ''}</div>
        <div class="meta">📝 ملاحظات: ${r.notes || r.customer_notes || 'لا توجد'}</div>
        <div class="meta">📏 المسافة: ${r.distance_km ? r.distance_km.toFixed(1) + ' كم' : '-'}</div>
        <div class="meta">📞 الهاتف: ${r.contact_phone || ''}</div>
      </div>
      <button class="btn btn-primary btn-lg" onclick="acceptRequest('${id}')">✅ قبول الطلب</button>
      <button class="btn btn-danger" onclick="go('driverDashboard')">❌ رفض</button>`;
  } catch (e) { box.innerHTML = errMsg(e.message); }
}
async function acceptRequest(id) {
  try {
    await api(`/driver/requests/${id}/accept`, { method: 'POST' });
    go('driverDashboard');
  } catch (e) { alert(e.message); go('driverDashboard'); }
}

function renderDriverCurrentJob(box, request) {
  const nextLabel = {
    accepted: '🚗 بدأت التحرك',
    on_the_way: '📍 وصلت للموقع',
    arrived: '🧹 بدأت الخدمة',
    in_service: '✅ تم الانتهاء',
  }[request.status];
  box.innerHTML = `
    <div class="brand" style="padding-top:6px"><h1 style="font-size:20px">🚛 الطلب الحالي</h1></div>
    <div class="card">
      <div class="meta"><strong>العميل:</strong> ${request.contact_name}</div>
      <div class="meta"><strong>الخدمة:</strong> ${request.service_type}</div>
      <div class="meta"><strong>الموقع:</strong> ${request.address || 'موقع GPS'}</div>
      ${request.notes ? `<div class="meta"><strong>ملاحظات:</strong> ${request.notes}</div>` : ''}
      <span class="status-badge status-${request.status}">${STATUS_LABELS[request.status]}</span>
    </div>
    <a class="btn btn-blue" href="tel:${request.contact_phone}" style="text-decoration:none">📞 الاتصال بالعميل</a>
    <a class="btn btn-outline-blue" href="https://www.google.com/maps?q=${request.latitude},${request.longitude}" target="_blank" style="text-decoration:none">🗺️ فتح الموقع</a>
    ${nextLabel ? `<button class="btn btn-primary btn-lg" onclick="advanceRequest('${request.id}')">${nextLabel}</button>` : ''}`;
}
async function advanceRequest(id) {
  try { await api(`/driver/requests/${id}/advance`, { method: 'POST' }); go('driverDashboard'); }
  catch (e) { alert(e.message); }
}

function screenDriverRequests() {
  return `${topbar('طلباتي السابقة', null)}<div class="screen" id="dreqs-body"><div class="center-block"><div class="spinner"></div></div></div>${driverBottomNav('driverRequests')}`;
}
async function loadDriverRequests() {
  const box = document.getElementById('dreqs-body');
  try {
    const data = await api('/driver/requests');
    if (!data.requests.length) { box.innerHTML = `<div class="hint">لا توجد طلبات سابقة.</div>`; return; }
    box.innerHTML = data.requests.map(r => `
      <div class="request-row">
        <div class="row-top"><strong>${r.service_type}</strong><span class="status-badge status-${r.status}">${STATUS_LABELS[r.status]}</span></div>
        <div class="meta">📅 ${new Date(r.created_at).toLocaleString('ar-SD')}</div>
      </div>`).join('');
  } catch (e) { box.innerHTML = errMsg(e.message); }
}

function screenDriverProfileView() {
  return `${topbar('حسابي', null)}<div class="screen" id="dprof-body"><div class="center-block"><div class="spinner"></div></div></div>${driverBottomNav('driverProfileView')}`;
}
async function loadDriverProfileView() {
  const box = document.getElementById('dprof-body');
  try {
    const data = await api('/driver/me');
    box.innerHTML = `
      <div class="card driver-info-card">
        <div class="avatar">🧑‍✈️</div>
        <h3>${state.user.name}</h3>
        <p>${state.user.phone}</p>
        <div class="stat-row">
          <div class="stat"><div class="num">${data.driver.rating_avg ? data.driver.rating_avg.toFixed(1) : '-'}</div><div class="lbl">⭐ التقييم</div></div>
          <div class="stat"><div class="num">${data.driver.rating_count}</div><div class="lbl">عدد التقييمات</div></div>
        </div>
      </div>
      <div class="card">
        <div class="meta"><strong>المدينة:</strong> ${data.driver.city || '-'}</div>
        <div class="meta"><strong>المنطقة:</strong> ${data.driver.area || '-'}</div>
        <div class="meta"><strong>الشاحنة:</strong> ${data.truck ? data.truck.truck_type + ' - ' + data.truck.capacity : '-'}</div>
        <div class="meta"><strong>رقم اللوحة:</strong> ${data.truck ? data.truck.plate_number : '-'}</div>
        <div class="meta"><strong>حالة الحساب:</strong> ${data.driver.status === 'approved' ? '✅ موثّق' : '⏳ قيد المراجعة'}</div>
      </div>
      <button class="btn btn-danger" onclick="logout()">تسجيل الخروج</button>`;
  } catch (e) { box.innerHTML = errMsg(e.message); }
}

function logout() { clearSession(); go('home'); }

// ============ لوحة الإدارة ============
function screenAdminLogin() {
  if (state.user && state.user.role === 'admin') { go('adminDashboard'); return ''; }
  return `
    ${topbar('دخول الإدارة', 'home')}
    <div class="screen">
      ${loginForm('admin')}
    </div>`;
}
function adminBottomNav(active) {
  const items = [['adminDashboard','📊','نظرة عامة'],['adminDrivers','🚛','السائقون'],['adminRequestsList','📋','الطلبات']];
  return `<div class="bottom-nav">${items.map(([s,ic,lbl])=>`<button class="nav-item ${active===s?'active':''}" onclick="go('${s}')"><span class="ic">${ic}</span>${lbl}</button>`).join('')}</div>`;
}
function screenAdminDashboard() {
  if (!state.user || state.user.role !== 'admin') { go('adminLogin'); return ''; }
  return `${topbar('لوحة الإدارة', null)}<div class="screen" id="adash-body"><div class="center-block"><div class="spinner"></div></div></div>${adminBottomNav('adminDashboard')}`;
}
async function loadAdminDashboard() {
  const box = document.getElementById('adash-body');
  try {
    const s = await api('/admin/stats');
    box.innerHTML = `
      <div class="stat-row" style="flex-wrap:wrap;gap:10px">
        ${statCard(s.customers, 'العملاء')}
        ${statCard(s.drivers, 'السائقون')}
        ${statCard(s.pendingDrivers, 'بانتظار التحقق')}
        ${statCard(s.activeRequests, 'طلبات نشطة')}
        ${statCard(s.requests, 'إجمالي الطلبات')}
      </div>
      <button class="btn btn-danger" onclick="logout()">تسجيل الخروج</button>`;
  } catch (e) { box.innerHTML = errMsg(e.message); }
}
function statCard(num, lbl) {
  return `<div class="card" style="flex:1;min-width:130px;text-align:center"><div class="num" style="font-size:26px;font-weight:800;color:var(--green-dark)">${num}</div><div class="lbl">${lbl}</div></div>`;
}
function screenAdminDrivers() {
  return `${topbar('أصحاب الشاحنات', null)}<div class="screen" id="adrv-body"><div class="center-block"><div class="spinner"></div></div></div>${adminBottomNav('adminDrivers')}`;
}
async function loadAdminDrivers() {
  const box = document.getElementById('adrv-body');
  try {
    const data = await api('/admin/drivers');
    box.innerHTML = data.drivers.map(d => `
      <div class="card">
        <div class="row-top" style="display:flex;justify-content:space-between">
          <strong>${d.name}</strong>
          <span class="status-badge status-${d.status === 'approved' ? 'completed' : d.status === 'rejected' || d.status === 'suspended' ? 'cancelled' : 'searching'}">${adminStatusLabel(d.status)}</span>
        </div>
        <div class="meta">📞 ${d.phone}</div>
        <div class="meta">📍 ${d.city || '-'} / ${d.area || '-'}</div>
        <div class="meta">🚛 ${d.truck_type || '-'} ${d.plate_number ? '(' + d.plate_number + ')' : ''} ${d.capacity ? '· ' + d.capacity : ''}</div>
        <div style="display:flex;gap:8px;margin-top:10px">
          <button class="btn btn-primary" style="margin:0" onclick="setDriverStatus('${d.id}','approved')">قبول</button>
          <button class="btn btn-danger" style="margin:0" onclick="setDriverStatus('${d.id}','rejected')">رفض</button>
          <button class="btn btn-secondary" style="margin:0" onclick="setDriverStatus('${d.id}','suspended')">تعليق</button>
        </div>
      </div>`).join('') || '<div class="hint">لا يوجد سائقون بعد.</div>';
  } catch (e) { box.innerHTML = errMsg(e.message); }
}
function adminStatusLabel(s) { return { approved: 'موثّق', pending: 'قيد المراجعة', rejected: 'مرفوض', suspended: 'معلّق' }[s] || s; }
async function setDriverStatus(id, status) {
  try { await api(`/admin/drivers/${id}/status`, { method: 'POST', body: { status } }); loadAdminDrivers(); }
  catch (e) { alert(e.message); }
}
function screenAdminRequestsList() {
  return `${topbar('كل الطلبات', null)}<div class="screen" id="areq-body">
    <div class="pill-row" id="areq-filters">
      ${['','searching','accepted','on_the_way','completed','cancelled'].map(s => `<div class="pill ${!s?'active':''}" data-s="${s}" onclick="filterAdminRequests('${s}')">${s ? STATUS_LABELS[s] : 'الكل'}</div>`).join('')}
    </div>
    <div id="areq-list"><div class="center-block"><div class="spinner"></div></div></div>
  </div>${adminBottomNav('adminRequestsList')}`;
}
async function filterAdminRequests(status) {
  document.querySelectorAll('#areq-filters .pill').forEach(p => p.classList.toggle('active', p.dataset.s === status));
  await loadAdminRequests(status);
}
async function loadAdminRequests(status = '') {
  const box = document.getElementById('areq-list');
  try {
    const data = await api('/admin/requests' + (status ? `?status=${status}` : ''));
    box.innerHTML = data.requests.map(r => `
      <div class="request-row">
        <div class="row-top"><strong>${r.service_type}</strong><span class="status-badge status-${r.status}">${STATUS_LABELS[r.status]}</span></div>
        <div class="meta">👤 ${r.customer_name} ${r.driver_name ? '· 🚛 ' + r.driver_name : ''}</div>
        <div class="meta">📅 ${new Date(r.created_at).toLocaleString('ar-SD')}</div>
      </div>`).join('') || '<div class="hint">لا توجد طلبات.</div>';
  } catch (e) { box.innerHTML = errMsg(e.message); }
}

// ============ الموجّه (Router) ============
const SCREENS = {
  home: screenHome,
  customerEntry: screenCustomerEntry,
  locationStep: screenLocationStep,
  manualAddressStep: screenManualAddressStep,
  serviceStep: screenServiceStep,
  customerDetailsStep: screenCustomerDetailsStep,
  trackRequest: screenTrackRequest,
  myRequests: screenMyRequests,
  driverEntry: screenDriverEntry,
  driverProfileSetup: screenDriverProfileSetup,
  driverPendingApproval: screenDriverPendingApproval,
  driverDashboard: screenDriverDashboard,
  driverRequestDetail: screenDriverRequestDetail,
  driverRequests: screenDriverRequests,
  driverProfileView: screenDriverProfileView,
  adminLogin: screenAdminLogin,
  adminDashboard: screenAdminDashboard,
  adminDrivers: screenAdminDrivers,
  adminRequestsList: screenAdminRequestsList,
};

const AFTER_RENDER = {
  trackRequest: () => { loadTrackRequest(); state.pollTimer = setInterval(loadTrackRequest, 5000); },
  myRequests: loadMyRequests,
  driverDashboard: loadDriverDashboard,
  driverRequestDetail: loadDriverRequestDetail,
  driverRequests: loadDriverRequests,
  driverProfileView: loadDriverProfileView,
  adminDashboard: loadAdminDashboard,
  adminDrivers: loadAdminDrivers,
  adminRequestsList: () => loadAdminRequests(''),
};

function render() {
  const fn = SCREENS[state.screen] || screenHome;
  const html = fn();
  document.getElementById('app').innerHTML = html;
  const after = AFTER_RENDER[state.screen];
  if (after) after();
}

document.addEventListener('DOMContentLoaded', () => {
  render();
});
