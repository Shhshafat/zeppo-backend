require('dotenv').config();
const express = require('express');
const Database = require('better-sqlite3');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
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
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS,
  },
});

const app = express();
const db = new Database('zeppo.db');
const SECRET = 'zeppo_secret_2024';

const storage = new CloudinaryStorage({
  cloudinary: cloudinary,
  params: (req, file) => ({
    folder: req.path.includes('restaurant') ? 'zeppo/restaurants' : 'zeppo/food',
    allowed_formats: ['jpg', 'jpeg', 'png', 'webp'],
  }),
});
const upload = multer({ storage, limits: { fileSize: 5 * 1024 * 1024 } });

app.use(cors());
app.use(express.json());
app.use(express.static('.'));
app.use('/uploads', express.static('uploads'));

// Database tables
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT, email TEXT UNIQUE, phone TEXT,
    password TEXT, role TEXT DEFAULT 'user',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE IF NOT EXISTS restaurants (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT, category TEXT, emoji TEXT,
    address TEXT, description TEXT,
    image TEXT, rating TEXT DEFAULT '4.5',
    is_open INTEGER DEFAULT 1, active INTEGER DEFAULT 1,
    commission_percent INTEGER DEFAULT 15,
    phone TEXT, min_order INTEGER DEFAULT 0,
    delivery_charge INTEGER DEFAULT 0,
    opening_time TEXT DEFAULT '09:00',
    closing_time TEXT DEFAULT '23:00',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE IF NOT EXISTS menu_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    restaurant_id INTEGER, category TEXT,
    name TEXT, price INTEGER, original_price INTEGER,
    portions TEXT,
    description TEXT,
    image TEXT, is_available INTEGER DEFAULT 1
  );
  CREATE TABLE IF NOT EXISTS orders (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER, customer_name TEXT,
    customer_phone TEXT, customer_address TEXT,
    restaurant_id INTEGER, restaurant_name TEXT,
    items TEXT, total INTEGER,
    status TEXT DEFAULT 'pending',
    payment_method TEXT DEFAULT 'cash',
    payment_status TEXT DEFAULT 'pending',
    delivery_boy_id INTEGER,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE IF NOT EXISTS applications (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    full_name TEXT, father_name TEXT, phone TEXT,
    aadhar TEXT, dob TEXT, address TEXT,
    has_bike TEXT, bike_number TEXT, education TEXT,
    status TEXT DEFAULT 'pending',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE IF NOT EXISTS delivery_boys (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER, name TEXT, phone TEXT,
    salary_per_delivery INTEGER DEFAULT 50,
    total_deliveries INTEGER DEFAULT 0,
    total_earned INTEGER DEFAULT 0,
    advance_taken INTEGER DEFAULT 0,
    is_online INTEGER DEFAULT 1,
    is_active INTEGER DEFAULT 1,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE IF NOT EXISTS ratings (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER, restaurant_id INTEGER,
    order_id INTEGER, rating INTEGER, review TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE IF NOT EXISTS notifications (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT, message TEXT, type TEXT,
    is_read INTEGER DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE IF NOT EXISTS banners (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT, subtitle TEXT, image TEXT,
    button_text TEXT, is_active INTEGER DEFAULT 1,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE IF NOT EXISTS coupons (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    code TEXT UNIQUE, discount INTEGER,
    type TEXT DEFAULT 'percent',
    min_order INTEGER DEFAULT 0,
    is_active INTEGER DEFAULT 1,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE IF NOT EXISTS password_resets (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER, token TEXT UNIQUE,
    expires_at DATETIME,
    used INTEGER DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );
`);

// Admin account
const adminExists = db.prepare("SELECT * FROM users WHERE role='admin'").get();
if (!adminExists) {
  const hashedPassword = bcrypt.hashSync('zeppo123', 10);
  db.prepare("INSERT INTO users (name, email, phone, password, role) VALUES (?, ?, ?, ?, ?)").run('Shafat', 'admin@zeppo.com', '9999999999', hashedPassword, 'admin');
}

// Default coupon
const couponExists = db.prepare("SELECT * FROM coupons WHERE code='ZEPPO50'").get();
if (!couponExists) {
  db.prepare("INSERT INTO coupons (code, discount, type, min_order) VALUES (?, ?, ?, ?)").run('ZEPPO50', 50, 'flat', 100);
}

// ===== AUTH =====
app.post('/api/register', (req, res) => {
  const { name, email, phone, password } = req.body;
  if (!name || !email || !phone || !password) return res.json({ success: false, message: 'All fields required!' });
  const exists = db.prepare('SELECT * FROM users WHERE email = ?').get(email);
  if (exists) return res.json({ success: false, message: 'Email already registered!' });
  const hashedPassword = bcrypt.hashSync(password, 10);
  db.prepare('INSERT INTO users (name, email, phone, password) VALUES (?, ?, ?, ?)').run(name, email, phone, hashedPassword);
  res.json({ success: true });
});

app.post('/api/login', (req, res) => {
  const { emailOrPhone, password } = req.body;
  const user = db.prepare('SELECT * FROM users WHERE email = ? OR phone = ?').get(emailOrPhone, emailOrPhone);
  if (!user) return res.json({ success: false, message: 'Account not found!' });
  const valid = bcrypt.compareSync(password, user.password);
  if (!valid) return res.json({ success: false, message: 'Wrong password!' });
  const token = jwt.sign({ id: user.id, name: user.name, role: user.role }, SECRET, { expiresIn: '7d' });
  res.json({ success: true, token, name: user.name, role: user.role });
});

app.post('/api/forgot-password', async (req, res) => {
  const { email } = req.body;
  const user = db.prepare('SELECT * FROM users WHERE email = ?').get(email);
  if (!user) return res.json({ success: true });

  const token = crypto.randomBytes(32).toString('hex');
  const expiresAt = new Date(Date.now() + 30 * 60 * 1000).toISOString();
  db.prepare('INSERT INTO password_resets (user_id, token, expires_at) VALUES (?, ?, ?)').run(user.id, token, expiresAt);

  const resetLink = `${process.env.FRONTEND_URL || 'http://localhost:3000'}/reset-password/${token}`;

  try {
    await transporter.sendMail({
      from: `"ZEPPO" <${process.env.EMAIL_USER}>`,
      to: email,
      subject: 'Reset your ZEPPO password',
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 480px; margin: 0 auto; padding: 30px; background: #1a0a0f; color: white; border-radius: 16px;">
          <h1 style="color: #ff6b00; letter-spacing: 2px;">ZEPPO</h1>
          <p>Ghar tak, jhatpat!</p>
          <hr style="border-color: rgba(255,255,255,0.1);" />
          <p>Hi ${user.name},</p>
          <p>You requested a password reset. Click below to set a new password (valid for 30 minutes):</p>
          <a href="${resetLink}" style="display:inline-block; background:#ff6b00; color:white; padding:14px 28px; border-radius:12px; text-decoration:none; font-weight:bold; margin: 15px 0;">Reset Password</a>
          <p style="color: rgba(255,255,255,0.5); font-size: 13px;">If you didn't request this, you can ignore this email.</p>
        </div>
      `,
    });
    res.json({ success: true });
  } catch (e) {
    console.error('EMAIL ERROR:', e.message);
    res.json({ success: false, message: 'Email bhejne mein error aaya!' });
  }
});

app.post('/api/reset-password', (req, res) => {
  const { token, newPassword } = req.body;
  const reset = db.prepare('SELECT * FROM password_resets WHERE token = ? AND used = 0').get(token);
  if (!reset) return res.json({ success: false, message: 'Invalid or expired link!' });
  if (new Date(reset.expires_at) < new Date()) return res.json({ success: false, message: 'Link expired! Request a new one.' });

  const hashedPassword = bcrypt.hashSync(newPassword, 10);
  db.prepare('UPDATE users SET password = ? WHERE id = ?').run(hashedPassword, reset.user_id);
  db.prepare('UPDATE password_resets SET used = 1 WHERE id = ?').run(reset.id);
  res.json({ success: true });
});

// ===== IMAGE UPLOAD =====
app.post('/api/upload/restaurant', upload.single('image'), (req, res) => {
  if (!req.file) return res.json({ success: false });
  res.json({ success: true, url: req.file.path });
});

app.post('/api/upload/food', upload.single('image'), (req, res) => {
  if (!req.file) return res.json({ success: false });
  res.json({ success: true, url: req.file.path });
});

// ===== RESTAURANTS =====
app.get('/api/restaurants', (req, res) => {
  const restaurants = db.prepare('SELECT * FROM restaurants WHERE active = 1').all();
  res.json(restaurants);
});

app.post('/api/restaurants/add', (req, res) => {
  const { name, category, emoji, address, description, image, commission_percent, phone, min_order, delivery_charge, opening_time, closing_time } = req.body;
  db.prepare('INSERT INTO restaurants (name, category, emoji, address, description, image, commission_percent, phone, min_order, delivery_charge, opening_time, closing_time) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').run(
    name, category, emoji || '🍽️', address, description || '', image || '',
    commission_percent || 15, phone || '', min_order || 0, delivery_charge || 0,
    opening_time || '09:00', closing_time || '23:00'
  );
  db.prepare('INSERT INTO notifications (title, message, type) VALUES (?, ?, ?)').run('New Restaurant!', `${name} added`, 'restaurant');
  res.json({ success: true });
});

app.post('/api/restaurants/update', (req, res) => {
  const { id, name, category, emoji, address, description, image, is_open, commission_percent, phone, min_order, delivery_charge, opening_time, closing_time } = req.body;
  db.prepare('UPDATE restaurants SET name=?, category=?, emoji=?, address=?, description=?, image=?, is_open=?, commission_percent=?, phone=?, min_order=?, delivery_charge=?, opening_time=?, closing_time=? WHERE id=?').run(
    name, category, emoji, address, description, image, is_open,
    commission_percent || 15, phone || '', min_order || 0, delivery_charge || 0,
    opening_time || '09:00', closing_time || '23:00', id
  );
  res.json({ success: true });
});

app.post('/api/restaurants/delete', (req, res) => {
  db.prepare('UPDATE restaurants SET active = 0 WHERE id = ?').run(req.body.id);
  res.json({ success: true });
});

app.post('/api/restaurants/toggle', (req, res) => {
  const { id, is_open } = req.body;
  db.prepare('UPDATE restaurants SET is_open = ? WHERE id = ?').run(is_open, id);
  res.json({ success: true });
});

// ===== MENU =====
app.get('/api/menu/:restaurant_id', (req, res) => {
  const items = db.prepare('SELECT * FROM menu_items WHERE restaurant_id = ? ORDER BY category').all(req.params.restaurant_id);
  res.json(items);
});

app.post('/api/menu/add', (req, res) => {
  const { restaurant_id, category, name, price, original_price, portions, description, image } = req.body;
  db.prepare('INSERT INTO menu_items (restaurant_id, category, name, price, original_price, portions, description, image) VALUES (?, ?, ?, ?, ?, ?, ?, ?)').run(
    restaurant_id, category, name, price, original_price || null,
    portions ? JSON.stringify(portions) : null, description || '', image || ''
  );
  res.json({ success: true });
});

app.post('/api/menu/update', (req, res) => {
  const { id, name, price, original_price, portions, description, image, is_available } = req.body;
  db.prepare('UPDATE menu_items SET name=?, price=?, original_price=?, portions=?, description=?, image=?, is_available=? WHERE id=?').run(
    name, price, original_price || null, portions ? JSON.stringify(portions) : null, description, image, is_available, id
  );
  res.json({ success: true });
});

app.post('/api/menu/toggle', (req, res) => {
  const { id, is_available } = req.body;
  db.prepare('UPDATE menu_items SET is_available = ? WHERE id = ?').run(is_available, id);
  res.json({ success: true });
});

app.post('/api/menu/delete', (req, res) => {
  db.prepare('DELETE FROM menu_items WHERE id = ?').run(req.body.id);
  res.json({ success: true });
});

// ===== ORDERS =====
app.post('/api/order', (req, res) => {
  const { customer_name, customer_phone, customer_address, restaurant_id, restaurant_name, items, total, payment_method } = req.body;
  let user_id = null;
  const auth = req.headers.authorization;
  if (auth) {
    try {
      const decoded = jwt.verify(auth.split(' ')[1], SECRET);
      user_id = decoded.id;
    } catch(e) {}
  }
  db.prepare('INSERT INTO orders (user_id, customer_name, customer_phone, customer_address, restaurant_id, restaurant_name, items, total, payment_method) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)').run(user_id, customer_name, customer_phone, customer_address, restaurant_id, restaurant_name, JSON.stringify(items), total, payment_method || 'cash');
  db.prepare('INSERT INTO notifications (title, message, type) VALUES (?, ?, ?)').run('New Order! 🛵', `${customer_name} ordered from ${restaurant_name} — ₹${total}`, 'order');
  res.json({ success: true });
});

app.get('/api/orders', (req, res) => {
  res.json(db.prepare('SELECT * FROM orders ORDER BY created_at DESC').all());
});

app.post('/api/orders/status', (req, res) => {
  const { id, status } = req.body;
  db.prepare('UPDATE orders SET status = ? WHERE id = ?').run(status, id);
  if (status === 'delivered') {
    const order = db.prepare('SELECT * FROM orders WHERE id = ?').get(id);
    if (order?.delivery_boy_id) {
      db.prepare('UPDATE delivery_boys SET total_deliveries = total_deliveries + 1, total_earned = total_earned + salary_per_delivery WHERE id = ?').run(order.delivery_boy_id);
    }
  }
  res.json({ success: true });
});

app.get('/api/my-orders', (req, res) => {
  const auth = req.headers.authorization;
  if (!auth) return res.json([]);
  try {
    const decoded = jwt.verify(auth.split(' ')[1], SECRET);
    res.json(db.prepare('SELECT * FROM orders WHERE user_id = ? ORDER BY created_at DESC').all(decoded.id));
  } catch(e) { res.json([]); }
});

app.get('/api/delivery-orders', (req, res) => {
  const auth = req.headers.authorization;
  if (!auth) return res.json([]);
  try {
    const decoded = jwt.verify(auth.split(' ')[1], SECRET);
    const dboy = db.prepare('SELECT * FROM delivery_boys WHERE user_id = ?').get(decoded.id);
    if (!dboy) return res.json([]);
    res.json(db.prepare("SELECT * FROM orders WHERE delivery_boy_id = ? AND status IN ('confirmed','preparing','on_the_way','delivered') ORDER BY created_at DESC").all(dboy.id));
  } catch(e) { res.json([]); }
});

app.post('/api/orders/assign', (req, res) => {
  const { order_id, delivery_boy_id } = req.body;
  db.prepare('UPDATE orders SET delivery_boy_id = ? WHERE id = ?').run(delivery_boy_id, order_id);
  res.json({ success: true });
});

app.post('/api/orders/cancel', (req, res) => {
  db.prepare("UPDATE orders SET status = 'cancelled' WHERE id = ?").run(req.body.id);
  res.json({ success: true });
});

// ===== DELIVERY BOYS =====
app.get('/api/delivery-boys', (req, res) => {
  res.json(db.prepare('SELECT * FROM delivery_boys WHERE is_active = 1').all());
});

app.post('/api/delivery-boys/add', (req, res) => {
  const { name, phone, email, password, salary_per_delivery } = req.body;
  let user_id = null;
  if (email && password) {
    const exists = db.prepare('SELECT * FROM users WHERE email = ?').get(email);
    if (exists) return res.json({ success: false, message: 'Email already used!' });
    const hashedPassword = bcrypt.hashSync(password, 10);
    const result = db.prepare("INSERT INTO users (name, email, phone, password, role) VALUES (?, ?, ?, ?, 'delivery')").run(name, email, phone, hashedPassword);
    user_id = result.lastInsertRowid;
  }
  db.prepare('INSERT INTO delivery_boys (user_id, name, phone, salary_per_delivery) VALUES (?, ?, ?, ?)').run(user_id, name, phone, salary_per_delivery || 50);
  res.json({ success: true });
});

app.post('/api/delivery-boys/salary', (req, res) => {
  const { id, salary_per_delivery } = req.body;
  db.prepare('UPDATE delivery_boys SET salary_per_delivery = ? WHERE id = ?').run(salary_per_delivery, id);
  res.json({ success: true });
});

app.post('/api/delivery-boys/advance', (req, res) => {
  const { id, amount } = req.body;
  db.prepare('UPDATE delivery_boys SET advance_taken = advance_taken + ? WHERE id = ?').run(amount, id);
  res.json({ success: true });
});

app.get('/api/delivery-boys/stats', (req, res) => {
  res.json(db.prepare('SELECT * FROM delivery_boys').all());
});

app.get('/api/delivery-boys/me', (req, res) => {
  const auth = req.headers.authorization;
  if (!auth) return res.json(null);
  try {
    const decoded = jwt.verify(auth.split(' ')[1], SECRET);
    const dboy = db.prepare('SELECT * FROM delivery_boys WHERE user_id = ?').get(decoded.id);
    res.json(dboy || null);
  } catch(e) { res.json(null); }
});

// ===== RATINGS =====
app.post('/api/rating', (req, res) => {
  const { restaurant_id, order_id, rating, review } = req.body;
  let user_id = null;
  const auth = req.headers.authorization;
  if (auth) {
    try { user_id = jwt.verify(auth.split(' ')[1], SECRET).id; } catch(e) {}
  }
  const exists = db.prepare('SELECT * FROM ratings WHERE user_id = ? AND order_id = ?').get(user_id, order_id);
  if (exists) return res.json({ success: false, message: 'Already rated!' });
  db.prepare('INSERT INTO ratings (user_id, restaurant_id, order_id, rating, review) VALUES (?, ?, ?, ?, ?)').run(user_id, restaurant_id, order_id, rating, review);
  const avg = db.prepare('SELECT AVG(rating) as avg FROM ratings WHERE restaurant_id = ?').get(restaurant_id);
  db.prepare('UPDATE restaurants SET rating = ? WHERE id = ?').run(avg.avg.toFixed(1), restaurant_id);
  res.json({ success: true });
});

app.get('/api/ratings/:restaurant_id', (req, res) => {
  res.json(db.prepare('SELECT r.*, u.name as user_name FROM ratings r LEFT JOIN users u ON r.user_id = u.id WHERE r.restaurant_id = ? ORDER BY r.created_at DESC').all(req.params.restaurant_id));
});

// ===== NOTIFICATIONS =====
app.get('/api/notifications', (req, res) => {
  res.json(db.prepare('SELECT * FROM notifications ORDER BY created_at DESC LIMIT 20').all());
});

app.get('/api/notifications/unread', (req, res) => {
  res.json({ count: db.prepare("SELECT COUNT(*) as count FROM notifications WHERE is_read = 0").get().count });
});

app.post('/api/notifications/read', (req, res) => {
  db.prepare('UPDATE notifications SET is_read = 1').run();
  res.json({ success: true });
});

// ===== BANNERS =====
app.get('/api/banners', (req, res) => {
  res.json(db.prepare('SELECT * FROM banners WHERE is_active = 1').all());
});

app.post('/api/banners/add', (req, res) => {
  const { title, subtitle, button_text } = req.body;
  db.prepare('INSERT INTO banners (title, subtitle, button_text) VALUES (?, ?, ?)').run(title, subtitle, button_text);
  res.json({ success: true });
});

app.post('/api/banners/delete', (req, res) => {
  db.prepare('UPDATE banners SET is_active = 0 WHERE id = ?').run(req.body.id);
  res.json({ success: true });
});

// ===== COUPONS =====
app.get('/api/coupons', (req, res) => {
  res.json(db.prepare('SELECT * FROM coupons WHERE is_active = 1').all());
});

app.post('/api/coupons/verify', (req, res) => {
  const { code, total } = req.body;
  const coupon = db.prepare('SELECT * FROM coupons WHERE code = ? AND is_active = 1').get(code);
  if (!coupon) return res.json({ success: false, message: 'Invalid coupon!' });
  if (total < coupon.min_order) return res.json({ success: false, message: `Minimum order ₹${coupon.min_order}` });
  const discount = coupon.type === 'percent' ? Math.floor(total * coupon.discount / 100) : coupon.discount;
  res.json({ success: true, discount, final: total - discount });
});

app.post('/api/coupons/add', (req, res) => {
  const { code, discount, type, min_order } = req.body;
  db.prepare('INSERT OR IGNORE INTO coupons (code, discount, type, min_order) VALUES (?, ?, ?, ?)').run(code, discount, type, min_order);
  res.json({ success: true });
});

app.post('/api/coupons/delete', (req, res) => {
  db.prepare('UPDATE coupons SET is_active = 0 WHERE id = ?').run(req.body.id);
  res.json({ success: true });
});

// ===== USERS =====
app.get('/api/users', (req, res) => {
  res.json(db.prepare("SELECT id, name, email, phone, role, created_at FROM users").all());
});

// ===== APPLICATIONS =====
app.post('/api/apply', (req, res) => {
  const { full_name, father_name, phone, aadhar, dob, address, has_bike, bike_number, education } = req.body;
  db.prepare('INSERT INTO applications (full_name, father_name, phone, aadhar, dob, address, has_bike, bike_number, education) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)').run(full_name, father_name, phone, aadhar, dob, address, has_bike, bike_number, education);
  db.prepare('INSERT INTO notifications (title, message, type) VALUES (?, ?, ?)').run('New Application!', `${full_name} applied as delivery partner`, 'application');
  res.json({ success: true });
});

app.get('/api/applications', (req, res) => {
  res.json(db.prepare('SELECT * FROM applications ORDER BY created_at DESC').all());
});

app.post('/api/application/status', (req, res) => {
  const { id, status } = req.body;
  db.prepare('UPDATE applications SET status = ? WHERE id = ?').run(status, id);
  res.json({ success: true });
});

// ===== ANALYTICS =====
app.get('/api/analytics', (req, res) => {
  const totalOrders = db.prepare('SELECT COUNT(*) as count FROM orders').get().count;
  const totalRevenue = db.prepare("SELECT SUM(total) as sum FROM orders WHERE status = 'delivered'").get().sum || 0;
  const totalUsers = db.prepare('SELECT COUNT(*) as count FROM users').get().count;
  const totalRestaurants = db.prepare('SELECT COUNT(*) as count FROM restaurants WHERE active = 1').get().count;
  const pendingOrders = db.prepare("SELECT COUNT(*) as count FROM orders WHERE status = 'pending'").get().count;
  const todayOrders = db.prepare("SELECT COUNT(*) as count FROM orders WHERE date(created_at) = date('now')").get().count;
  const topRestaurants = db.prepare('SELECT restaurant_name, COUNT(*) as orders, SUM(total) as revenue FROM orders GROUP BY restaurant_name ORDER BY orders DESC LIMIT 5').all();

  const deliveredOrders = db.prepare("SELECT o.total, r.commission_percent FROM orders o LEFT JOIN restaurants r ON o.restaurant_id = r.id WHERE o.status = 'delivered'").all();
  const totalCommission = deliveredOrders.reduce((sum, o) => sum + Math.floor((o.total || 0) * (o.commission_percent || 15) / 100), 0);

  const dboys = db.prepare('SELECT total_earned, advance_taken FROM delivery_boys').all();
  const totalPendingPayout = dboys.reduce((sum, d) => sum + (d.total_earned - d.advance_taken), 0);

  res.json({ totalOrders, totalRevenue, totalUsers, totalRestaurants, pendingOrders, todayOrders, topRestaurants, totalCommission, totalPendingPayout });
});

// Error handler
app.use((err, req, res, next) => {
  console.error('SERVER ERROR:', err.message);
  res.status(500).json({ success: false, message: err.message });
});

app.listen(3001, () => {
  console.log('ZEPPO server chal raha hai — http://localhost:3001');
});
