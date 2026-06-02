const express = require("express");
const cors = require("cors");
const path = require("path");
const crypto = require("crypto");
const initSqlJs = require("sql.js");
const fs = require("fs");
const nodemailer = require("nodemailer");
const multer = require("multer");
const http = require("http");
const { Server } = require("socket.io");
const cloudinary = require("cloudinary").v2;
require("dotenv").config();

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET
});

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });
const PORT = 3000;
const DB_PATH = path.join(__dirname, "snafix.db");
const FROM_EMAIL = "snafic.official@gmail.com";
const UPLOAD_DIR = path.join(__dirname, "uploads");

if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const storage = multer.diskStorage({
  destination: UPLOAD_DIR,
  filename: (req, file, cb) => cb(null, Date.now() + "-" + file.originalname)
});
const upload = multer({ storage, limits: { fileSize: 5 * 1024 * 1024 } });

const transporter = nodemailer.createTransport({
  host: "smtp.gmail.com", port: 587, secure: false,
  auth: { user: FROM_EMAIL, pass: process.env.SNAFIC_EMAIL_PASS || "" }
});

app.use(cors());
app.use(express.json());
app.use(express.static(__dirname));

let db;

function hashPassword(pw) { return crypto.createHash("sha256").update(pw).digest("hex"); }
function genCode() { return String(Math.floor(100000 + Math.random() * 900000)); }
function genId() { return crypto.randomUUID().slice(0, 8); }

function t(query, params) {
  const stmt = db.prepare(query);
  if (params) stmt.bind(params);
  const results = [];
  while (stmt.step()) results.push(stmt.getAsObject());
  stmt.free();
  return results;
}

function tOne(query, params) {
  const r = t(query, params);
  return r.length ? r[0] : null;
}

function tRun(query, params) {
  db.run(query, params || []);
  saveDB();
}

function getUserByEmail(email) { return tOne("SELECT * FROM users WHERE email = ?", [email]); }
function getUserById(id) { return tOne("SELECT id, name, email, auth_provider, verified, username, photo, photo_public, onboarded FROM users WHERE id = ?", [id]); }
function photoUrl(p) { return p ? (p.startsWith("http") ? p : "/uploads/" + p) : null; }

async function initDB() {
  const SQL = await initSqlJs();
  if (fs.existsSync(DB_PATH)) db = new SQL.Database(fs.readFileSync(DB_PATH));
  else db = new SQL.Database();

  db.run("CREATE TABLE IF NOT EXISTS users (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, email TEXT UNIQUE NOT NULL, password TEXT, auth_provider TEXT DEFAULT 'direct', verified INTEGER DEFAULT 0, username TEXT UNIQUE, photo TEXT, photo_public INTEGER DEFAULT 1, onboarded INTEGER DEFAULT 0, created_at TEXT DEFAULT (datetime('now')))");
  db.run("CREATE TABLE IF NOT EXISTS verification_codes (id INTEGER PRIMARY KEY AUTOINCREMENT, email TEXT NOT NULL, code TEXT NOT NULL, created_at TEXT DEFAULT (datetime('now')))");
  db.run("CREATE TABLE IF NOT EXISTS interests (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT UNIQUE NOT NULL, icon TEXT)");
  db.run("CREATE TABLE IF NOT EXISTS user_interests (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL, interest_id INTEGER NOT NULL, FOREIGN KEY(user_id) REFERENCES users(id), FOREIGN KEY(interest_id) REFERENCES interests(id))");
  db.run("CREATE TABLE IF NOT EXISTS friend_requests (id INTEGER PRIMARY KEY AUTOINCREMENT, from_user INTEGER NOT NULL, to_user INTEGER NOT NULL, status TEXT DEFAULT 'pending', created_at TEXT DEFAULT (datetime('now')))");
  db.run("CREATE TABLE IF NOT EXISTS friendships (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL, friend_id INTEGER NOT NULL, created_at TEXT DEFAULT (datetime('now')))");
  db.run("CREATE TABLE IF NOT EXISTS messages (id INTEGER PRIMARY KEY AUTOINCREMENT, sender_id INTEGER NOT NULL, receiver_id INTEGER NOT NULL, message TEXT NOT NULL, created_at TEXT DEFAULT (datetime('now')))");

  const existing = tOne("SELECT COUNT(*) as c FROM interests");
  if (existing.c === 0) {
    const all = [
      ["🎵", "Music"], ["🎮", "Gaming"], ["📸", "Photography"], ["💻", "Technology"],
      ["✈️", "Travel"], ["🏀", "Sports"], ["🎨", "Art"], ["🍳", "Cooking"],
      ["📚", "Reading"], ["🎬", "Movies"], ["🧘", "Fitness"], ["💃", "Dancing"],
      ["🐱", "Pets"], ["🌿", "Nature"], ["🚗", "Cars"], ["🛒", "Shopping"],
      ["🎧", "Podcasts"], ["♟️", "Chess"], ["🏕️", "Camping"], ["🎭", "Theater"]
    ];
    all.forEach(([icon, name]) => db.run("INSERT INTO interests (name, icon) VALUES (?, ?)", [name, icon]));
  }

  saveDB();
}

