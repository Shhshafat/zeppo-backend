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
    folder: req.path.includes('restaurant') ? 'zeppo/restaurants' : req.path.includes('banner') ? 'zeppo/banners' : req.path.includes('stay') ? 'zeppo/stays' : 'zeppo/food',
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
  await q(`CREATE TABLE IF NOT EXISTS restaurants (
    id SERIAL PRIMARY KEY, name TEXT, category TEXT, emoji TEXT, address TEXT, description TEXT,
    image TEXT, rating TEXT DEFAULT '4.5', is_open INTEGER DEFAULT 1, active INTEGER DEFAULT 1,
    commission_percent INTEGER DEFAULT 15, phone TEXT, min_order INTEGER DEFAULT 0,
    delivery_charge INTEGER DEFAULT 0, opening_time TEXT DEFAULT '09:00', closing_time TEXT DEFAULT '23:00',
    created_at TIMESTAMP DEFAULT NOW());`);
  await q(`CREATE TABLE IF NOT EXISTS menu_items (
    id SERIAL PRIMARY KEY, restaurant_id INTEGER, category TEXT, name TEXT, price INTEGER,
    original_price INTEGER, portions TEXT, is_veg INTEGER DEFAULT 1, description TEXT,
    image TEXT, is_available INTEGER DEFAULT 1);`);
  await q(`CREATE TABLE IF NOT EXISTS orders (
    id SERIAL PRIMARY KEY, user_id INTEGER, customer_name TEXT, customer_phone TEXT, customer_address TEXT,
    restaurant_id INTEGER, restaurant_name TEXT, items TEXT, total INTEGER, status TEXT DEFAULT 'pending',
    payment_method TEXT DEFAULT 'cash', payment_status TEXT DEFAULT 'pending', refund_status TEXT DEFAULT 'none',
    delivery_boy_id INTEGER, created_at TIMESTAMP DEFAULT NOW());`);
  await q(`CREATE TABLE IF NOT EXISTS applications (
    id SERIAL PRIMARY KEY, full_name TEXT, father_name TEXT, phone TEXT, aadhar TEXT, dob TEXT,
    address TEXT, has_bike TEXT, bike_number TEXT, status TEXT DEFAULT 'pending', created_at TIMESTAMP DEFAULT NOW());`);
  await q(`CREATE TABLE IF NOT EXISTS delivery_boys (
    id SERIAL PRIMARY KEY, user_id INTEGER, name TEXT, phone TEXT, salary_per_delivery INTEGER DEFAULT 50,
    total_deliveries INTEGER DEFAULT 0, total_earned INTEGER DEFAULT 0, advance_taken INTEGER DEFAULT 0,
    paid_out INTEGER DEFAULT 0, is_online INTEGER DEFAULT 0, is_active INTEGER DEFAULT 1, created_at TIMESTAMP DEFAULT NOW());`);
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
  await q(`CREATE TABLE IF NOT EXISTS stay_bookings (
    id SERIAL PRIMARY KEY, stay_id INTEGER, stay_name TEXT, customer_name TEXT, customer_phone TEXT,
    check_in TEXT, check_out TEXT, guests INTEGER DEFAULT 1, status TEXT DEFAULT 'pending', created_at TIMESTAMP DEFAULT NOW());`);
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
  console.log('Database ready ✅');
}

