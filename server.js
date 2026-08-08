require('dotenv').config();
const express = require('express');
const rateLimit = require('express-rate-limit');
const { Pool } = require('pg');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const multer = require('multer');
const cors = require('cors');
const crypto = require('crypto');
const nodemailer = require('nodemailer');
const { v2: cloudinary } = require('cloudinary');
const { CloudinaryStorage } = require('multer-storage-cloudinary');
const admin = require('firebase-admin');

// ===== FIREBASE PUSH NOTIFICATIONS =====
// Reads the service account from an env var (never a committed file) so the private key stays out of git.
let firebaseReady = false;
try {
  if (process.env.FIREBASE_SERVICE_ACCOUNT) {
    const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
    admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
    firebaseReady = true;
    console.log('Firebase Admin initialized — push notifications enabled');
  } else {
    console.log('FIREBASE_SERVICE_ACCOUNT not set — push notifications disabled');
  }
} catch (e) {
  console.error('Firebase Admin init failed:', e.message);
}

// One place all order/status code calls — silently does nothing if a token is missing or Firebase isn't set up,
// so a notification failure never breaks the actual order flow.
async function sendPushNotification(fcmToken, title, body, data = {}) {
  if (!firebaseReady || !fcmToken) return;
  try {
    await admin.messaging().send({
      token: fcmToken,
      notification: { title, body },
      data: Object.fromEntries(Object.entries(data).map(([k, v]) => [k, String(v)])),
      android: { priority: 'high' },
    });
  } catch (e) {
    console.log('Push notification failed:', e.message);
  }
}

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: { user: process.env.EMAIL_USER, pass: process.env.EMAIL_PASS },
});

const app = express();
const SECRET = 'zeppo_secret_2024';

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

const q = (text, params) => pool.query(text, params);

const generalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 300,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, message: 'Too many requests. Please slow down and try again shortly.' },
});
const strictLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, message: 'Too many attempts. Please wait a few minutes and try again.' },
});

app.use(cors());
app.use(express.json());
app.use(express.static('.'));
app.use('/uploads', express.static('uploads'));
app.use('/api/', generalLimiter);

const storage = new CloudinaryStorage({
  cloudinary: cloudinary,
  params: (req, file) => ({
    folder: req.path.includes('restaurant') ? 'zeppo/restaurants' : req.path.includes('banner') ? 'zeppo/banners' : req.path.includes('stay') ? 'zeppo/stays' : req.path.includes('tile') ? 'zeppo/tiles' : req.path.includes('document') ? 'zeppo/documents' : 'zeppo/food',
    resource_type: req.path.includes('banner') ? 'auto' : 'image',
    allowed_formats: req.path.includes('banner') ? ['jpg', 'jpeg', 'png', 'webp', 'mp4', 'mov'] : ['jpg', 'jpeg', 'png', 'webp'],
  }),
});
const upload = multer({ storage, limits: { fileSize: 20 * 1024 * 1024 } });

async function setupDatabase() {
  await q(`CREATE TABLE IF NOT EXISTS users (
    id SERIAL PRIMARY KEY, name TEXT, email TEXT UNIQUE, phone TEXT,
    password TEXT, role TEXT DEFAULT 'user', referral_code TEXT UNIQUE,
    referred_by TEXT, wallet_balance INTEGER DEFAULT 0, created_at TIMESTAMP DEFAULT NOW());`);
  await q(`ALTER TABLE users ADD COLUMN IF NOT EXISTS fcm_token TEXT;`);
  await q(`CREATE TABLE IF NOT EXISTS restaurants (
    id SERIAL PRIMARY KEY, name TEXT, category TEXT, emoji TEXT, address TEXT, description TEXT,
    image TEXT, rating TEXT DEFAULT '4.5', is_open INTEGER DEFAULT 1, active INTEGER DEFAULT 1,
    commission_percent INTEGER DEFAULT 15, discount_percent INTEGER DEFAULT 0, phone TEXT, min_order INTEGER DEFAULT 0,
    delivery_charge INTEGER DEFAULT 0, opening_time TEXT DEFAULT '09:00', closing_time TEXT DEFAULT '23:00',
    created_at TIMESTAMP DEFAULT NOW());`);
  await q(`ALTER TABLE restaurants ADD COLUMN IF NOT EXISTS discount_percent INTEGER DEFAULT 0;`);
  await q(`ALTER TABLE restaurants ADD COLUMN IF NOT EXISTS free_delivery INTEGER DEFAULT 1;`);
  await q(`ALTER TABLE restaurants ADD COLUMN IF NOT EXISTS user_id INTEGER;`);
  await q(`ALTER TABLE restaurants ADD COLUMN IF NOT EXISTS fssai_license TEXT;`);
  await q(`ALTER TABLE restaurants ADD COLUMN IF NOT EXISTS fssai_document TEXT;`);
  await q(`ALTER TABLE restaurants ADD COLUMN IF NOT EXISTS gst_number TEXT;`);
  await q(`ALTER TABLE restaurants ADD COLUMN IF NOT EXISTS owner_name TEXT;`);
  await q(`ALTER TABLE restaurants ADD COLUMN IF NOT EXISTS verification_status TEXT DEFAULT 'pending';`);
  await q(`ALTER TABLE restaurants ADD COLUMN IF NOT EXISTS lat DOUBLE PRECISION;`);
  await q(`ALTER TABLE restaurants ADD COLUMN IF NOT EXISTS lng DOUBLE PRECISION;`);
  await q(`ALTER TABLE restaurants ADD COLUMN IF NOT EXISTS dineout_image TEXT;`);
  await q(`ALTER TABLE restaurants ADD COLUMN IF NOT EXISTS bank_account_number TEXT;`);
  await q(`ALTER TABLE restaurants ADD COLUMN IF NOT EXISTS bank_ifsc TEXT;`);
  await q(`ALTER TABLE restaurants ADD COLUMN IF NOT EXISTS bank_account_holder TEXT;`);
  await q(`ALTER TABLE restaurants ADD COLUMN IF NOT EXISTS aadhaar_number TEXT;`);
  await q(`ALTER TABLE restaurants ADD COLUMN IF NOT EXISTS pan_number TEXT;`);
  await q(`ALTER TABLE restaurants ADD COLUMN IF NOT EXISTS address_proof_document TEXT;`);
  await q(`ALTER TABLE restaurants ADD COLUMN IF NOT EXISTS id_proof_document TEXT;`);
  await q(`ALTER TABLE delivery_boys ADD COLUMN IF NOT EXISTS lat DOUBLE PRECISION;`);
  await q(`ALTER TABLE delivery_boys ADD COLUMN IF NOT EXISTS lng DOUBLE PRECISION;`);
  await q(`ALTER TABLE delivery_boys ADD COLUMN IF NOT EXISTS location_updated_at TIMESTAMP;`);
  await q(`ALTER TABLE orders ADD COLUMN IF NOT EXISTS customer_lat DOUBLE PRECISION;`);
  await q(`ALTER TABLE orders ADD COLUMN IF NOT EXISTS customer_lng DOUBLE PRECISION;`);
  await q(`ALTER TABLE orders ADD COLUMN IF NOT EXISTS delivery_distance_km DOUBLE PRECISION;`);
  await q(`ALTER TABLE orders ADD COLUMN IF NOT EXISTS delivery_fee INTEGER DEFAULT 0;`);
  await q(`ALTER TABLE orders ADD COLUMN IF NOT EXISTS delivery_accepted INTEGER DEFAULT NULL;`);
  await q(`CREATE TABLE IF NOT EXISTS dineout_tiles (
    id SERIAL PRIMARY KEY, label TEXT, icon TEXT DEFAULT 'star', image TEXT DEFAULT '', filter_type TEXT DEFAULT 'none',
    filter_value TEXT DEFAULT '', sort_order INTEGER DEFAULT 0, is_active INTEGER DEFAULT 1,
    created_at TIMESTAMP DEFAULT NOW());`);
  await q(`ALTER TABLE dineout_tiles ADD COLUMN IF NOT EXISTS image TEXT DEFAULT '';`);
  await q(`CREATE TABLE IF NOT EXISTS stays_tiles (
    id SERIAL PRIMARY KEY, label TEXT, icon TEXT DEFAULT 'star', image TEXT DEFAULT '', filter_type TEXT DEFAULT 'none',
    filter_value TEXT DEFAULT '', sort_order INTEGER DEFAULT 0, is_active INTEGER DEFAULT 1,
    created_at TIMESTAMP DEFAULT NOW());`);
  await q(`CREATE TABLE IF NOT EXISTS menu_items (
    id SERIAL PRIMARY KEY, restaurant_id INTEGER, category TEXT, name TEXT, price INTEGER,
    original_price INTEGER, portions TEXT, is_veg INTEGER DEFAULT 1, description TEXT,
    image TEXT, is_available INTEGER DEFAULT 1, is_featured INTEGER DEFAULT 0);`);
  await q(`ALTER TABLE menu_items ADD COLUMN IF NOT EXISTS is_featured INTEGER DEFAULT 0;`);
  await q(`CREATE TABLE IF NOT EXISTS orders (
    id SERIAL PRIMARY KEY, user_id INTEGER, customer_name TEXT, customer_phone TEXT, customer_address TEXT,
    restaurant_id INTEGER, restaurant_name TEXT, items TEXT, total INTEGER, status TEXT DEFAULT 'pending',
    payment_method TEXT DEFAULT 'cash', payment_status TEXT DEFAULT 'pending', refund_status TEXT DEFAULT 'none',
    delivery_boy_id INTEGER, created_at TIMESTAMP DEFAULT NOW());`);
  await q(`CREATE TABLE IF NOT EXISTS applications (
    id SERIAL PRIMARY KEY, full_name TEXT, father_name TEXT, phone TEXT, aadhar TEXT, dob TEXT,
    address TEXT, has_bike TEXT, bike_number TEXT, status TEXT DEFAULT 'pending', created_at TIMESTAMP DEFAULT NOW());`);
  await q(`ALTER TABLE applications ADD COLUMN IF NOT EXISTS id_proof_document TEXT;`);
  await q(`ALTER TABLE applications ADD COLUMN IF NOT EXISTS license_document TEXT;`);
  await q(`ALTER TABLE applications ADD COLUMN IF NOT EXISTS delivery_boy_id INTEGER;`);
  await q(`ALTER TABLE applications ADD COLUMN IF NOT EXISTS bank_account_number TEXT;`);
  await q(`ALTER TABLE applications ADD COLUMN IF NOT EXISTS bank_ifsc TEXT;`);
  await q(`ALTER TABLE applications ADD COLUMN IF NOT EXISTS bank_account_holder TEXT;`);

  await q(`CREATE TABLE IF NOT EXISTS restaurant_applications (
    id SERIAL PRIMARY KEY, restaurant_name TEXT, owner_name TEXT, category TEXT, address TEXT, phone TEXT,
    fssai_license TEXT, fssai_document TEXT, gst_number TEXT,
    bank_account_number TEXT, bank_ifsc TEXT, bank_account_holder TEXT,
    id_proof_document TEXT, address_proof_document TEXT,
    status TEXT DEFAULT 'pending', restaurant_id INTEGER, created_at TIMESTAMP DEFAULT NOW());`);
  await q(`CREATE TABLE IF NOT EXISTS delivery_boys (
    id SERIAL PRIMARY KEY, user_id INTEGER, name TEXT, phone TEXT, salary_per_delivery INTEGER DEFAULT 50,
    total_deliveries INTEGER DEFAULT 0, total_earned INTEGER DEFAULT 0, advance_taken INTEGER DEFAULT 0,
    paid_out INTEGER DEFAULT 0, is_online INTEGER DEFAULT 0, is_active INTEGER DEFAULT 1, created_at TIMESTAMP DEFAULT NOW());`);
  await q(`ALTER TABLE delivery_boys ADD COLUMN IF NOT EXISTS bank_account_number TEXT;`);
  await q(`ALTER TABLE delivery_boys ADD COLUMN IF NOT EXISTS bank_ifsc TEXT;`);
  await q(`ALTER TABLE delivery_boys ADD COLUMN IF NOT EXISTS bank_account_holder TEXT;`);
  await q(`CREATE TABLE IF NOT EXISTS delivery_advances (
    id SERIAL PRIMARY KEY, delivery_boy_id INTEGER, amount INTEGER, note TEXT, created_at TIMESTAMP DEFAULT NOW());`);
  await q(`CREATE TABLE IF NOT EXISTS delivery_shifts (
    id SERIAL PRIMARY KEY, delivery_boy_id INTEGER, check_in TIMESTAMP, check_out TIMESTAMP);`);
  await q(`CREATE TABLE IF NOT EXISTS settlements (
    id SERIAL PRIMARY KEY, type TEXT, party_id INTEGER, party_name TEXT, amount INTEGER, note TEXT, created_at TIMESTAMP DEFAULT NOW());`);
  await q(`CREATE TABLE IF NOT EXISTS support_tickets (
    id SERIAL PRIMARY KEY, user_id INTEGER, name TEXT, phone TEXT, email TEXT, subject TEXT, message TEXT,
    priority TEXT DEFAULT 'normal', status TEXT DEFAULT 'open', admin_reply TEXT,
    created_at TIMESTAMP DEFAULT NOW(), updated_at TIMESTAMP DEFAULT NOW());`);
  await q(`CREATE TABLE IF NOT EXISTS ratings (
    id SERIAL PRIMARY KEY, user_id INTEGER, restaurant_id INTEGER, order_id INTEGER, rating INTEGER,
    review TEXT, created_at TIMESTAMP DEFAULT NOW());`);
  await q(`CREATE TABLE IF NOT EXISTS notifications (
    id SERIAL PRIMARY KEY, title TEXT, message TEXT, type TEXT, is_read INTEGER DEFAULT 0, created_at TIMESTAMP DEFAULT NOW());`);
  await q(`CREATE TABLE IF NOT EXISTS banners (
    id SERIAL PRIMARY KEY, title TEXT, subtitle TEXT, image TEXT, button_text TEXT, is_active INTEGER DEFAULT 1,
    link TEXT, is_video INTEGER DEFAULT 0, category TEXT DEFAULT 'food', position TEXT DEFAULT 'top', created_at TIMESTAMP DEFAULT NOW());`);
  await q(`CREATE TABLE IF NOT EXISTS app_settings (id SERIAL PRIMARY KEY, key TEXT UNIQUE, value TEXT);`);
  await q(`CREATE TABLE IF NOT EXISTS stays (
    id SERIAL PRIMARY KEY, name TEXT, type TEXT DEFAULT 'Hotel', price_per_night INTEGER, address TEXT,
    phone TEXT, amenities TEXT, rating TEXT DEFAULT '4.5', images TEXT, description TEXT,
    is_active INTEGER DEFAULT 1, created_at TIMESTAMP DEFAULT NOW());`);
  await q(`ALTER TABLE stays ADD COLUMN IF NOT EXISTS video TEXT;`);
  await q(`CREATE TABLE IF NOT EXISTS stay_bookings (
    id SERIAL PRIMARY KEY, stay_id INTEGER, stay_name TEXT, customer_name TEXT, customer_phone TEXT,
    check_in TEXT, check_out TEXT, guests INTEGER DEFAULT 1, status TEXT DEFAULT 'pending', created_at TIMESTAMP DEFAULT NOW());`);
  await q(`CREATE TABLE IF NOT EXISTS table_bookings (
    id SERIAL PRIMARY KEY, restaurant_id INTEGER, restaurant_name TEXT, customer_name TEXT, customer_phone TEXT,
    booking_date TEXT, booking_time TEXT, guests INTEGER DEFAULT 2, status TEXT DEFAULT 'pending', created_at TIMESTAMP DEFAULT NOW());`);
  await q(`ALTER TABLE table_bookings ADD COLUMN IF NOT EXISTS offer_selected TEXT;`);
  await q(`CREATE TABLE IF NOT EXISTS referrals (
    id SERIAL PRIMARY KEY, referrer_user_id INTEGER, referred_user_id INTEGER, reward_amount INTEGER DEFAULT 50, created_at TIMESTAMP DEFAULT NOW());`);
  await q(`CREATE TABLE IF NOT EXISTS addresses (
    id SERIAL PRIMARY KEY, user_id INTEGER, type TEXT DEFAULT 'Other', address TEXT, is_default INTEGER DEFAULT 0, created_at TIMESTAMP DEFAULT NOW());`);
  await q(`CREATE TABLE IF NOT EXISTS coupons (
    id SERIAL PRIMARY KEY, code TEXT UNIQUE, discount INTEGER, type TEXT DEFAULT 'percent', min_order INTEGER DEFAULT 0,
    is_active INTEGER DEFAULT 1, created_at TIMESTAMP DEFAULT NOW());`);
  await q(`CREATE TABLE IF NOT EXISTS password_resets (
    id SERIAL PRIMARY KEY, user_id INTEGER, token TEXT UNIQUE, expires_at TIMESTAMP, used INTEGER DEFAULT 0, created_at TIMESTAMP DEFAULT NOW());`);

  const adminRes = await q("SELECT * FROM users WHERE role='admin'");
  if (adminRes.rows.length === 0) {
    const hashedPassword = bcrypt.hashSync('zeppo123', 10);
    await q("INSERT INTO users (name, email, phone, password, role, referral_code) VALUES ($1,$2,$3,$4,$5,$6)",
      ['Shafat', 'admin@zeppo.com', '9999999999', hashedPassword, 'admin', 'ZEPPOADMIN']);
  }
  const couponRes = await q("SELECT * FROM coupons WHERE code='ZEPPO50'");
  if (couponRes.rows.length === 0) {
    await q("INSERT INTO coupons (code, discount, type, min_order) VALUES ($1,$2,$3,$4)", ['ZEPPO50', 50, 'flat', 100]);
  }
  const tilesRes = await q('SELECT * FROM dineout_tiles');
  if (tilesRes.rows.length === 0) {
    await q(`INSERT INTO dineout_tiles (label, icon, filter_type, filter_value, sort_order) VALUES
      ('Up To\n20% OFF', 'percent', 'discount', '', 1),
      ('Fine\nDining', 'award', 'category', 'fine', 2),
      ('Top\nCafes', 'coffee', 'category', 'cafe', 3),
      ('City''s\nTop Spots', 'trending-up', 'rating', '4', 4);`);
  }
  const staysTilesRes = await q('SELECT * FROM stays_tiles');
  if (staysTilesRes.rows.length === 0) {
    await q(`INSERT INTO stays_tiles (label, icon, filter_type, filter_value, sort_order) VALUES
      ('Top\nRated', 'star', 'rating', '4', 1),
      ('Budget\nStays', 'tag', 'budget', '2000', 2),
      ('Luxury\nStays', 'award', 'luxury', '3000', 3),
      ('Near\nMe', 'map-pin', 'none', '', 4);`);
  }
  const feeSettingRes = await q("SELECT * FROM app_settings WHERE key='delivery_base_fee'");
  if (feeSettingRes.rows.length === 0) {
    await q("INSERT INTO app_settings (key, value) VALUES ($1,$2)", ['delivery_base_fee', '15']);
    await q("INSERT INTO app_settings (key, value) VALUES ($1,$2)", ['delivery_per_km_rate', '8']);
  }
  console.log('Database ready ✅');
}