function saveDB() { fs.writeFileSync(DB_PATH, Buffer.from(db.export())); }

// ─────────────── VERIFICATION ───────────────
app.post("/api/signup", async (req, res) => {
  const { name, email, password } = req.body;
  if (!name || !email || !password) return res.status(400).json({ error: "All fields required" });
  if (getUserByEmail(email)) return res.status(409).json({ error: "Email already registered" });
  tRun("INSERT INTO users (name, email, password, auth_provider, verified) VALUES (?, ?, ?, 'direct', 0)", [name, email, hashPassword(password)]);
  const code = genCode();
  tRun("DELETE FROM verification_codes WHERE email = ?", [email]);
  tRun("INSERT INTO verification_codes (email, code) VALUES (?, ?)", [email, code]);
  let emailFailed = false;
  try { await transporter.sendMail({ from: FROM_EMAIL, to: email, subject: "Your Snafix Verification Code", html: "<div style='background:#0b1220;padding:40px;font-family:Arial'><div style='max-width:480px;margin:0 auto;background:rgba(255,255,255,.08);border-radius:24px;padding:32px;text-align:center'><h1 style='font-size:28px;background:linear-gradient(90deg,#60a5fa,#fff);-webkit-background-clip:text;-webkit-text-fill-color:transparent'>Snafix</h1><p style='color:#cbd5e1'>Your confirmation code</p><div style='font-size:42px;font-weight:800;letter-spacing:12px;color:#60a5fa;margin:20px 0;padding:16px;background:rgba(96,165,250,.1);border-radius:16px'>" + code + "</div><p style='color:#94a3b8;font-size:13px'>Enter this code to confirm your account.</p></div></div>" }); } catch (e) { emailFailed = true; console.log("Code for " + email + ": " + code); }
  res.json({ message: "Account created. Please verify your email.", email, needsVerification: true, code: emailFailed ? code : undefined });
});

app.post("/api/verify", (req, res) => {
  const { email, code } = req.body;
  if (!email || !code) return res.status(400).json({ error: "Email and code required" });
  const saved = tOne("SELECT code FROM verification_codes WHERE email = ?", [email]);
  if (!saved) return res.status(400).json({ error: "No verification code found" });
  if (saved.code !== code) return res.status(400).json({ error: "Wrong code" });
  tRun("UPDATE users SET verified = 1 WHERE email = ?", [email]);
  tRun("DELETE FROM verification_codes WHERE email = ?", [email]);
  const user = getUserByEmail(email);
  res.json({ message: "Email verified", verified: true, name: user.name, email: user.email });
});

