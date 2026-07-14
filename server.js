const express = require('express');
const Database = require('better-sqlite3');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');

const app = express();
const db = new Database('zeppo.db');
const SECRET = 'zeppo_secret_2024';

app.use(express.json());
app.use(express.static('.'));

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT,
    email TEXT UNIQUE,
    phone TEXT,
    password TEXT,
    role TEXT DEFAULT 'user',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS restaurants (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT,
    category TEXT,
    emoji TEXT,
    address TEXT,
    rating TEXT DEFAULT '4.5',
    active INTEGER DEFAULT 1
  );

  CREATE TABLE IF NOT EXISTS menu_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    restaurant_id INTEGER,
    category TEXT,
    name TEXT,
    price INTEGER,
    description TEXT
  );

  CREATE TABLE IF NOT EXISTS orders (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER,
    customer_name TEXT,
    customer_phone TEXT,
    customer_address TEXT,
    restaurant_id INTEGER,
    restaurant_name TEXT,
    items TEXT,
    total INTEGER,
    status TEXT DEFAULT 'pending',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS applications (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    full_name TEXT,
    father_name TEXT,
    phone TEXT,
    aadhar TEXT,
    dob TEXT,
    address TEXT,
    has_bike TEXT,
    bike_number TEXT,
    education TEXT,
    status TEXT DEFAULT 'pending',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );
`);

// Admin account
const adminExists = db.prepare("SELECT * FROM users WHERE role='admin'").get();
if (!adminExists) {
  const hashedPassword = bcrypt.hashSync('zeppo123', 10);
  db.prepare("INSERT INTO users (name, email, phone, password, role) VALUES (?, ?, ?, ?, ?)").run('Shafat', 'admin@zeppo.com', '9999999999', hashedPassword, 'admin');
  console.log('Admin account bana!');
}

// ===== AUTH =====
app.post('/api/register', (req, res) => {
  const { name, email, phone, password } = req.body;
  if (!name || !email || !phone || !password) return res.json({ success: false, message: 'All fields required!' });
  const exists = db.prepare('SELECT * FROM users WHERE email = ?').get(email);
  if (exists) return res.json({ success: false, message: 'Email already registered!' });
  const hashedPassword = bcrypt.hashSync(password, 10);
  db.prepare('INSERT INTO users (name, email, phone, password) VALUES (?, ?, ?, ?)').run(name, email, phone, hashedPassword);
  res.json({ success: true, message: 'Account created!' });
});

app.post('/api/login', (req, res) => {
  const { email, password } = req.body;
  const user = db.prepare('SELECT * FROM users WHERE email = ?').get(email);
  if (!user) return res.json({ success: false, message: 'Email not found!' });
  const valid = bcrypt.compareSync(password, user.password);
  if (!valid) return res.json({ success: false, message: 'Wrong password!' });
  const token = jwt.sign({ id: user.id, name: user.name, role: user.role }, SECRET, { expiresIn: '7d' });
  res.json({ success: true, token, name: user.name, role: user.role });
});

// ===== RESTAURANTS =====
app.get('/api/restaurants', (req, res) => {
  const restaurants = db.prepare('SELECT * FROM restaurants WHERE active = 1').all();
  res.json(restaurants);
});

app.post('/api/restaurants/add', (req, res) => {
  const { name, category, emoji, address } = req.body;
  db.prepare('INSERT INTO restaurants (name, category, emoji, address) VALUES (?, ?, ?, ?)').run(name, category, emoji, address);
  res.json({ success: true });
});

app.post('/api/restaurants/delete', (req, res) => {
  const { id } = req.body;
  db.prepare('UPDATE restaurants SET active = 0 WHERE id = ?').run(id);
  res.json({ success: true });
});

// ===== MENU =====
app.get('/api/menu/:restaurant_id', (req, res) => {
  const items = db.prepare('SELECT * FROM menu_items WHERE restaurant_id = ? ORDER BY category').all(req.params.restaurant_id);
  res.json(items);
});

app.post('/api/menu/add', (req, res) => {
  const { restaurant_id, category, name, price, description } = req.body;
  db.prepare('INSERT INTO menu_items (restaurant_id, category, name, price, description) VALUES (?, ?, ?, ?, ?)').run(restaurant_id, category, name, price, description);
  res.json({ success: true });
});

app.post('/api/menu/delete', (req, res) => {
  const { id } = req.body;
  db.prepare('DELETE FROM menu_items WHERE id = ?').run(id);
  res.json({ success: true });
});

// ===== ORDERS =====
app.post('/api/order', (req, res) => {
  const { customer_name, customer_phone, customer_address, restaurant_id, restaurant_name, items, total } = req.body;
  let user_id = null;
  const auth = req.headers.authorization;
  if (auth) {
    try {
      const token = auth.split(' ')[1];
      const decoded = jwt.verify(token, SECRET);
      user_id = decoded.id;
    } catch(e) {}
  }
  db.prepare('INSERT INTO orders (user_id, customer_name, customer_phone, customer_address, restaurant_id, restaurant_name, items, total) VALUES (?, ?, ?, ?, ?, ?, ?, ?)').run(user_id, customer_name, customer_phone, customer_address, restaurant_id, restaurant_name, JSON.stringify(items), total);
  res.json({ success: true, message: 'Order placed!' });
});

app.get('/api/orders', (req, res) => {
  const orders = db.prepare('SELECT * FROM orders ORDER BY created_at DESC').all();
  res.json(orders);
});

app.post('/api/orders/status', (req, res) => {
  const { id, status } = req.body;
  db.prepare('UPDATE orders SET status = ? WHERE id = ?').run(status, id);
  res.json({ success: true });
});

// My Orders
app.get('/api/my-orders', (req, res) => {
  const auth = req.headers.authorization;
  if (!auth) return res.json([]);
  try {
    const token = auth.split(' ')[1];
    const decoded = jwt.verify(token, SECRET);
    const orders = db.prepare('SELECT * FROM orders WHERE user_id = ? ORDER BY created_at DESC').all(decoded.id);
    res.json(orders);
  } catch(e) {
    res.json([]);
  }
});

// Delivery Orders — confirmed aur upar wale
app.get('/api/delivery-orders', (req, res) => {
  const orders = db.prepare("SELECT * FROM orders WHERE status IN ('confirmed', 'preparing', 'on_the_way', 'delivered') ORDER BY created_at DESC").all();
  res.json(orders);
});

// ===== USERS =====
app.get('/api/users', (req, res) => {
  const users = db.prepare("SELECT id, name, email, phone, role, created_at FROM users").all();
  res.json(users);
});

// ===== APPLICATIONS =====
app.post('/api/apply', (req, res) => {
  const { full_name, father_name, phone, aadhar, dob, address, has_bike, bike_number, education } = req.body;
  db.prepare('INSERT INTO applications (full_name, father_name, phone, aadhar, dob, address, has_bike, bike_number, education) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)').run(full_name, father_name, phone, aadhar, dob, address, has_bike, bike_number, education);
  res.json({ success: true });
});

app.get('/api/applications', (req, res) => {
  const applications = db.prepare('SELECT * FROM applications ORDER BY created_at DESC').all();
  res.json(applications);
});

app.post('/api/application/status', (req, res) => {
  const { id, status } = req.body;
  db.prepare('UPDATE applications SET status = ? WHERE id = ?').run(status, id);
  res.json({ success: true });
});

app.listen(3000, () => {
  console.log('ZEPPO server chal raha hai — http://localhost:3000');
});