function generateReferralCode(name) {
  const base = (name || 'ZEPPO').replace(/[^a-zA-Z]/g, '').toUpperCase().slice(0, 5) || 'ZEPPO';
  const rand = Math.floor(1000 + Math.random() * 9000);
  return base + rand;
}

// Straight-line distance in km between two lat/lng points — good enough for a small-town
// delivery radius like Kupwara, and needs no external maps API or extra cost.
function haversineKm(lat1, lng1, lat2, lng2) {
  if (lat1 == null || lng1 == null || lat2 == null || lng2 == null) return null;
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLng / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

// Offers an order to the closest online, unoccupied delivery boy — they still have to accept it.
// "Occupied" includes both a pending offer they haven't responded to yet, and any order they're
// already actively working, so nobody gets double-booked.
async function autoAssignDeliveryBoy(orderId, restaurantLat, restaurantLng, excludeIds = []) {
  if (restaurantLat == null || restaurantLng == null) return null;
  const dbRes = await q(`
    SELECT d.* FROM delivery_boys d
    WHERE d.is_active = 1 AND d.is_online = 1 AND d.lat IS NOT NULL AND d.lng IS NOT NULL
    AND d.id NOT IN (
      SELECT delivery_boy_id FROM orders
      WHERE delivery_boy_id IS NOT NULL
      AND (delivery_accepted IS NULL OR delivery_accepted = 1)
      AND status IN ('confirmed','preparing','on_the_way')
    )
  `);
  const candidates = dbRes.rows.filter((d) => !excludeIds.includes(d.id));
  if (candidates.length === 0) return null;
  let nearest = null;
  let nearestDist = Infinity;
  for (const d of candidates) {
    const dist = haversineKm(restaurantLat, restaurantLng, d.lat, d.lng);
    if (dist !== null && dist < nearestDist) { nearestDist = dist; nearest = d; }
  }
  if (!nearest) return null;
  // delivery_accepted stays NULL — this is an offer, not a done deal, until they respond
  await q('UPDATE orders SET delivery_boy_id = $1, delivery_accepted = NULL WHERE id = $2', [nearest.id, orderId]);
  return nearest;
}
function verifyToken(req) {
  const auth = req.headers.authorization;
  if (!auth) return null;
  try { return jwt.verify(auth.split(' ')[1], SECRET); } catch (e) { return null; }
}

app.post('/api/register', strictLimiter, async (req, res) => {
  try {
    const { name, email, phone, password, referral_code } = req.body;
    if (!name || !email || !phone || !password) return res.json({ success: false, message: 'All fields required!' });
    const exists = await q('SELECT * FROM users WHERE email = $1', [email]);
    if (exists.rows.length > 0) return res.json({ success: false, message: 'Email already registered!' });
    const hashedPassword = bcrypt.hashSync(password, 10);
    let myReferralCode = generateReferralCode(name);
    while ((await q('SELECT * FROM users WHERE referral_code = $1', [myReferralCode])).rows.length > 0) {
      myReferralCode = generateReferralCode(name);
    }
    let referrer = null;
    if (referral_code) {
      const r = await q('SELECT * FROM users WHERE referral_code = $1', [referral_code.toUpperCase().trim()]);
      referrer = r.rows[0] || null;
    }
    const result = await q('INSERT INTO users (name, email, phone, password, referral_code, referred_by) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id',
      [name, email, phone, hashedPassword, myReferralCode, referrer ? referrer.referral_code : null]);
    const newUserId = result.rows[0].id;
    if (referrer) {
      const REWARD = 50;
      await q('UPDATE users SET wallet_balance = wallet_balance + $1 WHERE id = $2', [REWARD, referrer.id]);
      await q('UPDATE users SET wallet_balance = wallet_balance + $1 WHERE id = $2', [REWARD, newUserId]);
      await q('INSERT INTO referrals (referrer_user_id, referred_user_id, reward_amount) VALUES ($1,$2,$3)', [referrer.id, newUserId, REWARD]);
      await q('INSERT INTO notifications (title, message, type) VALUES ($1,$2,$3)', ['Referral Reward! 🎉', referrer.name + ' referred ' + name + ' — both earned ₹' + REWARD, 'referral']);
    }
    res.json({ success: true, referral_code: myReferralCode });
  } catch (e) { console.error(e); res.status(500).json({ success: false, message: 'Server error' }); }
});

app.post('/api/login', strictLimiter, async (req, res) => {
  try {
    const { emailOrPhone, password } = req.body;
    const r = await q('SELECT * FROM users WHERE email = $1 OR phone = $1', [emailOrPhone]);
    const user = r.rows[0];
    if (!user) return res.json({ success: false, message: 'Account not found!' });
    const valid = bcrypt.compareSync(password, user.password);
    if (!valid) return res.json({ success: false, message: 'Wrong password!' });
    const token = jwt.sign({ id: user.id, name: user.name, role: user.role }, SECRET, { expiresIn: '90d' });
    res.json({ success: true, token, name: user.name, role: user.role });
  } catch (e) { console.error(e); res.status(500).json({ success: false, message: 'Server error' }); }
});

app.post('/api/forgot-password', strictLimiter, async (req, res) => {
  try {
    const { email } = req.body;
    const r = await q('SELECT * FROM users WHERE email = $1', [email]);
    const user = r.rows[0];
    if (!user) return res.json({ success: true });
    const token = crypto.randomBytes(32).toString('hex');
    const expiresAt = new Date(Date.now() + 30 * 60 * 1000).toISOString();
    await q('INSERT INTO password_resets (user_id, token, expires_at) VALUES ($1,$2,$3)', [user.id, token, expiresAt]);
    const resetLink = (process.env.FRONTEND_URL || 'http://localhost:3000') + '/reset-password/' + token;
    try {
      await transporter.sendMail({
        from: '"ZEPPO" <' + process.env.EMAIL_USER + '>', to: email, subject: 'Reset your ZEPPO password',
        html: '<div style="font-family: Arial; max-width:480px; margin:0 auto; padding:30px; background:#1a0a0f; color:white; border-radius:16px;"><h1 style="color:#ff6b00;">ZEPPO</h1><p>Hi ' + user.name + ',</p><a href="' + resetLink + '" style="display:inline-block; background:#ff6b00; color:white; padding:14px 28px; border-radius:12px; text-decoration:none; font-weight:bold;">Reset Password</a></div>',
      });
      res.json({ success: true });
    } catch (e) { console.error('EMAIL ERROR:', e.message); res.json({ success: false, message: 'Email bhejne mein error aaya!' }); }
  } catch (e) { console.error(e); res.status(500).json({ success: false }); }
});

app.post('/api/reset-password', strictLimiter, async (req, res) => {
  try {
    const { token, newPassword } = req.body;
    const r = await q('SELECT * FROM password_resets WHERE token = $1 AND used = 0', [token]);
    const reset = r.rows[0];
    if (!reset) return res.json({ success: false, message: 'Invalid or expired link!' });
    if (new Date(reset.expires_at) < new Date()) return res.json({ success: false, message: 'Link expired! Request a new one.' });
    const hashedPassword = bcrypt.hashSync(newPassword, 10);
    await q('UPDATE users SET password = $1 WHERE id = $2', [hashedPassword, reset.user_id]);
    await q('UPDATE password_resets SET used = 1 WHERE id = $1', [reset.id]);
    res.json({ success: true });
  } catch (e) { console.error(e); res.status(500).json({ success: false }); }
});

app.get('/api/wallet/me', async (req, res) => {
  const decoded = verifyToken(req);
  if (!decoded) return res.json({ balance: 0, referral_code: null });
  try {
    const r = await q('SELECT wallet_balance, referral_code FROM users WHERE id = $1', [decoded.id]);
    const user = r.rows[0];
    res.json({ balance: user ? user.wallet_balance : 0, referral_code: user ? user.referral_code : null });
  } catch (e) { res.json({ balance: 0, referral_code: null }); }
});
app.get('/api/referrals/me', async (req, res) => {
  const decoded = verifyToken(req);
  if (!decoded) return res.json([]);
  try { const r = await q('SELECT r.*, u.name as referred_name FROM referrals r LEFT JOIN users u ON r.referred_user_id = u.id WHERE r.referrer_user_id = $1 ORDER BY r.created_at DESC', [decoded.id]); res.json(r.rows); } catch (e) { res.json([]); }
});

app.get('/api/addresses/me', async (req, res) => {
  const decoded = verifyToken(req);
  if (!decoded) return res.json([]);
  try { const r = await q('SELECT * FROM addresses WHERE user_id = $1 ORDER BY is_default DESC, created_at DESC', [decoded.id]); res.json(r.rows); } catch (e) { res.json([]); }
});
app.post('/api/addresses/add', async (req, res) => {
  const decoded = verifyToken(req);
  if (!decoded) return res.json({ success: false });
  try {
    const { type, address } = req.body;
    if (!address || !address.trim()) return res.json({ success: false, message: 'Address required!' });
    const existing = await q('SELECT COUNT(*) FROM addresses WHERE user_id = $1', [decoded.id]);
    const isFirst = parseInt(existing.rows[0].count) === 0;
    await q('INSERT INTO addresses (user_id, type, address, is_default) VALUES ($1,$2,$3,$4)', [decoded.id, type || 'Other', address.trim(), isFirst ? 1 : 0]);
    res.json({ success: true });
  } catch (e) { res.json({ success: false }); }
});
app.post('/api/addresses/update', async (req, res) => {
  const decoded = verifyToken(req);
  if (!decoded) return res.json({ success: false });
  try { const { id, type, address } = req.body; await q('UPDATE addresses SET type = $1, address = $2 WHERE id = $3 AND user_id = $4', [type, address, id, decoded.id]); res.json({ success: true }); } catch (e) { res.json({ success: false }); }
});
app.post('/api/addresses/delete', async (req, res) => {
  const decoded = verifyToken(req);
  if (!decoded) return res.json({ success: false });
  try { await q('DELETE FROM addresses WHERE id = $1 AND user_id = $2', [req.body.id, decoded.id]); res.json({ success: true }); } catch (e) { res.json({ success: false }); }
});
app.post('/api/addresses/set-default', async (req, res) => {
  const decoded = verifyToken(req);
  if (!decoded) return res.json({ success: false });
  try {
    await q('UPDATE addresses SET is_default = 0 WHERE user_id = $1', [decoded.id]);
    await q('UPDATE addresses SET is_default = 1 WHERE id = $1 AND user_id = $2', [req.body.id, decoded.id]);
    res.json({ success: true });
  } catch (e) { res.json({ success: false }); }
});

app.get('/api/my-refunds', async (req, res) => {
  const decoded = verifyToken(req);
  if (!decoded) return res.json([]);
  try { const r = await q("SELECT * FROM orders WHERE user_id = $1 AND refund_status IN ('pending','refunded') ORDER BY created_at DESC", [decoded.id]); res.json(r.rows); } catch (e) { res.json([]); }
});

app.post('/api/upload/restaurant', upload.single('image'), (req, res) => { if (!req.file) return res.json({ success: false }); res.json({ success: true, url: req.file.path }); });
app.post('/api/upload/food', upload.single('image'), (req, res) => { if (!req.file) return res.json({ success: false }); res.json({ success: true, url: req.file.path }); });
app.post('/api/upload/banner', upload.single('image'), (req, res) => {
  if (!req.file) return res.json({ success: false });
  const isVideo = req.file.mimetype && req.file.mimetype.startsWith('video');
  res.json({ success: true, url: req.file.path, is_video: isVideo ? 1 : 0 });
});
app.post('/api/upload/stay', upload.single('image'), (req, res) => { if (!req.file) return res.json({ success: false }); res.json({ success: true, url: req.file.path }); });
app.post('/api/upload/tile', upload.single('image'), (req, res) => { if (!req.file) return res.json({ success: false }); res.json({ success: true, url: req.file.path }); });
app.post('/api/upload/document', upload.single('image'), (req, res) => { if (!req.file) return res.json({ success: false }); res.json({ success: true, url: req.file.path }); });

app.get('/api/restaurants', async (req, res) => { try { const r = await q('SELECT * FROM restaurants WHERE active = 1'); res.json(r.rows); } catch (e) { res.json([]); } });
app.get('/api/restaurants/:id', async (req, res) => {
  try {
    const r = await q('SELECT * FROM restaurants WHERE id = $1', [req.params.id]);
    if (r.rows.length === 0) return res.json({ error: 'not_found' });
    const ratingsRes = await q('SELECT COUNT(*) as count FROM ratings WHERE restaurant_id = $1', [req.params.id]);
    res.json({ ...r.rows[0], ratings_count: parseInt(ratingsRes.rows[0]?.count || 0) });
  } catch (e) { console.error(e); res.json({ error: 'server_error' }); }
});
app.post('/api/restaurants/add', async (req, res) => {
  try {
    const { name, category, emoji, address, description, image, commission_percent, discount_percent, free_delivery, phone, min_order, delivery_charge, opening_time, closing_time, login_email, login_password, lat, lng, dineout_image } = req.body;
    let user_id = null;
    if (login_email && login_password) {
      const exists = await q('SELECT * FROM users WHERE email = $1', [login_email]);
      if (exists.rows.length > 0) return res.json({ success: false, message: 'Email already used for another login!' });
      const hashedPassword = bcrypt.hashSync(login_password, 10);
      const result = await q("INSERT INTO users (name, email, phone, password, role, referral_code) VALUES ($1,$2,$3,$4,'restaurant',$5) RETURNING id", [name, login_email, phone || '', hashedPassword, generateReferralCode(name)]);
      user_id = result.rows[0].id;
    }
    await q('INSERT INTO restaurants (name, category, emoji, address, description, image, commission_percent, discount_percent, free_delivery, phone, min_order, delivery_charge, opening_time, closing_time, user_id, lat, lng, dineout_image) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)',
      [name, category, emoji || '🍽️', address, description || '', image || '', commission_percent || 15, discount_percent || 0, free_delivery !== undefined ? free_delivery : 1, phone || '', min_order || 0, delivery_charge || 0, opening_time || '09:00', closing_time || '23:00', user_id, lat || null, lng || null, dineout_image || '']);
    await q('INSERT INTO notifications (title, message, type) VALUES ($1,$2,$3)', ['New Restaurant!', name + ' added', 'restaurant']);
    res.json({ success: true });
  } catch (e) { console.error(e); res.json({ success: false }); }
});
app.post('/api/restaurants/update', async (req, res) => {
  try {
    const { id, name, category, emoji, address, description, image, is_open, commission_percent, discount_percent, free_delivery, phone, min_order, delivery_charge, opening_time, closing_time, lat, lng, dineout_image } = req.body;
    await q('UPDATE restaurants SET name=$1, category=$2, emoji=$3, address=$4, description=$5, image=$6, is_open=$7, commission_percent=$8, discount_percent=$9, free_delivery=$10, phone=$11, min_order=$12, delivery_charge=$13, opening_time=$14, closing_time=$15, lat=$16, lng=$17, dineout_image=$18 WHERE id=$19',
      [name, category, emoji, address, description, image, is_open, commission_percent || 15, discount_percent || 0, free_delivery !== undefined ? free_delivery : 1, phone || '', min_order || 0, delivery_charge || 0, opening_time || '09:00', closing_time || '23:00', lat || null, lng || null, dineout_image || '', id]);
    res.json({ success: true });
  } catch (e) { res.json({ success: false }); }
});
app.post('/api/restaurants/delete', async (req, res) => { await q('UPDATE restaurants SET active = 0 WHERE id = $1', [req.body.id]); res.json({ success: true }); });
app.post('/api/restaurants/toggle', async (req, res) => { const { id, is_open } = req.body; await q('UPDATE restaurants SET is_open = $1 WHERE id = $2', [is_open, id]); res.json({ success: true }); });
app.post('/api/restaurant/toggle-open', async (req, res) => {
  const decoded = verifyToken(req);
  if (!decoded || decoded.role !== 'restaurant') return res.json({ success: false });
  try {
    const { is_open } = req.body;
    await q('UPDATE restaurants SET is_open = $1 WHERE user_id = $2', [is_open, decoded.id]);
    res.json({ success: true });
  } catch (e) { res.json({ success: false }); }
});
app.post('/api/restaurants/verify', async (req, res) => {
  try {
    const { id, verification_status } = req.body;
    await q('UPDATE restaurants SET verification_status = $1 WHERE id = $2', [verification_status, id]);
    res.json({ success: true });
  } catch (e) { res.json({ success: false }); }
});

// ===== RESTAURANT SELF-SERVICE (their own login, their own orders only) =====
app.get('/api/restaurant/me', async (req, res) => {
  const decoded = verifyToken(req);
  if (!decoded || decoded.role !== 'restaurant') return res.json(null);
  try { const r = await q('SELECT * FROM restaurants WHERE user_id = $1', [decoded.id]); res.json(r.rows[0] || null); } catch (e) { res.json(null); }
});

app.get('/api/restaurant/earnings', async (req, res) => {
  const decoded = verifyToken(req);
  if (!decoded || decoded.role !== 'restaurant') return res.json(null);
  try {
    const rr = await q('SELECT * FROM restaurants WHERE user_id = $1', [decoded.id]);
    const rest = rr.rows[0];
    if (!rest) return res.json(null);

    const totalOrders = parseInt((await q('SELECT COUNT(*) FROM orders WHERE restaurant_id = $1', [rest.id])).rows[0].count);
    const todayOrders = parseInt((await q("SELECT COUNT(*) FROM orders WHERE restaurant_id = $1 AND created_at::date = CURRENT_DATE", [rest.id])).rows[0].count);
    const deliveredRes = await q("SELECT SUM(total) as sum, COUNT(*) as cnt FROM orders WHERE restaurant_id = $1 AND status = 'delivered'", [rest.id]);
    const totalRevenue = parseInt(deliveredRes.rows[0].sum) || 0;
    const deliveredCount = parseInt(deliveredRes.rows[0].cnt) || 0;
    const todayRevenueRes = await q("SELECT SUM(total) as sum FROM orders WHERE restaurant_id = $1 AND status = 'delivered' AND created_at::date = CURRENT_DATE", [rest.id]);
    const todayRevenue = parseInt(todayRevenueRes.rows[0].sum) || 0;
    const weekRevenueRes = await q("SELECT SUM(total) as sum FROM orders WHERE restaurant_id = $1 AND status = 'delivered' AND created_at >= NOW() - INTERVAL '7 days'", [rest.id]);
    const weekRevenue = parseInt(weekRevenueRes.rows[0].sum) || 0;

    const commissionPercent = rest.commission_percent || 15;
    const totalCommission = Math.floor(totalRevenue * commissionPercent / 100);
    const netEarnings = totalRevenue - totalCommission;

    const settledRes = await q("SELECT SUM(amount) as sum FROM settlements WHERE type = 'restaurant' AND party_id = $1", [rest.id]);
    const settled = parseInt(settledRes.rows[0].sum) || 0;
    const pendingPayout = totalCommission - settled > 0 ? 0 : Math.abs(totalCommission - settled); // amount owed TO restaurant is netEarnings minus what's already been settled against commission — simplified below
    const pendingCommissionOwed = Math.max(0, totalCommission - settled);

    const cancelledCount = parseInt((await q("SELECT COUNT(*) FROM orders WHERE restaurant_id = $1 AND status = 'cancelled'", [rest.id])).rows[0].count);

    res.json({
      totalOrders, todayOrders, deliveredCount, cancelledCount,
      totalRevenue, todayRevenue, weekRevenue,
      commissionPercent, totalCommission, netEarnings,
      settled, pendingCommissionOwed,
    });
  } catch (e) { console.error(e); res.json(null); }
});

app.post('/api/restaurant/documents', async (req, res) => {
  const decoded = verifyToken(req);
  if (!decoded || decoded.role !== 'restaurant') return res.json({ success: false });
  try {
    const {
      owner_name, fssai_license, fssai_document, gst_number,
      bank_account_number, bank_ifsc, bank_account_holder,
      aadhaar_number, pan_number, address_proof_document, id_proof_document,
    } = req.body;
    await q(`UPDATE restaurants SET
        owner_name=$1, fssai_license=$2, fssai_document=$3, gst_number=$4, verification_status=$5,
        bank_account_number=$6, bank_ifsc=$7, bank_account_holder=$8,
        aadhaar_number=$9, pan_number=$10, address_proof_document=$11, id_proof_document=$12
      WHERE user_id=$13`,
      [owner_name || '', fssai_license || '', fssai_document || '', gst_number || '', 'pending',
       bank_account_number || '', bank_ifsc || '', bank_account_holder || '',
       aadhaar_number || '', pan_number || '', address_proof_document || '', id_proof_document || '', decoded.id]);
    res.json({ success: true });
  } catch (e) { console.error(e); res.json({ success: false }); }
});
app.get('/api/restaurant/orders', async (req, res) => {
  const decoded = verifyToken(req);
  if (!decoded || decoded.role !== 'restaurant') return res.json([]);
  try {
    const rr = await q('SELECT * FROM restaurants WHERE user_id = $1', [decoded.id]);
    const rest = rr.rows[0];
    if (!rest) return res.json([]);
    const r = await q(`
      SELECT o.*, db.name as delivery_boy_name, db.phone as delivery_boy_phone, db.is_online as delivery_boy_online
      FROM orders o
      LEFT JOIN delivery_boys db ON o.delivery_boy_id = db.id
      WHERE o.restaurant_id = $1
      ORDER BY o.created_at DESC
    `, [rest.id]);
    res.json(r.rows);
  } catch (e) { res.json([]); }
});
// ===== RESTAURANT'S OWN MENU MANAGEMENT — a restaurant can only ever see/touch its own items =====
app.get('/api/restaurant/menu', async (req, res) => {
  const decoded = verifyToken(req);
  if (!decoded || decoded.role !== 'restaurant') return res.json([]);
  try {
    const rr = await q('SELECT * FROM restaurants WHERE user_id = $1', [decoded.id]);
    const rest = rr.rows[0];
    if (!rest) return res.json([]);
    const r = await q('SELECT * FROM menu_items WHERE restaurant_id = $1 ORDER BY category, name', [rest.id]);
    res.json(r.rows);
  } catch (e) { res.json([]); }
});
app.post('/api/restaurant/menu/add', async (req, res) => {
  const decoded = verifyToken(req);
  if (!decoded || decoded.role !== 'restaurant') return res.json({ success: false });
  try {
    const rr = await q('SELECT * FROM restaurants WHERE user_id = $1', [decoded.id]);
    const rest = rr.rows[0];
    if (!rest) return res.json({ success: false });
    const { category, name, price, original_price, portions, description, image, is_veg } = req.body;
    await q('INSERT INTO menu_items (restaurant_id, category, name, price, original_price, portions, description, image, is_veg) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)',
      [rest.id, category, name, price, original_price || null, portions ? JSON.stringify(portions) : null, description || '', image || '', is_veg !== undefined ? is_veg : 1]);
    res.json({ success: true });
  } catch (e) { console.error(e); res.json({ success: false }); }
});
app.post('/api/restaurant/menu/update', async (req, res) => {
  const decoded = verifyToken(req);
  if (!decoded || decoded.role !== 'restaurant') return res.json({ success: false });
  try {
    const rr = await q('SELECT * FROM restaurants WHERE user_id = $1', [decoded.id]);
    const rest = rr.rows[0];
    if (!rest) return res.json({ success: false });
    const { id, name, price, original_price, portions, description, image, is_available, is_veg } = req.body;
    const owns = await q('SELECT id FROM menu_items WHERE id = $1 AND restaurant_id = $2', [id, rest.id]);
    if (owns.rows.length === 0) return res.json({ success: false, message: 'Item not found' });
    await q('UPDATE menu_items SET name=$1, price=$2, original_price=$3, portions=$4, description=$5, image=$6, is_available=$7, is_veg=$8 WHERE id=$9',
      [name, price, original_price || null, portions ? JSON.stringify(portions) : null, description, image, is_available, is_veg !== undefined ? is_veg : 1, id]);
    res.json({ success: true });
  } catch (e) { res.json({ success: false }); }
});
app.post('/api/restaurant/menu/toggle', async (req, res) => {
  const decoded = verifyToken(req);
  if (!decoded || decoded.role !== 'restaurant') return res.json({ success: false });
  try {
    const rr = await q('SELECT * FROM restaurants WHERE user_id = $1', [decoded.id]);
    const rest = rr.rows[0];
    if (!rest) return res.json({ success: false });
    const { id, is_available } = req.body;
    const owns = await q('SELECT id FROM menu_items WHERE id = $1 AND restaurant_id = $2', [id, rest.id]);
    if (owns.rows.length === 0) return res.json({ success: false, message: 'Item not found' });
    await q('UPDATE menu_items SET is_available = $1 WHERE id = $2', [is_available, id]);
    res.json({ success: true });
  } catch (e) { res.json({ success: false }); }
});
app.post('/api/restaurant/menu/delete', async (req, res) => {
  const decoded = verifyToken(req);
  if (!decoded || decoded.role !== 'restaurant') return res.json({ success: false });
  try {
    const rr = await q('SELECT * FROM restaurants WHERE user_id = $1', [decoded.id]);
    const rest = rr.rows[0];
    if (!rest) return res.json({ success: false });
    const { id } = req.body;
    const owns = await q('SELECT id FROM menu_items WHERE id = $1 AND restaurant_id = $2', [id, rest.id]);
    if (owns.rows.length === 0) return res.json({ success: false, message: 'Item not found' });
    await q('DELETE FROM menu_items WHERE id = $1', [id]);
    res.json({ success: true });
  } catch (e) { res.json({ success: false }); }
});

// ===== RESTAURANT'S OWN REVIEWS =====
app.get('/api/restaurant/reviews', async (req, res) => {
  const decoded = verifyToken(req);
  if (!decoded || decoded.role !== 'restaurant') return res.json([]);
  try {
    const rr = await q('SELECT * FROM restaurants WHERE user_id = $1', [decoded.id]);
    const rest = rr.rows[0];
    if (!rest) return res.json([]);
    const r = await q(`
      SELECT rt.*, u.name as customer_name
      FROM ratings rt
      LEFT JOIN users u ON rt.user_id = u.id
      WHERE rt.restaurant_id = $1
      ORDER BY rt.created_at DESC
    `, [rest.id]);
    res.json(r.rows);
  } catch (e) { res.json([]); }
});

app.post('/api/restaurant/orders/status', async (req, res) => {
  const decoded = verifyToken(req);
  if (!decoded || decoded.role !== 'restaurant') return res.json({ success: false });
  try {
    const { id, status, reason } = req.body;
    // A restaurant can move an order forward through its own prep stages, or reject a still-pending order.
    // It can never touch delivery assignment or mark something delivered; that stays with admin.
    if (!['confirmed', 'preparing', 'cancelled'].includes(status)) return res.json({ success: false, message: 'Not allowed' });
    const rr = await q('SELECT * FROM restaurants WHERE user_id = $1', [decoded.id]);
    const rest = rr.rows[0];
    if (!rest) return res.json({ success: false });
    const or = await q('SELECT * FROM orders WHERE id = $1 AND restaurant_id = $2', [id, rest.id]);
    if (or.rows.length === 0) return res.json({ success: false, message: 'Order not found' });
    const currentOrder = or.rows[0];
    // Cooking shouldn't start until someone has actually accepted the delivery —
    // otherwise food gets made with nobody free to pick it up.
    if (status === 'confirmed' && currentOrder.delivery_accepted !== 1) {
      return res.json({ success: false, message: 'Waiting for a delivery partner to accept this order first' });
    }
    // A restaurant can only reject an order before they've already confirmed it — once cooking starts, use support instead.
    if (status === 'cancelled' && currentOrder.status !== 'pending') {
      return res.json({ success: false, message: 'Only a still-pending order can be rejected' });
    }
    await q('UPDATE orders SET status = $1 WHERE id = $2', [status, id]);
    if (status === 'cancelled') {
      await q('INSERT INTO notifications (title, message, type) VALUES ($1,$2,$3)',
        ['Order Rejected', rest.name + ' rejected order #' + id + (reason ? ' — ' + reason : ''), 'order_rejected']);
    }
    notifyCustomerOfStatus(currentOrder, status);
    res.json({ success: true });
  } catch (e) { res.json({ success: false }); }
});

// ===== DINEOUT TILES (admin-managed hero shortcuts, e.g. "Up To 20% OFF", "Fine Dining") =====
app.get('/api/dineout-tiles', async (req, res) => { try { const r = await q('SELECT * FROM dineout_tiles WHERE is_active = 1 ORDER BY sort_order ASC, id ASC'); res.json(r.rows); } catch (e) { res.json([]); } });
app.get('/api/dineout-tiles/all', async (req, res) => { try { const r = await q('SELECT * FROM dineout_tiles ORDER BY sort_order ASC, id ASC'); res.json(r.rows); } catch (e) { res.json([]); } });
app.post('/api/dineout-tiles/add', async (req, res) => {
  try {
    const { label, icon, image, filter_type, filter_value, sort_order } = req.body;
    await q('INSERT INTO dineout_tiles (label, icon, image, filter_type, filter_value, sort_order) VALUES ($1,$2,$3,$4,$5,$6)', [label, icon || 'star', image || '', filter_type || 'none', filter_value || '', sort_order || 0]);
    res.json({ success: true });
  } catch (e) { console.error(e); res.json({ success: false }); }
});
app.post('/api/dineout-tiles/update', async (req, res) => {
  try {
    const { id, label, icon, image, filter_type, filter_value, sort_order, is_active } = req.body;
    await q('UPDATE dineout_tiles SET label=$1, icon=$2, image=$3, filter_type=$4, filter_value=$5, sort_order=$6, is_active=$7 WHERE id=$8', [label, icon, image || '', filter_type, filter_value, sort_order, is_active, id]);
    res.json({ success: true });
  } catch (e) { res.json({ success: false }); }
});
app.post('/api/dineout-tiles/delete', async (req, res) => { await q('DELETE FROM dineout_tiles WHERE id = $1', [req.body.id]); res.json({ success: true }); });

// ===== STAYS TILES (admin-managed hero shortcuts for the Stays tab) =====
app.get('/api/stays-tiles', async (req, res) => { try { const r = await q('SELECT * FROM stays_tiles WHERE is_active = 1 ORDER BY sort_order ASC, id ASC'); res.json(r.rows); } catch (e) { res.json([]); } });
app.get('/api/stays-tiles/all', async (req, res) => { try { const r = await q('SELECT * FROM stays_tiles ORDER BY sort_order ASC, id ASC'); res.json(r.rows); } catch (e) { res.json([]); } });
app.post('/api/stays-tiles/add', async (req, res) => {
  try {
    const { label, icon, image, filter_type, filter_value, sort_order } = req.body;
    await q('INSERT INTO stays_tiles (label, icon, image, filter_type, filter_value, sort_order) VALUES ($1,$2,$3,$4,$5,$6)', [label, icon || 'star', image || '', filter_type || 'none', filter_value || '', sort_order || 0]);
    res.json({ success: true });
  } catch (e) { console.error(e); res.json({ success: false }); }
});
app.post('/api/stays-tiles/update', async (req, res) => {
  try {
    const { id, label, icon, image, filter_type, filter_value, sort_order, is_active } = req.body;
    await q('UPDATE stays_tiles SET label=$1, icon=$2, image=$3, filter_type=$4, filter_value=$5, sort_order=$6, is_active=$7 WHERE id=$8', [label, icon, image || '', filter_type, filter_value, sort_order, is_active, id]);
    res.json({ success: true });
  } catch (e) { res.json({ success: false }); }
});
app.post('/api/stays-tiles/delete', async (req, res) => { await q('DELETE FROM stays_tiles WHERE id = $1', [req.body.id]); res.json({ success: true }); });

app.get('/api/menu/:restaurant_id', async (req, res) => { try { const r = await q('SELECT * FROM menu_items WHERE restaurant_id = $1 ORDER BY category', [req.params.restaurant_id]); res.json(r.rows); } catch (e) { res.json([]); } });
// One single query for every dish across every restaurant — used by Home/Stores search & "trending dishes"
// sections so the app doesn't have to make one network call per restaurant (which was the real cause of the lag).
app.get('/api/menu-all', async (req, res) => {
  try {
    const r = await q(`
      SELECT m.*, r.name as restaurant_name, r.emoji as restaurant_emoji
      FROM menu_items m
      JOIN restaurants r ON m.restaurant_id = r.id
      WHERE r.active = 1 AND m.is_available = 1
      ORDER BY m.category
    `);
    res.json(r.rows);
  } catch (e) { console.error(e); res.json([]); }
});
app.post('/api/menu/add', async (req, res) => {
  try {
    const { restaurant_id, category, name, price, original_price, portions, description, image, is_veg, is_featured } = req.body;
    await q('INSERT INTO menu_items (restaurant_id, category, name, price, original_price, portions, description, image, is_veg, is_featured) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)',
      [restaurant_id, category, name, price, original_price || null, portions ? JSON.stringify(portions) : null, description || '', image || '', is_veg !== undefined ? is_veg : 1, is_featured ? 1 : 0]);
    res.json({ success: true });
  } catch (e) { console.error(e); res.json({ success: false }); }
});
app.post('/api/menu/update', async (req, res) => {
  try {
    const { id, name, price, original_price, portions, description, image, is_available, is_veg, is_featured } = req.body;
    await q('UPDATE menu_items SET name=$1, price=$2, original_price=$3, portions=$4, description=$5, image=$6, is_available=$7, is_veg=$8, is_featured=$9 WHERE id=$10',
      [name, price, original_price || null, portions ? JSON.stringify(portions) : null, description, image, is_available, is_veg !== undefined ? is_veg : 1, is_featured ? 1 : 0, id]);
    res.json({ success: true });
  } catch (e) { res.json({ success: false }); }
});
app.post('/api/menu/toggle-featured', async (req, res) => { const { id, is_featured } = req.body; await q('UPDATE menu_items SET is_featured = $1 WHERE id = $2', [is_featured, id]); res.json({ success: true }); });
app.post('/api/menu/toggle', async (req, res) => { const { id, is_available } = req.body; await q('UPDATE menu_items SET is_available = $1 WHERE id = $2', [is_available, id]); res.json({ success: true }); });
app.post('/api/menu/delete', async (req, res) => { await q('DELETE FROM menu_items WHERE id = $1', [req.body.id]); res.json({ success: true }); });

// Shared fee logic — used both when actually placing an order and when previewing the fee live in the cart
async function computeDeliveryFee(rest, customerLat, customerLng) {
  let delivery_distance_km = null;
  let delivery_fee = 0;
  if (!rest) return { delivery_distance_km, delivery_fee };
  if (customerLat != null && customerLng != null && rest.lat != null && rest.lng != null) {
    delivery_distance_km = haversineKm(rest.lat, rest.lng, customerLat, customerLng);
  }
  if (rest.free_delivery) {
    delivery_fee = 0;
  } else if (delivery_distance_km !== null) {
    const settingsR = await q('SELECT * FROM app_settings');
    const settings = {};
    settingsR.rows.forEach((row) => { settings[row.key] = row.value; });
    const baseFee = parseInt(settings.delivery_base_fee) || 15;
    const perKmRate = parseInt(settings.delivery_per_km_rate) || 8;
    delivery_fee = Math.round(baseFee + perKmRate * delivery_distance_km);
  } else {
    delivery_fee = rest.delivery_charge || 0;
  }
  return { delivery_distance_km, delivery_fee };
}

app.get('/api/delivery-fee-preview', async (req, res) => {
  try {
    const { restaurant_id, lat, lng } = req.query;
    const restR = await q('SELECT * FROM restaurants WHERE id = $1', [restaurant_id]);
    const result = await computeDeliveryFee(restR.rows[0], lat ? parseFloat(lat) : null, lng ? parseFloat(lng) : null);
    res.json(result);
  } catch (e) { res.json({ delivery_distance_km: null, delivery_fee: 0 }); }
});

app.post('/api/user/fcm-token', async (req, res) => {
  const decoded = verifyToken(req);
  if (!decoded) return res.json({ success: false });
  try {
    const { fcm_token } = req.body;
    await q('UPDATE users SET fcm_token = $1 WHERE id = $2', [fcm_token, decoded.id]);
    res.json({ success: true });
  } catch (e) { res.json({ success: false }); }
});

app.post('/api/order', strictLimiter, async (req, res) => {
  try {
    const { customer_name, customer_phone, customer_address, restaurant_id, restaurant_name, items, total, payment_method, customer_lat, customer_lng } = req.body;
    const decoded = verifyToken(req);
    const user_id = decoded ? decoded.id : null;

    const restR = await q('SELECT * FROM restaurants WHERE id = $1', [restaurant_id]);
    const rest = restR.rows[0];
    if (!rest || rest.active === 0) return res.json({ success: false, message: 'This restaurant is no longer available.' });
    if (rest.is_open === 0) return res.json({ success: false, message: rest.name + ' is currently closed and not accepting orders right now.' });

    // Catch items that went out of stock between browsing and checkout — better to say so now
    // than to have the restaurant reject the whole order later.
    const menuR = await q('SELECT name, is_available FROM menu_items WHERE restaurant_id = $1', [restaurant_id]);
    const unavailable = (items || [])
      .map((it) => menuR.rows.find((m) => m.name === it.name))
      .filter((m) => m && m.is_available === 0)
      .map((m) => m.name);
    if (unavailable.length > 0) {
      return res.json({ success: false, message: 'These items just went out of stock: ' + unavailable.join(', ') + '. Please remove them from your cart.' });
    }

    const { delivery_distance_km, delivery_fee } = await computeDeliveryFee(rest, customer_lat, customer_lng);

    const insertRes = await q('INSERT INTO orders (user_id, customer_name, customer_phone, customer_address, restaurant_id, restaurant_name, items, total, payment_method, customer_lat, customer_lng, delivery_distance_km, delivery_fee) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING id',
      [user_id, customer_name, customer_phone, customer_address, restaurant_id, restaurant_name, JSON.stringify(items), total, payment_method || 'cash', customer_lat || null, customer_lng || null, delivery_distance_km, delivery_fee]);
    const newOrderId = insertRes.rows[0].id;

    if (user_id) {
      const userR = await q('SELECT fcm_token FROM users WHERE id = $1', [user_id]);
      const fcmToken = userR.rows[0]?.fcm_token;
      if (fcmToken) sendPushNotification(fcmToken, 'Order Placed! 🎉', `Your order from ${restaurant_name} has been placed. We'll notify you as it progresses.`, { order_id: newOrderId, status: 'pending' });
    }

    // Look for a delivery partner right away — the restaurant will only see "start cooking"
    // once someone has actually accepted, so food never gets made for nobody to pick up.
    let assignedRider = null;
    if (rest) assignedRider = await autoAssignDeliveryBoy(newOrderId, rest.lat, rest.lng);

    await q('INSERT INTO notifications (title, message, type) VALUES ($1,$2,$3)', ['New Order! 🛵', customer_name + ' ordered from ' + restaurant_name + ' — ₹' + total, 'order']);
    if (!assignedRider) {
      await q('INSERT INTO notifications (title, message, type) VALUES ($1,$2,$3)', ['No Delivery Boy Free ⚠️', 'Order #' + newOrderId + ' at ' + restaurant_name + ' has no delivery partner nearby — please assign manually', 'assign_failed']);
    }
    res.json({ success: true, delivery_fee, delivery_distance_km, order_id: newOrderId });
  } catch (e) { console.error(e); res.json({ success: false }); }
});
app.get('/api/orders', async (req, res) => { try { const r = await q('SELECT * FROM orders ORDER BY created_at DESC'); res.json(r.rows); } catch (e) { res.json([]); } });
const STATUS_MESSAGES = {
  confirmed: { title: 'Order Confirmed! 🎉', body: (name) => name + ' has confirmed your order and started preparing it.' },
  preparing: { title: 'Preparing your food 👨‍🍳', body: (name) => name + ' is preparing your order.' },
  on_the_way: { title: 'On the way! 🛵', body: () => 'Your order has been picked up and is on its way.' },
  delivered: { title: 'Delivered! ✅', body: () => 'Enjoy your meal! Thanks for ordering with ZEPPO.' },
  cancelled: { title: 'Order Cancelled', body: (name) => name + ' was unable to take this order. It has been cancelled.' },
};

async function notifyCustomerOfStatus(order, status) {
  if (!order || !order.user_id) return;
  const msg = STATUS_MESSAGES[status];
  if (!msg) return;
  try {
    const userR = await q('SELECT fcm_token FROM users WHERE id = $1', [order.user_id]);
    const token = userR.rows[0]?.fcm_token;
    if (token) await sendPushNotification(token, msg.title, msg.body(order.restaurant_name), { order_id: order.id, status });
  } catch (e) {}
}

app.post('/api/orders/status', async (req, res) => {
  try {
    const { id, status } = req.body;
    const before = await q('SELECT * FROM orders WHERE id = $1', [id]);
    await q('UPDATE orders SET status = $1 WHERE id = $2', [status, id]);
    if (status === 'confirmed' && before.rows[0] && !before.rows[0].delivery_boy_id) {
      const restR = await q('SELECT * FROM restaurants WHERE id = $1', [before.rows[0].restaurant_id]);
      const rest = restR.rows[0];
      if (rest) {
        const assigned = await autoAssignDeliveryBoy(id, rest.lat, rest.lng);
        if (assigned) await q('INSERT INTO notifications (title, message, type) VALUES ($1,$2,$3)', ['Auto-Assigned 🛵', assigned.name + ' assigned to order #' + id, 'assign']);
      }
    }
    if (status === 'delivered') {
      const r = await q('SELECT * FROM orders WHERE id = $1', [id]);
      const order = r.rows[0];
      if (order && order.delivery_boy_id) await q('UPDATE delivery_boys SET total_deliveries = total_deliveries + 1, total_earned = total_earned + salary_per_delivery WHERE id = $1', [order.delivery_boy_id]);
    }
    if (before.rows[0]) notifyCustomerOfStatus(before.rows[0], status);
    res.json({ success: true });
  } catch (e) { res.json({ success: false }); }
});
app.get('/api/my-orders', async (req, res) => {
  const decoded = verifyToken(req);
  if (!decoded) return res.json([]);
  try { const r = await q('SELECT * FROM orders WHERE user_id = $1 ORDER BY created_at DESC', [decoded.id]); res.json(r.rows); } catch (e) { res.json([]); }
});
app.get('/api/delivery-orders', async (req, res) => {
  const decoded = verifyToken(req);
  if (!decoded) return res.json([]);
  try {
    const dr = await q('SELECT * FROM delivery_boys WHERE user_id = $1', [decoded.id]);
    const dboy = dr.rows[0];
    if (!dboy) return res.json([]);
    const r = await q("SELECT * FROM orders WHERE delivery_boy_id = $1 AND status IN ('pending','confirmed','preparing','on_the_way','delivered') ORDER BY created_at DESC", [dboy.id]);
    res.json(r.rows);
  } catch (e) { res.json([]); }
});
app.post('/api/orders/assign', async (req, res) => { const { order_id, delivery_boy_id } = req.body; await q('UPDATE orders SET delivery_boy_id = $1 WHERE id = $2', [delivery_boy_id, order_id]); res.json({ success: true }); });
app.post('/api/orders/cancel', async (req, res) => {
  try {
    const r = await q('SELECT * FROM orders WHERE id = $1', [req.body.id]);
    const order = r.rows[0];
    const refundStatus = (order && order.payment_method === 'upi') ? 'pending' : 'none';
    await q("UPDATE orders SET status = 'cancelled', refund_status = $1 WHERE id = $2", [refundStatus, req.body.id]);
    if (refundStatus === 'pending') await q('INSERT INTO notifications (title, message, type) VALUES ($1,$2,$3)', ['Refund Pending 💰', 'Order #' + req.body.id + ' (₹' + order.total + ') needs a UPI refund to ' + order.customer_name, 'refund']);
    res.json({ success: true });
  } catch (e) { res.json({ success: false }); }
});

app.get('/api/orders/refunds', async (req, res) => { try { const r = await q("SELECT * FROM orders WHERE refund_status IN ('pending','refunded') ORDER BY created_at DESC"); res.json(r.rows); } catch (e) { res.json([]); } });
app.post('/api/orders/refunds/complete', async (req, res) => { await q("UPDATE orders SET refund_status = 'refunded' WHERE id = $1", [req.body.id]); res.json({ success: true }); });

app.get('/api/delivery-boys', async (req, res) => { try { const r = await q('SELECT * FROM delivery_boys WHERE is_active = 1'); res.json(r.rows); } catch (e) { res.json([]); } });
app.post('/api/delivery-boys/add', async (req, res) => {
  try {
    const { name, phone, email, password, salary_per_delivery } = req.body;
    let user_id = null;
    if (email && password) {
      const exists = await q('SELECT * FROM users WHERE email = $1', [email]);
      if (exists.rows.length > 0) return res.json({ success: false, message: 'Email already used!' });
      const hashedPassword = bcrypt.hashSync(password, 10);
      const result = await q("INSERT INTO users (name, email, phone, password, role, referral_code) VALUES ($1,$2,$3,$4,'delivery',$5) RETURNING id", [name, email, phone, hashedPassword, generateReferralCode(name)]);
      user_id = result.rows[0].id;
    }
    await q('INSERT INTO delivery_boys (user_id, name, phone, salary_per_delivery) VALUES ($1,$2,$3,$4)', [user_id, name, phone, salary_per_delivery || 50]);
    res.json({ success: true });
  } catch (e) { console.error(e); res.json({ success: false }); }
});
app.post('/api/delivery-boys/salary', async (req, res) => { const { id, salary_per_delivery } = req.body; await q('UPDATE delivery_boys SET salary_per_delivery = $1 WHERE id = $2', [salary_per_delivery, id]); res.json({ success: true }); });
app.post('/api/delivery-boys/advance', async (req, res) => {
  const { id, amount, note } = req.body;
  await q('UPDATE delivery_boys SET advance_taken = advance_taken + $1 WHERE id = $2', [amount, id]);
  await q('INSERT INTO delivery_advances (delivery_boy_id, amount, note) VALUES ($1,$2,$3)', [id, amount, note || '']);
  await q('INSERT INTO notifications (title, message, type) VALUES ($1,$2,$3)', ['Advance Given', '₹' + amount + ' advance given' + (note ? ' — ' + note : ''), 'advance']);
  res.json({ success: true });
});
app.get('/api/delivery-boys/stats', async (req, res) => { try { const r = await q('SELECT * FROM delivery_boys WHERE is_active = 1'); res.json(r.rows); } catch (e) { res.json([]); } });
app.get('/api/delivery-boys/me', async (req, res) => {
  const decoded = verifyToken(req);
  if (!decoded) return res.json(null);
  try { const r = await q('SELECT * FROM delivery_boys WHERE user_id = $1', [decoded.id]); res.json(r.rows[0] || null); } catch (e) { res.json(null); }
});
app.get('/api/delivery-boys/my-advances', async (req, res) => {
  const decoded = verifyToken(req);
  if (!decoded) return res.json([]);
  try {
    const dr = await q('SELECT * FROM delivery_boys WHERE user_id = $1', [decoded.id]);
    const dboy = dr.rows[0];
    if (!dboy) return res.json([]);
    const r = await q('SELECT * FROM delivery_advances WHERE delivery_boy_id = $1 ORDER BY created_at DESC', [dboy.id]);
    res.json(r.rows);
  } catch (e) { res.json([]); }
});
app.get('/api/delivery-boys/:id/advances', async (req, res) => { try { const r = await q('SELECT * FROM delivery_advances WHERE delivery_boy_id = $1 ORDER BY created_at DESC', [req.params.id]); res.json(r.rows); } catch (e) { res.json([]); } });
app.post('/api/delivery-boys/remove', async (req, res) => { await q('UPDATE delivery_boys SET is_active = 0, is_online = 0 WHERE id = $1', [req.body.id]); res.json({ success: true }); });
app.post('/api/delivery-boys/toggle-online', async (req, res) => {
  const decoded = verifyToken(req);
  if (!decoded) return res.json({ success: false });
  try {
    const { lat, lng } = req.body;
    const dr = await q('SELECT * FROM delivery_boys WHERE user_id = $1', [decoded.id]);
    const dboy = dr.rows[0];
    if (!dboy) return res.json({ success: false });
    if (dboy.is_online) {
      await q('UPDATE delivery_boys SET is_online = 0 WHERE id = $1', [dboy.id]);
      const shiftR = await q('SELECT * FROM delivery_shifts WHERE delivery_boy_id = $1 AND check_out IS NULL ORDER BY id DESC LIMIT 1', [dboy.id]);
      if (shiftR.rows[0]) await q('UPDATE delivery_shifts SET check_out = NOW() WHERE id = $1', [shiftR.rows[0].id]);
      res.json({ success: true, is_online: 0 });
    } else {
      await q('UPDATE delivery_boys SET is_online = 1, lat = $1, lng = $2, location_updated_at = NOW() WHERE id = $3', [lat || null, lng || null, dboy.id]);
      await q('INSERT INTO delivery_shifts (delivery_boy_id, check_in) VALUES ($1, NOW())', [dboy.id]);
      res.json({ success: true, is_online: 1 });
    }
  } catch (e) { res.json({ success: false }); }
});
app.post('/api/delivery-boys/update-location', async (req, res) => {
  const decoded = verifyToken(req);
  if (!decoded) return res.json({ success: false });
  try {
    const { lat, lng } = req.body;
    const dr = await q('SELECT * FROM delivery_boys WHERE user_id = $1', [decoded.id]);
    const dboy = dr.rows[0];
    if (!dboy) return res.json({ success: false });
    await q('UPDATE delivery_boys SET lat = $1, lng = $2, location_updated_at = NOW() WHERE id = $3', [lat, lng, dboy.id]);
    res.json({ success: true });
  } catch (e) { res.json({ success: false }); }
});

// A delivery boy responds to an offered order — accepting locks it in, declining hands it to the next nearest boy
app.post('/api/delivery-boys/orders/respond', async (req, res) => {
  const decoded = verifyToken(req);
  if (!decoded) return res.json({ success: false });
  try {
    const { order_id, accept } = req.body;
    const dr = await q('SELECT * FROM delivery_boys WHERE user_id = $1', [decoded.id]);
    const dboy = dr.rows[0];
    if (!dboy) return res.json({ success: false });
    const or = await q('SELECT * FROM orders WHERE id = $1 AND delivery_boy_id = $2', [order_id, dboy.id]);
    if (or.rows.length === 0) return res.json({ success: false, message: 'Order not found or already reassigned' });

    if (accept) {
      await q('UPDATE orders SET delivery_accepted = 1 WHERE id = $1', [order_id]);
      return res.json({ success: true, accepted: true });
    }

    // Declined — try the next nearest boy, excluding this one
    await q('UPDATE orders SET delivery_boy_id = NULL, delivery_accepted = NULL WHERE id = $1', [order_id]);
    const restR = await q('SELECT * FROM restaurants WHERE id = $1', [or.rows[0].restaurant_id]);
    const rest = restR.rows[0];
    let reassigned = null;
    if (rest) reassigned = await autoAssignDeliveryBoy(order_id, rest.lat, rest.lng, [dboy.id]);
    if (!reassigned) {
      await q('INSERT INTO notifications (title, message, type) VALUES ($1,$2,$3)', ['No Delivery Boy Free ⚠️', 'Order #' + order_id + ' declined and no one else is free — please assign manually', 'assign_failed']);
    }
    res.json({ success: true, accepted: false, reassigned: reassigned ? reassigned.name : null });
  } catch (e) { console.error(e); res.json({ success: false }); }
});
app.get('/api/delivery-boys/my-shifts', async (req, res) => {
  const decoded = verifyToken(req);
  if (!decoded) return res.json([]);
  try {
    const dr = await q('SELECT * FROM delivery_boys WHERE user_id = $1', [decoded.id]);
    const dboy = dr.rows[0];
    if (!dboy) return res.json([]);
    const r = await q("SELECT * FROM delivery_shifts WHERE delivery_boy_id = $1 AND check_in::date = CURRENT_DATE ORDER BY id DESC", [dboy.id]);
    res.json(r.rows);
  } catch (e) { res.json([]); }
});
app.get('/api/delivery-boys/all-shifts', async (req, res) => {
  try { const r = await q(`SELECT s.*, d.name as delivery_boy_name FROM delivery_shifts s LEFT JOIN delivery_boys d ON s.delivery_boy_id = d.id WHERE s.check_in::date = CURRENT_DATE ORDER BY s.id DESC`); res.json(r.rows); } catch (e) { res.json([]); }
});

app.get('/api/settlements/restaurants', async (req, res) => {
  try {
    const restR = await q('SELECT * FROM restaurants WHERE active = 1');
    const result = [];
    for (const r of restR.rows) {
      const deliveredR = await q("SELECT SUM(total) as sum, COUNT(*) as cnt FROM orders WHERE restaurant_id = $1 AND status = 'delivered'", [r.id]);
      const delivered = deliveredR.rows[0];
      const totalCommission = Math.floor((parseInt(delivered.sum) || 0) * (r.commission_percent || 15) / 100);
      const settledR = await q("SELECT SUM(amount) as sum FROM settlements WHERE type = 'restaurant' AND party_id = $1", [r.id]);
      const settled = parseInt(settledR.rows[0].sum) || 0;
      result.push({ id: r.id, name: r.name, emoji: r.emoji, orders: parseInt(delivered.cnt) || 0, revenue: parseInt(delivered.sum) || 0, commission_percent: r.commission_percent || 15, totalCommission, settled, pending: totalCommission - settled });
    }
    res.json(result);
  } catch (e) { console.error(e); res.json([]); }
});
app.post('/api/settlements/restaurant/pay', async (req, res) => {
  const { restaurant_id, amount, note } = req.body;
  const r = await q('SELECT * FROM restaurants WHERE id = $1', [restaurant_id]);
  await q('INSERT INTO settlements (type, party_id, party_name, amount, note) VALUES ($1,$2,$3,$4,$5)', ['restaurant', restaurant_id, r.rows[0] ? r.rows[0].name : '', amount, note || '']);
  res.json({ success: true });
});
app.get('/api/settlements/restaurant/:id/history', async (req, res) => { try { const r = await q("SELECT * FROM settlements WHERE type = 'restaurant' AND party_id = $1 ORDER BY created_at DESC", [req.params.id]); res.json(r.rows); } catch (e) { res.json([]); } });
app.post('/api/delivery-boys/settle', async (req, res) => {
  const { id, amount, note } = req.body;
  const d = await q('SELECT * FROM delivery_boys WHERE id = $1', [id]);
  await q('UPDATE delivery_boys SET paid_out = paid_out + $1 WHERE id = $2', [amount, id]);
  await q('INSERT INTO settlements (type, party_id, party_name, amount, note) VALUES ($1,$2,$3,$4,$5)', ['delivery', id, d.rows[0] ? d.rows[0].name : '', amount, note || 'Salary payout']);
  res.json({ success: true });
});
app.get('/api/settlements/delivery/:id/history', async (req, res) => { try { const r = await q("SELECT * FROM settlements WHERE type = 'delivery' AND party_id = $1 ORDER BY created_at DESC", [req.params.id]); res.json(r.rows); } catch (e) { res.json([]); } });

app.post('/api/tickets', async (req, res) => {
  try {
    const { name, phone, email, subject, message, priority } = req.body;
    const decoded = verifyToken(req);
    const user_id = decoded ? decoded.id : null;
    await q('INSERT INTO support_tickets (user_id, name, phone, email, subject, message, priority) VALUES ($1,$2,$3,$4,$5,$6,$7)', [user_id, name, phone, email, subject, message, priority || 'normal']);
    await q('INSERT INTO notifications (title, message, type) VALUES ($1,$2,$3)', ['New Support Ticket', name + ': ' + subject, 'ticket']);
    res.json({ success: true });
  } catch (e) { console.error(e); res.json({ success: false }); }
});
app.get('/api/tickets', async (req, res) => { try { const r = await q('SELECT * FROM support_tickets ORDER BY created_at DESC'); res.json(r.rows); } catch (e) { res.json([]); } });
app.get('/api/tickets/my', async (req, res) => {
  const decoded = verifyToken(req);
  if (!decoded) return res.json([]);
  try { const r = await q('SELECT * FROM support_tickets WHERE user_id = $1 ORDER BY created_at DESC', [decoded.id]); res.json(r.rows); } catch (e) { res.json([]); }
});
app.post('/api/tickets/status', async (req, res) => { const { id, status } = req.body; await q('UPDATE support_tickets SET status = $1, updated_at = NOW() WHERE id = $2', [status, id]); res.json({ success: true }); });
app.post('/api/tickets/reply', async (req, res) => { const { id, reply } = req.body; await q("UPDATE support_tickets SET admin_reply = $1, status = 'in_progress', updated_at = NOW() WHERE id = $2", [reply, id]); res.json({ success: true }); });

app.post('/api/rating', async (req, res) => {
  try {
    const { restaurant_id, order_id, rating, review } = req.body;
    const decoded = verifyToken(req);
    const user_id = decoded ? decoded.id : null;
    const exists = await q('SELECT * FROM ratings WHERE user_id = $1 AND order_id = $2', [user_id, order_id]);
    if (exists.rows.length > 0) return res.json({ success: false, message: 'Already rated!' });
    await q('INSERT INTO ratings (user_id, restaurant_id, order_id, rating, review) VALUES ($1,$2,$3,$4,$5)', [user_id, restaurant_id, order_id, rating, review]);
    const avgR = await q('SELECT AVG(rating) as avg FROM ratings WHERE restaurant_id = $1', [restaurant_id]);
    await q('UPDATE restaurants SET rating = $1 WHERE id = $2', [parseFloat(avgR.rows[0].avg).toFixed(1), restaurant_id]);
    res.json({ success: true });
  } catch (e) { console.error(e); res.json({ success: false }); }
});
app.get('/api/ratings/:restaurant_id', async (req, res) => {
  try { const r = await q('SELECT r.*, u.name as user_name FROM ratings r LEFT JOIN users u ON r.user_id = u.id WHERE r.restaurant_id = $1 ORDER BY r.created_at DESC', [req.params.restaurant_id]); res.json(r.rows); } catch (e) { res.json([]); }
});

app.get('/api/notifications', async (req, res) => { try { const r = await q('SELECT * FROM notifications ORDER BY created_at DESC LIMIT 20'); res.json(r.rows); } catch (e) { res.json([]); } });
app.get('/api/notifications/unread', async (req, res) => { try { const r = await q("SELECT COUNT(*) as count FROM notifications WHERE is_read = 0"); res.json({ count: parseInt(r.rows[0].count) }); } catch (e) { res.json({ count: 0 }); } });
app.post('/api/notifications/read', async (req, res) => { await q('UPDATE notifications SET is_read = 1'); res.json({ success: true }); });

app.get('/api/banners', async (req, res) => { try { const r = await q('SELECT * FROM banners WHERE is_active = 1'); res.json(r.rows); } catch (e) { res.json([]); } });
app.post('/api/banners/add', async (req, res) => {
  try {
    const { title, subtitle, button_text, image, link, is_video, category, position } = req.body;
    await q('INSERT INTO banners (title, subtitle, button_text, image, link, is_video, category, position) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)', [title, subtitle, button_text, image || '', link || '', is_video ? 1 : 0, category || 'food', position || 'top']);
    res.json({ success: true });
  } catch (e) { console.error(e); res.json({ success: false }); }
});
app.post('/api/banners/delete', async (req, res) => { await q('UPDATE banners SET is_active = 0 WHERE id = $1', [req.body.id]); res.json({ success: true }); });

app.get('/api/settings', async (req, res) => {
  try {
    const r = await q('SELECT * FROM app_settings');
    const settings = {};
    r.rows.forEach((row) => { settings[row.key] = row.value; });
    res.json(settings);
  } catch (e) { res.json({}); }
});
app.post('/api/settings', async (req, res) => {
  try {
    const { key, value } = req.body;
    await q('INSERT INTO app_settings (key, value) VALUES ($1,$2) ON CONFLICT (key) DO UPDATE SET value = $2', [key, value]);
    res.json({ success: true });
  } catch (e) { console.error(e); res.json({ success: false }); }
});

app.get('/api/stays', async (req, res) => { try { const r = await q('SELECT * FROM stays WHERE is_active = 1'); res.json(r.rows); } catch (e) { res.json([]); } });
app.post('/api/stays/add', async (req, res) => {
  try {
    const { name, type, price_per_night, address, phone, amenities, images, description, video } = req.body;
    await q('INSERT INTO stays (name, type, price_per_night, address, phone, amenities, images, description, video) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)', [name, type || 'Hotel', price_per_night, address, phone || '', amenities || '', JSON.stringify(images || []), description || '', video || '']);
    res.json({ success: true });
  } catch (e) { console.error(e); res.json({ success: false }); }
});
app.post('/api/stays/update', async (req, res) => {
  try {
    const { id, name, type, price_per_night, address, phone, amenities, images, description, video } = req.body;
    await q('UPDATE stays SET name=$1, type=$2, price_per_night=$3, address=$4, phone=$5, amenities=$6, images=$7, description=$8, video=$9 WHERE id=$10', [name, type, price_per_night, address, phone || '', amenities || '', JSON.stringify(images || []), description || '', video || '', id]);
    res.json({ success: true });
  } catch (e) { res.json({ success: false }); }
});
app.post('/api/stays/delete', async (req, res) => { await q('UPDATE stays SET is_active = 0 WHERE id = $1', [req.body.id]); res.json({ success: true }); });
app.post('/api/stays/book', async (req, res) => {
  try {
    const { stay_id, stay_name, customer_name, customer_phone, check_in, check_out, guests } = req.body;
    await q('INSERT INTO stay_bookings (stay_id, stay_name, customer_name, customer_phone, check_in, check_out, guests) VALUES ($1,$2,$3,$4,$5,$6,$7)', [stay_id, stay_name, customer_name, customer_phone, check_in, check_out, guests || 1]);
    await q('INSERT INTO notifications (title, message, type) VALUES ($1,$2,$3)', ['New Stay Booking Request!', customer_name + ' wants to book ' + stay_name + ' (' + check_in + ' to ' + check_out + ')', 'booking']);
    res.json({ success: true });
  } catch (e) { console.error(e); res.json({ success: false }); }
});
app.get('/api/stays/bookings', async (req, res) => { try { const r = await q('SELECT * FROM stay_bookings ORDER BY created_at DESC'); res.json(r.rows); } catch (e) { res.json([]); } });
app.post('/api/stays/bookings/status', async (req, res) => { const { id, status } = req.body; await q('UPDATE stay_bookings SET status = $1 WHERE id = $2', [status, id]); res.json({ success: true }); });

// ===== TABLE BOOKINGS (Dineout) =====
app.post('/api/tables/book', async (req, res) => {
  try {
    const { restaurant_id, restaurant_name, customer_name, customer_phone, booking_date, booking_time, guests, offer_selected } = req.body;
    await q('INSERT INTO table_bookings (restaurant_id, restaurant_name, customer_name, customer_phone, booking_date, booking_time, guests, offer_selected) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)',
      [restaurant_id, restaurant_name, customer_name, customer_phone, booking_date, booking_time, guests || 2, offer_selected || 'standard']);
    await q('INSERT INTO notifications (title, message, type) VALUES ($1,$2,$3)', ['New Table Booking! 🍽️', customer_name + ' wants a table at ' + restaurant_name + ' on ' + booking_date + ' ' + booking_time, 'table_booking']);
    res.json({ success: true });
  } catch (e) { console.error(e); res.json({ success: false }); }
});
app.get('/api/tables/bookings', async (req, res) => { try { const r = await q('SELECT * FROM table_bookings ORDER BY created_at DESC'); res.json(r.rows); } catch (e) { res.json([]); } });
app.post('/api/tables/bookings/status', async (req, res) => { const { id, status } = req.body; await q('UPDATE table_bookings SET status = $1 WHERE id = $2', [status, id]); res.json({ success: true }); });

app.get('/api/coupons', async (req, res) => { try { const r = await q('SELECT * FROM coupons WHERE is_active = 1'); res.json(r.rows); } catch (e) { res.json([]); } });
app.post('/api/coupons/verify', async (req, res) => {
  try {
    const { code, total } = req.body;
    const r = await q('SELECT * FROM coupons WHERE code = $1 AND is_active = 1', [code]);
    const coupon = r.rows[0];
    if (!coupon) return res.json({ success: false, message: 'Invalid coupon!' });
    if (total < coupon.min_order) return res.json({ success: false, message: 'Minimum order ₹' + coupon.min_order });
    const discount = coupon.type === 'percent' ? Math.floor(total * coupon.discount / 100) : coupon.discount;
    res.json({ success: true, discount, final: total - discount });
  } catch (e) { res.json({ success: false, message: 'Error' }); }
});
app.post('/api/coupons/add', async (req, res) => {
  const { code, discount, type, min_order } = req.body;
  await q('INSERT INTO coupons (code, discount, type, min_order) VALUES ($1,$2,$3,$4) ON CONFLICT (code) DO NOTHING', [code, discount, type, min_order]);
  res.json({ success: true });
});
app.post('/api/coupons/delete', async (req, res) => { await q('UPDATE coupons SET is_active = 0 WHERE id = $1', [req.body.id]); res.json({ success: true }); });

app.get('/api/users', async (req, res) => { try { const r = await q('SELECT id, name, email, phone, role, wallet_balance, referral_code, created_at FROM users'); res.json(r.rows); } catch (e) { res.json([]); } });

app.post('/api/apply', async (req, res) => {
  try {
    const { full_name, father_name, phone, aadhar, dob, address, has_bike, bike_number, id_proof_document, license_document, bank_account_number, bank_ifsc, bank_account_holder } = req.body;
    await q('INSERT INTO applications (full_name, father_name, phone, aadhar, dob, address, has_bike, bike_number, id_proof_document, license_document, bank_account_number, bank_ifsc, bank_account_holder) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)',
      [full_name, father_name, phone, aadhar, dob, address, has_bike, bike_number, id_proof_document || '', license_document || '', bank_account_number || '', bank_ifsc || '', bank_account_holder || '']);
    await q('INSERT INTO notifications (title, message, type) VALUES ($1,$2,$3)', ['New Application!', full_name + ' applied as delivery partner', 'application']);
    res.json({ success: true });
  } catch (e) { console.error(e); res.json({ success: false }); }
});
app.get('/api/applications', async (req, res) => { try { const r = await q('SELECT * FROM applications ORDER BY created_at DESC'); res.json(r.rows); } catch (e) { res.json([]); } });
app.post('/api/application/status', async (req, res) => { const { id, status } = req.body; await q('UPDATE applications SET status = $1 WHERE id = $2', [status, id]); res.json({ success: true }); });

// Approving an application is the only way a delivery account gets created — this is what actually
// issues login credentials, so the applicant's uploaded documents get a real human look first.
app.post('/api/application/approve', async (req, res) => {
  try {
    const { id, email, password, salary_per_delivery } = req.body;
    if (!email || !password) return res.json({ success: false, message: 'Email and password are required' });
    const appRes = await q('SELECT * FROM applications WHERE id = $1', [id]);
    const app_ = appRes.rows[0];
    if (!app_) return res.json({ success: false, message: 'Application not found' });
    const exists = await q('SELECT * FROM users WHERE email = $1', [email]);
    if (exists.rows.length > 0) return res.json({ success: false, message: 'Email already used!' });
    const hashedPassword = bcrypt.hashSync(password, 10);
    const userResult = await q("INSERT INTO users (name, email, phone, password, role, referral_code) VALUES ($1,$2,$3,$4,'delivery',$5) RETURNING id",
      [app_.full_name, email, app_.phone, hashedPassword, generateReferralCode(app_.full_name)]);
    const dbResult = await q('INSERT INTO delivery_boys (user_id, name, phone, salary_per_delivery, bank_account_number, bank_ifsc, bank_account_holder) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id',
      [userResult.rows[0].id, app_.full_name, app_.phone, salary_per_delivery || 50, app_.bank_account_number || '', app_.bank_ifsc || '', app_.bank_account_holder || '']);
    await q("UPDATE applications SET status = 'approved', delivery_boy_id = $1 WHERE id = $2", [dbResult.rows[0].id, id]);
    res.json({ success: true });
  } catch (e) { console.error(e); res.json({ success: false }); }
});

// ===== RESTAURANT APPLICATIONS — same gated pattern: apply with documents, admin reviews, approval creates the account =====
app.post('/api/restaurant-apply', async (req, res) => {
  try {
    const {
      restaurant_name, owner_name, category, address, phone,
      fssai_license, fssai_document, gst_number,
      bank_account_number, bank_ifsc, bank_account_holder,
      id_proof_document, address_proof_document,
    } = req.body;
    if (!restaurant_name || !owner_name || !address || !phone || !fssai_license) return res.json({ success: false, message: 'Please fill all required fields' });
    await q(`INSERT INTO restaurant_applications
      (restaurant_name, owner_name, category, address, phone, fssai_license, fssai_document, gst_number, bank_account_number, bank_ifsc, bank_account_holder, id_proof_document, address_proof_document)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
      [restaurant_name, owner_name, category || '', address, phone, fssai_license, fssai_document || '', gst_number || '', bank_account_number || '', bank_ifsc || '', bank_account_holder || '', id_proof_document || '', address_proof_document || '']);
    await q('INSERT INTO notifications (title, message, type) VALUES ($1,$2,$3)', ['New Restaurant Application! 🍽️', restaurant_name + ' applied to join ZEPPO', 'restaurant_application']);
    res.json({ success: true });
  } catch (e) { console.error(e); res.json({ success: false }); }
});
app.get('/api/restaurant-applications', async (req, res) => { try { const r = await q('SELECT * FROM restaurant_applications ORDER BY created_at DESC'); res.json(r.rows); } catch (e) { res.json([]); } });
app.post('/api/restaurant-applications/status', async (req, res) => { const { id, status } = req.body; await q('UPDATE restaurant_applications SET status = $1 WHERE id = $2', [status, id]); res.json({ success: true }); });
app.post('/api/restaurant-applications/approve', async (req, res) => {
  try {
    const { id, email, password, commission_percent } = req.body;
    if (!email || !password) return res.json({ success: false, message: 'Email and password are required' });
    const appRes = await q('SELECT * FROM restaurant_applications WHERE id = $1', [id]);
    const app_ = appRes.rows[0];
    if (!app_) return res.json({ success: false, message: 'Application not found' });
    const exists = await q('SELECT * FROM users WHERE email = $1', [email]);
    if (exists.rows.length > 0) return res.json({ success: false, message: 'Email already used!' });
    const hashedPassword = bcrypt.hashSync(password, 10);
    const userResult = await q("INSERT INTO users (name, email, phone, password, role, referral_code) VALUES ($1,$2,$3,$4,'restaurant',$5) RETURNING id",
      [app_.owner_name, email, app_.phone, hashedPassword, generateReferralCode(app_.owner_name)]);
    const restResult = await q(`INSERT INTO restaurants
      (user_id, name, category, address, phone, commission_percent, owner_name, fssai_license, fssai_document, gst_number,
       bank_account_number, bank_ifsc, bank_account_holder, id_proof_document, verification_status, active, opening_time, closing_time)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,'verified',1,'09:00','23:00') RETURNING id`,
      [userResult.rows[0].id, app_.restaurant_name, app_.category, app_.address, app_.phone, commission_percent || 15,
       app_.owner_name, app_.fssai_license, app_.fssai_document, app_.gst_number,
       app_.bank_account_number, app_.bank_ifsc, app_.bank_account_holder, app_.id_proof_document]);
    await q("UPDATE restaurant_applications SET status = 'approved', restaurant_id = $1 WHERE id = $2", [restResult.rows[0].id, id]);
    res.json({ success: true });
  } catch (e) { console.error(e); res.json({ success: false }); }
});

app.get('/api/analytics', async (req, res) => {
  try {
    const totalOrders = parseInt((await q('SELECT COUNT(*) FROM orders')).rows[0].count);
    const totalRevenue = parseInt((await q("SELECT SUM(total) FROM orders WHERE status = 'delivered'")).rows[0].sum) || 0;
    const totalUsers = parseInt((await q('SELECT COUNT(*) FROM users')).rows[0].count);
    const totalRestaurants = parseInt((await q('SELECT COUNT(*) FROM restaurants WHERE active = 1')).rows[0].count);
    const pendingOrders = parseInt((await q("SELECT COUNT(*) FROM orders WHERE status = 'pending'")).rows[0].count);
    const todayOrders = parseInt((await q("SELECT COUNT(*) FROM orders WHERE created_at::date = CURRENT_DATE")).rows[0].count);
    const topRestaurants = (await q('SELECT restaurant_name, COUNT(*) as orders, SUM(total) as revenue FROM orders GROUP BY restaurant_name ORDER BY orders DESC LIMIT 5')).rows;
    const deliveredOrders = (await q("SELECT o.total, r.commission_percent FROM orders o LEFT JOIN restaurants r ON o.restaurant_id = r.id WHERE o.status = 'delivered'")).rows;
    const totalCommission = deliveredOrders.reduce((sum, o) => sum + Math.floor((parseInt(o.total) || 0) * (o.commission_percent || 15) / 100), 0);
    const dboys = (await q('SELECT total_earned, advance_taken, paid_out FROM delivery_boys WHERE is_active = 1')).rows;
    const totalPendingPayout = dboys.reduce((sum, d) => sum + (d.total_earned - d.advance_taken - (d.paid_out || 0)), 0);
    const onlineDeliveryBoys = parseInt((await q('SELECT COUNT(*) FROM delivery_boys WHERE is_online = 1 AND is_active = 1')).rows[0].count);
    const openTickets = parseInt((await q("SELECT COUNT(*) FROM support_tickets WHERE status = 'open'")).rows[0].count);
    const pendingRefunds = parseInt((await q("SELECT COUNT(*) FROM orders WHERE refund_status = 'pending'")).rows[0].count);
    res.json({ totalOrders, totalRevenue, totalUsers, totalRestaurants, pendingOrders, todayOrders, topRestaurants, totalCommission, totalPendingPayout, onlineDeliveryBoys, openTickets, pendingRefunds });
  } catch (e) { console.error(e); res.json({}); }
});

app.use((err, req, res, next) => {
  console.error('SERVER ERROR:', err.message);
  res.status(500).json({ success: false, message: err.message });
});

setupDatabase()
  .then(() => {
    app.listen(3001, () => { console.log('ZEPPO server chal raha hai — http://localhost:3001'); });
  })
  .catch((e) => {
    console.error('Database setup failed:', e);
    process.exit(1);
  });