app.post("/api/resend-code", async (req, res) => {
  const { email } = req.body;
  if (!email) return res.status(400).json({ error: "Email required" });
  const user = getUserByEmail(email);
  if (!user) return res.status(404).json({ error: "Account not found" });
  if (user.verified) return res.status(400).json({ error: "Already verified" });
  const code = genCode();
  tRun("DELETE FROM verification_codes WHERE email = ?", [email]);
  tRun("INSERT INTO verification_codes (email, code) VALUES (?, ?)", [email, code]);
  let emailFailed = false;
  try { await transporter.sendMail({ from: FROM_EMAIL, to: email, subject: "Your Snafix Code", html: "<p>Code: " + code + "</p>" }); } catch (e) { emailFailed = true; console.log("Code for " + email + ": " + code); }
  res.json({ message: "Code resent", code: emailFailed ? code : undefined });
});

// ─────────────── LOGIN ───────────────
app.post("/api/login", (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) return res.status(400).json({ error: "Email and password required" });
  const user = getUserByEmail(email);
  if (!user) return res.status(401).json({ error: "Account not found" });
  if (user.auth_provider === 'google' && !user.password) return res.status(401).json({ error: "This account uses Google login." });
  if (user.password !== hashPassword(password)) return res.status(401).json({ error: "Wrong password" });
  res.json({ id: user.id, name: user.name, email: user.email, auth_provider: user.auth_provider, onboarded: user.onboarded, verified: user.verified });
});

app.get("/api/google-config", (req, res) => {
  res.json({ clientId: process.env.GOOGLE_CLIENT_ID || null });
});

app.post("/api/google-login", async (req, res) => {
  const { credential, email, name } = req.body;
  let verifiedEmail = email;
  let displayName = name;

  if (credential) {
    try {
      const r = await fetch("https://oauth2.googleapis.com/tokeninfo?id_token=" + credential);
      if (r.ok) {
        const payload = await r.json();
        verifiedEmail = payload.email;
        displayName = payload.name || payload.email.split("@")[0];
      }
    } catch (e) { /* fallback to email param */ }
  }

  if (!verifiedEmail) return res.status(400).json({ error: "Email required" });
  let user = getUserByEmail(verifiedEmail);
  if (user) return res.json({ id: user.id, name: user.name, email: user.email, auth_provider: user.auth_provider, onboarded: user.onboarded, verified: user.verified });
  const finalName = displayName || verifiedEmail.split("@")[0];
  tRun("INSERT INTO users (name, email, password, auth_provider, verified) VALUES (?, ?, NULL, 'google', 1)", [finalName, verifiedEmail]);
  user = getUserByEmail(verifiedEmail);
  res.json({ id: user.id, name: user.name, email: user.email, auth_provider: user.auth_provider, onboarded: user.onboarded, verified: user.verified });
});

// ─────────────── INTERESTS ───────────────
app.get("/api/interests", (req, res) => {
  const all = t("SELECT * FROM interests");
  const shuffled = all.sort(() => Math.random() - 0.5).slice(0, 10);
  res.json(shuffled);
});

app.post("/api/save-interests", (req, res) => {
  const { email, interestIds } = req.body;
  if (!email || !interestIds || interestIds.length !== 3) return res.status(400).json({ error: "Select exactly 3 interests" });
  const user = getUserByEmail(email);
  if (!user) return res.status(404).json({ error: "User not found" });
  tRun("DELETE FROM user_interests WHERE user_id = ?", [user.id]);
  interestIds.forEach(id => tRun("INSERT INTO user_interests (user_id, interest_id) VALUES (?, ?)", [user.id, id]));
  res.json({ message: "Interests saved" });
});

// ─────────────── USER INFO (for friends page) ───────────────
app.get("/api/check-onboarding", (req, res) => {
  const { email } = req.query;
  if (!email) return res.status(400).json({ error: "Email required" });
  const user = getUserByEmail(email);
  if (!user) return res.status(404).json({ error: "User not found" });
  res.json({ onboarded: user.onboarded, username: user.username, photo: user.photo });
});