function generateReferralCode(name) {
  const base = (name || 'ZEPPO').replace(/[^a-zA-Z]/g, '').toUpperCase().slice(0, 5) || 'ZEPPO';
  const rand = Math.floor(1000 + Math.random() * 9000);
  return base + rand;
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
    const token = jwt.sign({ id: user.id, name: user.name, role: user.role }, SECRET, { expiresIn: '7d' });
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

app.get('/api/restaurants', async (req, res) => { try { const r = await q('SELECT * FROM restaurants WHERE active = 1'); res.json(r.rows); } catch (e) { res.json([]); } });
app.post('/api/restaurants/add', async (req, res) => {
  try {
    const { name, category, emoji, address, description, image, commission_percent, phone, min_order, delivery_charge, opening_time, closing_time } = req.body;
    await q('INSERT INTO restaurants (name, category, emoji, address, description, image, commission_percent, phone, min_order, delivery_charge, opening_time, closing_time) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)',
      [name, category, emoji || '🍽️', address, description || '', image || '', commission_percent || 15, phone || '', min_order || 0, delivery_charge || 0, opening_time || '09:00', closing_time || '23:00']);
    await q('INSERT INTO notifications (title, message, type) VALUES ($1,$2,$3)', ['New Restaurant!', name + ' added', 'restaurant']);
    res.json({ success: true });
  } catch (e) { console.error(e); res.json({ success: false }); }
});
app.post('/api/restaurants/update', async (req, res) => {
  try {
    const { id, name, category, emoji, address, description, image, is_open, commission_percent, phone, min_order, delivery_charge, opening_time, closing_time } = req.body;
    await q('UPDATE restaurants SET name=$1, category=$2, emoji=$3, address=$4, description=$5, image=$6, is_open=$7, commission_percent=$8, phone=$9, min_order=$10, delivery_charge=$11, opening_time=$12, closing_time=$13 WHERE id=$14',
      [name, category, emoji, address, description, image, is_open, commission_percent || 15, phone || '', min_order || 0, delivery_charge || 0, opening_time || '09:00', closing_time || '23:00', id]);
    res.json({ success: true });
  } catch (e) { res.json({ success: false }); }
});
app.post('/api/restaurants/delete', async (req, res) => { await q('UPDATE restaurants SET active = 0 WHERE id = $1', [req.body.id]); res.json({ success: true }); });
app.post('/api/restaurants/toggle', async (req, res) => { const { id, is_open } = req.body; await q('UPDATE restaurants SET is_open = $1 WHERE id = $2', [is_open, id]); res.json({ success: true }); });

app.get('/api/menu/:restaurant_id', async (req, res) => { try { const r = await q('SELECT * FROM menu_items WHERE restaurant_id = $1 ORDER BY category', [req.params.restaurant_id]); res.json(r.rows); } catch (e) { res.json([]); } });
app.post('/api/menu/add', async (req, res) => {
  try {
    const { restaurant_id, category, name, price, original_price, portions, description, image, is_veg } = req.body;
    await q('INSERT INTO menu_items (restaurant_id, category, name, price, original_price, portions, description, image, is_veg) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)',
      [restaurant_id, category, name, price, original_price || null, portions ? JSON.stringify(portions) : null, description || '', image || '', is_veg !== undefined ? is_veg : 1]);
    res.json({ success: true });
  } catch (e) { console.error(e); res.json({ success: false }); }
});
app.post('/api/menu/update', async (req, res) => {
  try {
    const { id, name, price, original_price, portions, description, image, is_available, is_veg } = req.body;
    await q('UPDATE menu_items SET name=$1, price=$2, original_price=$3, portions=$4, description=$5, image=$6, is_available=$7, is_veg=$8 WHERE id=$9',
      [name, price, original_price || null, portions ? JSON.stringify(portions) : null, description, image, is_available, is_veg !== undefined ? is_veg : 1, id]);
    res.json({ success: true });
  } catch (e) { res.json({ success: false }); }
});
app.post('/api/menu/toggle', async (req, res) => { const { id, is_available } = req.body; await q('UPDATE menu_items SET is_available = $1 WHERE id = $2', [is_available, id]); res.json({ success: true }); });
app.post('/api/menu/delete', async (req, res) => { await q('DELETE FROM menu_items WHERE id = $1', [req.body.id]); res.json({ success: true }); });

app.post('/api/order', strictLimiter, async (req, res) => {
  try {
    const { customer_name, customer_phone, customer_address, restaurant_id, restaurant_name, items, total, payment_method } = req.body;
    const decoded = verifyToken(req);
    const user_id = decoded ? decoded.id : null;
    await q('INSERT INTO orders (user_id, customer_name, customer_phone, customer_address, restaurant_id, restaurant_name, items, total, payment_method) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)',
      [user_id, customer_name, customer_phone, customer_address, restaurant_id, restaurant_name, JSON.stringify(items), total, payment_method || 'cash']);
    await q('INSERT INTO notifications (title, message, type) VALUES ($1,$2,$3)', ['New Order! 🛵', customer_name + ' ordered from ' + restaurant_name + ' — ₹' + total, 'order']);
    res.json({ success: true });
  } catch (e) { console.error(e); res.json({ success: false }); }
});
app.get('/api/orders', async (req, res) => { try { const r = await q('SELECT * FROM orders ORDER BY created_at DESC'); res.json(r.rows); } catch (e) { res.json([]); } });
app.post('/api/orders/status', async (req, res) => {
  try {
    const { id, status } = req.body;
    await q('UPDATE orders SET status = $1 WHERE id = $2', [status, id]);
    if (status === 'delivered') {
      const r = await q('SELECT * FROM orders WHERE id = $1', [id]);
      const order = r.rows[0];
      if (order && order.delivery_boy_id) await q('UPDATE delivery_boys SET total_deliveries = total_deliveries + 1, total_earned = total_earned + salary_per_delivery WHERE id = $1', [order.delivery_boy_id]);
    }
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
    const r = await q("SELECT * FROM orders WHERE delivery_boy_id = $1 AND status IN ('confirmed','preparing','on_the_way','delivered') ORDER BY created_at DESC", [dboy.id]);
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
    const dr = await q('SELECT * FROM delivery_boys WHERE user_id = $1', [decoded.id]);
    const dboy = dr.rows[0];
    if (!dboy) return res.json({ success: false });
    if (dboy.is_online) {
      await q('UPDATE delivery_boys SET is_online = 0 WHERE id = $1', [dboy.id]);
      const shiftR = await q('SELECT * FROM delivery_shifts WHERE delivery_boy_id = $1 AND check_out IS NULL ORDER BY id DESC LIMIT 1', [dboy.id]);
      if (shiftR.rows[0]) await q('UPDATE delivery_shifts SET check_out = NOW() WHERE id = $1', [shiftR.rows[0].id]);
      res.json({ success: true, is_online: 0 });
    } else {
      await q('UPDATE delivery_boys SET is_online = 1 WHERE id = $1', [dboy.id]);
      await q('INSERT INTO delivery_shifts (delivery_boy_id, check_in) VALUES ($1, NOW())', [dboy.id]);
      res.json({ success: true, is_online: 1 });
    }
  } catch (e) { res.json({ success: false }); }
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
    const { name, type, price_per_night, address, phone, amenities, images, description } = req.body;
    await q('INSERT INTO stays (name, type, price_per_night, address, phone, amenities, images, description) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)', [name, type || 'Hotel', price_per_night, address, phone || '', amenities || '', JSON.stringify(images || []), description || '']);
    res.json({ success: true });
  } catch (e) { console.error(e); res.json({ success: false }); }
});
app.post('/api/stays/update', async (req, res) => {
  try {
    const { id, name, type, price_per_night, address, phone, amenities, images, description } = req.body;
    await q('UPDATE stays SET name=$1, type=$2, price_per_night=$3, address=$4, phone=$5, amenities=$6, images=$7, description=$8 WHERE id=$9', [name, type, price_per_night, address, phone || '', amenities || '', JSON.stringify(images || []), description || '', id]);
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
    const { full_name, father_name, phone, aadhar, dob, address, has_bike, bike_number } = req.body;
    await q('INSERT INTO applications (full_name, father_name, phone, aadhar, dob, address, has_bike, bike_number) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)', [full_name, father_name, phone, aadhar, dob, address, has_bike, bike_number]);
    await q('INSERT INTO notifications (title, message, type) VALUES ($1,$2,$3)', ['New Application!', full_name + ' applied as delivery partner', 'application']);
    res.json({ success: true });
  } catch (e) { console.error(e); res.json({ success: false }); }
});
app.get('/api/applications', async (req, res) => { try { const r = await q('SELECT * FROM applications ORDER BY created_at DESC'); res.json(r.rows); } catch (e) { res.json([]); } });
app.post('/api/application/status', async (req, res) => { const { id, status } = req.body; await q('UPDATE applications SET status = $1 WHERE id = $2', [status, id]); res.json({ success: true }); });

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