// ─────────────── SUGGESTED FRIENDS ───────────────
app.get("/api/suggested-friends", (req, res) => {
  const { email } = req.query;
  if (!email) return res.status(400).json({ error: "Email required" });
  const user = getUserByEmail(email);
  if (!user) return res.status(404).json({ error: "User not found" });

  const friendIds = t("SELECT friend_id FROM friendships WHERE user_id = ? UNION SELECT user_id FROM friendships WHERE friend_id = ?", [user.id, user.id]).map(r => r.friend_id);
  const pendingTo = t("SELECT to_user FROM friend_requests WHERE from_user = ?", [user.id]).map(r => r.to_user);
  const pendingFrom = t("SELECT from_user FROM friend_requests WHERE to_user = ? AND status = 'pending'", [user.id]).map(r => r.from_user);
  const exclude = [user.id, ...friendIds, ...pendingTo, ...pendingFrom];

  const placeholders = exclude.map(() => "?").join(",");
  const suggestions = t("SELECT id, name, email, username, photo FROM users WHERE id NOT IN (" + placeholders + ") ORDER BY RANDOM() LIMIT 20", exclude);

  const result = suggestions.map(s => ({
    id: s.id, name: s.name, email: s.email,
    username: s.username || null,
    photo: photoUrl(s.photo)
  }));

  res.json(result);
});

app.post("/api/send-friend-request", (req, res) => {
  const { email, toUserId } = req.body;
  if (!email || !toUserId) return res.status(400).json({ error: "Required" });
  const user = getUserByEmail(email);
  if (!user) return res.status(404).json({ error: "User not found" });
  if (user.id === toUserId) return res.status(400).json({ error: "Cannot add yourself" });
  const exists = tOne("SELECT id FROM friend_requests WHERE from_user = ? AND to_user = ?", [user.id, toUserId]);
  if (exists) return res.status(400).json({ error: "Request already sent" });
  const alreadyFriends = tOne("SELECT id FROM friendships WHERE (user_id = ? AND friend_id = ?) OR (user_id = ? AND friend_id = ?)", [user.id, toUserId, toUserId, user.id]);
  if (alreadyFriends) return res.status(400).json({ error: "Already friends" });
  tRun("INSERT INTO friend_requests (from_user, to_user) VALUES (?, ?)", [user.id, toUserId]);
  res.json({ message: "Friend request sent" });
});

app.post("/api/accept-friend-request", (req, res) => {
  const { email, fromUserId } = req.body;
  if (!email || !fromUserId) return res.status(400).json({ error: "Required" });
  const user = getUserByEmail(email);
  if (!user) return res.status(404).json({ error: "User not found" });
  const reqRow = tOne("SELECT id FROM friend_requests WHERE from_user = ? AND to_user = ? AND status = 'pending'", [fromUserId, user.id]);
  if (!reqRow) return res.status(404).json({ error: "Request not found" });
  tRun("DELETE FROM friend_requests WHERE id = ?", [reqRow.id]);
  tRun("INSERT INTO friendships (user_id, friend_id) VALUES (?, ?)", [user.id, fromUserId]);
  tRun("INSERT INTO friendships (user_id, friend_id) VALUES (?, ?)", [fromUserId, user.id]);
  res.json({ message: "Friend request accepted" });
});

app.post("/api/reject-friend-request", (req, res) => {
  const { email, fromUserId } = req.body;
  if (!email || !fromUserId) return res.status(400).json({ error: "Required" });
  const user = getUserByEmail(email);
  if (!user) return res.status(404).json({ error: "User not found" });
  tRun("DELETE FROM friend_requests WHERE from_user = ? AND to_user = ?", [fromUserId, user.id]);
  res.json({ message: "Friend request rejected" });
});

app.get("/api/get-friend-requests", (req, res) => {
  const { email } = req.query;
  if (!email) return res.status(400).json({ error: "Email required" });
  const user = getUserByEmail(email);
  if (!user) return res.status(404).json({ error: "User not found" });
  const requests = t("SELECT fr.id as req_id, u.id, u.name, u.email, u.username, u.photo FROM friend_requests fr JOIN users u ON u.id = fr.from_user WHERE fr.to_user = ? AND fr.status = 'pending'", [user.id]);
  res.json(requests.map(r => ({ id: r.id, reqId: r.req_id, name: r.name, email: r.email, username: r.username, photo: photoUrl(r.photo) })));
});

app.get("/api/get-friends", (req, res) => {
  const { email } = req.query;
  if (!email) return res.status(400).json({ error: "Email required" });
  const user = getUserByEmail(email);
  if (!user) return res.status(404).json({ error: "User not found" });
  const friends = t("SELECT u.id, u.name, u.email, u.username, u.photo FROM friendships f JOIN users u ON (u.id = f.friend_id) WHERE f.user_id = ?", [user.id]);
  res.json(friends.map(f => ({ id: f.id, name: f.name, email: f.email, username: f.username, photo: photoUrl(f.photo) })));
});

app.get("/api/search-users", (req, res) => {
  const { email, q } = req.query;
  if (!email || !q) return res.status(400).json({ error: "Required" });
  const user = getUserByEmail(email);
  if (!user) return res.status(404).json({ error: "User not found" });
  const results = t("SELECT id, name, email, username, photo FROM users WHERE (name LIKE ? OR email LIKE ?) AND id != ? LIMIT 20", ["%" + q + "%", "%" + q + "%", user.id]);
  res.json(results.map(r => ({ id: r.id, name: r.name, email: r.email, username: r.username, photo: photoUrl(r.photo) })));
});

app.get("/api/get-messages", (req, res) => {
  const { email, otherUserId } = req.query;
  if (!email || !otherUserId) return res.status(400).json({ error: "Required" });
  const user = getUserByEmail(email);
  if (!user) return res.status(404).json({ error: "User not found" });
  const messages = t("SELECT * FROM messages WHERE (sender_id = ? AND receiver_id = ?) OR (sender_id = ? AND receiver_id = ?) ORDER BY created_at ASC", [user.id, otherUserId, otherUserId, user.id]);
  res.json(messages);
});

// ─────────────── USERNAME ───────────────
app.post("/api/check-username", (req, res) => {
  const { email, username } = req.body;
  if (!email || !username) return res.status(400).json({ error: "Required" });
  if (!/^[a-zA-Z0-9_]{3,20}$/.test(username)) return res.status(400).json({ error: "Username must be 3-20 chars, letters/numbers/underscore only" });
  const taken = tOne("SELECT id FROM users WHERE username = ? AND email != ?", [username, email]);
  if (taken) return res.json({ available: false, message: "Username taken" });
  res.json({ available: true });
});

app.post("/api/save-username", (req, res) => {
  const { email, username } = req.body;
  if (!email || !username) return res.status(400).json({ error: "Required" });
  const taken = tOne("SELECT id FROM users WHERE username = ? AND email != ?", [username, email]);
  if (taken) return res.status(409).json({ error: "Username taken" });
  tRun("UPDATE users SET username = ? WHERE email = ?", [username, email]);
  res.json({ message: "Username saved", username });
});

// ─────────────── PROFILE PHOTO ───────────────
app.post("/api/upload-photo", upload.single("photo"), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: "No file uploaded" });
  const email = req.body.email;
  if (!email) return res.status(400).json({ error: "Email required" });
  try {
    const result = await cloudinary.uploader.upload(req.file.path, { folder: "snafix", width: 400, height: 400, crop: "fill" });
    tRun("UPDATE users SET photo = ? WHERE email = ?", [result.secure_url, email]);
    fs.unlink(req.file.path, () => {}); // delete temp file
    res.json({ message: "Photo saved", filename: result.public_id, url: result.secure_url });
  } catch (e) {
    res.status(500).json({ error: "Upload failed" });
  }
});

app.post("/api/save-profile-settings", (req, res) => {
  const { email, photoPublic } = req.body;
  if (!email) return res.status(400).json({ error: "Email required" });
  tRun("UPDATE users SET photo_public = ?, onboarded = 1 WHERE email = ?", [photoPublic ? 1 : 0, email]);
  const user = getUserByEmail(email);
  res.json({ message: "Profile saved", onboarded: 1, username: user.username });
});

app.post("/api/skip-onboarding", (req, res) => {
  const { email } = req.body;
  if (!email) return res.status(400).json({ error: "Email required" });
  tRun("UPDATE users SET onboarded = 1 WHERE email = ?", [email]);
  res.json({ message: "Onboarding skipped", onboarded: 1 });
});

app.post("/api/send-verify-code", async (req, res) => {
  const { email } = req.body;
  if (!email) return res.status(400).json({ error: "Email required" });
  const user = getUserByEmail(email);
  if (!user) return res.status(404).json({ error: "User not found" });
  if (user.verified) return res.status(400).json({ error: "Already verified" });
  const code = genCode();
  tRun("DELETE FROM verification_codes WHERE email = ?", [email]);
  tRun("INSERT INTO verification_codes (email, code) VALUES (?, ?)", [email, code]);
  let emailFailed = false;
  try { await transporter.sendMail({ from: FROM_EMAIL, to: email, subject: "Your Snafix Code", html: "<p>Code: " + code + "</p>" }); } catch (e) { emailFailed = true; console.log("Code for " + email + ": " + code); }
  res.json({ message: "Code sent", code: emailFailed ? code : undefined });
});

// ─────────────── GET USER PROFILE ───────────────
app.get("/api/user", (req, res) => {
  const { email } = req.query;
  if (!email) return res.status(400).json({ error: "Email required" });
  const user = getUserByEmail(email);
  if (!user) return res.status(404).json({ error: "User not found" });
  res.json({
    id: user.id, name: user.name, email: user.email, username: user.username,
    photo: photoUrl(user.photo),
    photo_public: user.photo_public, onboarded: user.onboarded, auth_provider: user.auth_provider,
    verified: user.verified
  });
});

// ─────────────── SOCKET.IO CHAT ───────────────
const onlineUsers = new Map();

io.on("connection", (socket) => {
  socket.on("user-online", (userId) => {
    onlineUsers.set(userId, socket.id);
    io.emit("online-status", { userId, online: true });
  });

  socket.on("send-message", ({ senderId, receiverId, message }) => {
    if (!senderId || !receiverId || !message) return;
    tRun("INSERT INTO messages (sender_id, receiver_id, message) VALUES (?, ?, ?)", [senderId, receiverId, message]);
    const msgData = { senderId, receiverId, message, created_at: new Date().toISOString() };
    const receiverSocket = onlineUsers.get(receiverId);
    if (receiverSocket) io.to(receiverSocket).emit("new-message", msgData);
    socket.emit("new-message", msgData);
  });

  socket.on("get-messages", ({ userId, otherUserId }) => {
    if (!userId || !otherUserId) return;
    const messages = t("SELECT * FROM messages WHERE (sender_id = ? AND receiver_id = ?) OR (sender_id = ? AND receiver_id = ?) ORDER BY created_at ASC", [userId, otherUserId, otherUserId, userId]);
    socket.emit("messages-list", messages);
  });

  socket.on("disconnect", () => {
    for (const [userId, socketId] of onlineUsers) {
      if (socketId === socket.id) {
        onlineUsers.delete(userId);
        io.emit("online-status", { userId, online: false });
        break;
      }
    }
  });
});

initDB().then(() => {
  server.listen(PORT, () => {
    console.log("Snafix server running on http://localhost:" + PORT);
    if (!process.env.SNAFIC_EMAIL_PASS) console.log("Set SNAFIC_EMAIL_PASS env var to enable email sending.");
  });
});
