const express = require('express');
const session = require('express-session');
const bcrypt = require('bcryptjs');
const http = require('http');
const crypto = require('crypto');
const path = require('path');
const { Server } = require('socket.io');
const db = require('./db');

const PORT = process.env.PORT || 3000;
const IS_PRODUCTION = process.env.NODE_ENV === 'production';

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.json({ limit: '6mb' }));

// needed so secure cookies work correctly behind Render/Railway/etc's HTTPS proxy
if (IS_PRODUCTION) app.set('trust proxy', 1);

const sessionMiddleware = session({
  secret: process.env.SESSION_SECRET || 'staytion-local-dev-secret-change-me-if-you-ever-deploy-this',
  resave: false,
  saveUninitialized: false,
  cookie: {
    maxAge: 1000 * 60 * 60 * 24 * 30,
    secure: IS_PRODUCTION,
    sameSite: 'lax',
  },
});
app.use(sessionMiddleware);

app.use(express.static(path.join(__dirname, 'public')));

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

function currentUser(req) {
  return db.data.users.find((u) => u.id === req.session.userId);
}

function requireAuth(req, res, next) {
  const u = currentUser(req);
  if (!u) return res.status(401).json({ error: 'not logged in' });
  next();
}

function requireMod(req, res, next) {
  const u = currentUser(req);
  if (!u || (u.role !== 'owner' && u.role !== 'moderator')) {
    return res.status(403).json({ error: 'moderator access required' });
  }
  next();
}

function publicUser(u) {
  if (!u) return null;
  return {
    username: u.username,
    displayName: u.displayName,
    bio: u.bio || '',
    role: u.role,
    verified: !!u.verified,
    createdAt: u.createdAt,
    avatarUrl: u.avatarUrl || null,
    bannerUrl: u.bannerUrl || null,
    followers: db.data.follows.filter((f) => f.followeeId === u.id).length,
    following: db.data.follows.filter((f) => f.followerId === u.id).length,
    posts: db.data.posts.filter((p) => p.userId === u.id).length,
  };
}

function addNotification(userId, type, actorId, text) {
  if (userId === actorId) return; // don't notify yourself
  db.data.notifications.push({
    id: crypto.randomUUID(),
    userId,
    type,
    actorId,
    text,
    read: false,
    createdAt: Date.now(),
  });
}

function findUserByUsername(username) {
  return db.data.users.find((u) => u.username === String(username || '').toLowerCase());
}

// ---------------------------------------------------------------------------
// auth
// ---------------------------------------------------------------------------

app.post('/api/signup', (req, res) => {
  let { username, displayName, password } = req.body || {};
  if (!username || !password) {
    return res.status(400).json({ error: 'username and password are required' });
  }
  username = String(username).toLowerCase();
  if (!/^[a-z0-9_]{2,}$/.test(username)) {
    return res.status(400).json({
      error: 'username must be lowercase, 2+ characters, and only letters/numbers/underscores',
    });
  }
  if (findUserByUsername(username)) {
    return res.status(400).json({ error: 'that username is already taken' });
  }
  if (String(password).length < 4) {
    return res.status(400).json({ error: 'password must be at least 4 characters' });
  }

  const isFirstUser = db.data.users.length === 0;
  const user = {
    id: crypto.randomUUID(),
    username,
    displayName: (displayName && String(displayName).trim()) || username,
    passwordHash: bcrypt.hashSync(String(password), 10),
    role: isFirstUser ? 'owner' : 'user', // first account to ever sign up runs the platform
    verified: isFirstUser,
    bio: '',
    createdAt: Date.now(),
  };
  db.data.users.push(user);
  db.save();
  req.session.userId = user.id;
  res.json({ user: publicUser(user) });
});

app.post('/api/login', (req, res) => {
  const { username, password } = req.body || {};
  const u = findUserByUsername(username);
  if (!u || !bcrypt.compareSync(String(password || ''), u.passwordHash)) {
    return res.status(401).json({ error: 'incorrect username or password' });
  }
  req.session.userId = u.id;
  res.json({ user: publicUser(u) });
});

app.post('/api/logout', (req, res) => {
  req.session.destroy(() => res.json({ ok: true }));
});

app.get('/api/me', (req, res) => {
  const u = currentUser(req);
  if (!u) return res.status(401).json({ error: 'not logged in' });
  res.json({ user: publicUser(u) });
});

// ---------------------------------------------------------------------------
// users / follow / verification / roles
// ---------------------------------------------------------------------------

app.get('/api/users/search', requireAuth, (req, res) => {
  const q = String(req.query.q || '').toLowerCase().trim();
  const results = db.data.users
    .filter((u) => !q || u.username.includes(q) || (u.displayName || '').toLowerCase().includes(q))
    .slice(0, 30)
    .map(publicUser);
  res.json({ users: results });
});

app.get('/api/users/:username', requireAuth, (req, res) => {
  const u = findUserByUsername(req.params.username);
  if (!u) return res.status(404).json({ error: 'user not found' });
  const me = currentUser(req);
  const isFollowing = db.data.follows.some((f) => f.followerId === me.id && f.followeeId === u.id);
  res.json({ user: { ...publicUser(u), isFollowing, isMe: u.id === me.id } });
});

const MAX_IMAGE_DATA_URL_LENGTH = 3.5 * 1024 * 1024; // ~3.5MB of base64 text, plenty for a compressed jpeg

app.patch('/api/me', requireAuth, (req, res) => {
  const me = currentUser(req);
  const { displayName, bio, avatarUrl, bannerUrl } = req.body || {};
  if (typeof displayName === 'string') me.displayName = displayName.trim() || me.username;
  if (typeof bio === 'string') me.bio = bio.slice(0, 280);

  if (typeof avatarUrl === 'string') {
    if (avatarUrl && !avatarUrl.startsWith('data:image/')) {
      return res.status(400).json({ error: 'avatar must be an image' });
    }
    if (avatarUrl.length > MAX_IMAGE_DATA_URL_LENGTH) {
      return res.status(400).json({ error: 'that image is too large, try a smaller one' });
    }
    me.avatarUrl = avatarUrl || null;
  }
  if (typeof bannerUrl === 'string') {
    if (bannerUrl && !bannerUrl.startsWith('data:image/')) {
      return res.status(400).json({ error: 'banner must be an image' });
    }
    if (bannerUrl.length > MAX_IMAGE_DATA_URL_LENGTH) {
      return res.status(400).json({ error: 'that image is too large, try a smaller one' });
    }
    me.bannerUrl = bannerUrl || null;
  }

  db.save();
  res.json({ user: publicUser(me) });
});

app.post('/api/users/:username/follow', requireAuth, (req, res) => {
  const me = currentUser(req);
  const target = findUserByUsername(req.params.username);
  if (!target) return res.status(404).json({ error: 'user not found' });
  if (target.id === me.id) return res.status(400).json({ error: 'cannot follow yourself' });

  const existing = db.data.follows.find((f) => f.followerId === me.id && f.followeeId === target.id);
  if (existing) {
    db.data.follows = db.data.follows.filter((f) => f !== existing);
  } else {
    db.data.follows.push({ followerId: me.id, followeeId: target.id, createdAt: Date.now() });
    addNotification(target.id, 'follow', me.id, `<b>${me.displayName}</b> started following you`);
  }
  db.save();
  res.json({ isFollowing: !existing });
});

app.patch('/api/users/:username/verify', requireAuth, requireMod, (req, res) => {
  const target = findUserByUsername(req.params.username);
  if (!target) return res.status(404).json({ error: 'user not found' });
  target.verified = true;
  addNotification(target.id, 'verify', currentUser(req).id, 'You were granted a verified badge');
  db.save();
  res.json({ user: publicUser(target) });
});

app.patch('/api/users/:username/role', requireAuth, (req, res) => {
  const me = currentUser(req);
  if (me.role !== 'owner') return res.status(403).json({ error: 'owner access required' });
  const target = findUserByUsername(req.params.username);
  if (!target) return res.status(404).json({ error: 'user not found' });
  const { role } = req.body || {};
  if (!['user', 'moderator'].includes(role)) return res.status(400).json({ error: 'invalid role' });
  if (target.role === 'owner') return res.status(400).json({ error: "can't change the owner's role" });
  target.role = role;
  db.save();
  res.json({ user: publicUser(target) });
});

// ---------------------------------------------------------------------------
// posts / likes / trending
// ---------------------------------------------------------------------------

app.get('/api/posts', requireAuth, (req, res) => {
  const me = currentUser(req);
  const posts = [...db.data.posts]
    .sort((a, b) => b.createdAt - a.createdAt)
    .map((p) => {
      const author = db.data.users.find((u) => u.id === p.userId);
      const likeCount = db.data.likes.filter((l) => l.postId === p.id).length;
      const likedByMe = db.data.likes.some((l) => l.postId === p.id && l.userId === me.id);
      return {
        id: p.id,
        text: p.text,
        createdAt: p.createdAt,
        author: author
          ? { username: author.username, displayName: author.displayName, verified: !!author.verified, avatarUrl: author.avatarUrl || null }
          : { username: 'deleted', displayName: 'deleted user', verified: false, avatarUrl: null },
        likeCount,
        likedByMe,
      };
    });
  res.json({ posts });
});

app.post('/api/posts', requireAuth, (req, res) => {
  const me = currentUser(req);
  const text = String((req.body || {}).text || '').trim();
  if (!text) return res.status(400).json({ error: 'post text is required' });
  const post = { id: crypto.randomUUID(), userId: me.id, text, createdAt: Date.now() };
  db.data.posts.push(post);
  db.save();
  res.json({
    post: {
      id: post.id,
      text: post.text,
      createdAt: post.createdAt,
      author: { username: me.username, displayName: me.displayName, verified: !!me.verified, avatarUrl: me.avatarUrl || null },
      likeCount: 0,
      likedByMe: false,
    },
  });
});

app.post('/api/posts/:id/like', requireAuth, (req, res) => {
  const me = currentUser(req);
  const post = db.data.posts.find((p) => p.id === req.params.id);
  if (!post) return res.status(404).json({ error: 'post not found' });
  const existing = db.data.likes.find((l) => l.postId === post.id && l.userId === me.id);
  if (existing) {
    db.data.likes = db.data.likes.filter((l) => l !== existing);
  } else {
    db.data.likes.push({ postId: post.id, userId: me.id, createdAt: Date.now() });
    addNotification(post.userId, 'like', me.id, `<b>${me.displayName}</b> liked your post`);
  }
  db.save();
  const likeCount = db.data.likes.filter((l) => l.postId === post.id).length;
  res.json({ likeCount, likedByMe: !existing });
});

app.get('/api/trending', requireAuth, (req, res) => {
  const counts = {};
  for (const p of db.data.posts) {
    const tags = p.text.match(/#[a-z0-9_]+/gi) || [];
    for (const raw of tags) {
      const tag = raw.toLowerCase();
      counts[tag] = (counts[tag] || 0) + 1;
    }
  }
  const trending = Object.entries(counts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8)
    .map(([tag, count]) => ({ tag, count }));
  res.json({ trending });
});

// ---------------------------------------------------------------------------
// news
// ---------------------------------------------------------------------------

app.get('/api/news', requireAuth, (req, res) => {
  const news = [...db.data.news].sort((a, b) => (b.pinned === a.pinned ? b.createdAt - a.createdAt : b.pinned ? 1 : -1));
  res.json({ news });
});

app.post('/api/news', requireAuth, requireMod, (req, res) => {
  const { title, body } = req.body || {};
  const t = String(title || '').trim();
  const b = String(body || '').trim();
  if (!t && !b) return res.status(400).json({ error: 'title or body required' });
  const item = {
    id: crypto.randomUUID(),
    title: t || 'update from the team',
    body: b,
    pinned: false,
    createdAt: Date.now(),
  };
  db.data.news.push(item);
  db.save();
  res.json({ item });
});

// ---------------------------------------------------------------------------
// notifications
// ---------------------------------------------------------------------------

app.get('/api/notifications', requireAuth, (req, res) => {
  const me = currentUser(req);
  const notifs = db.data.notifications
    .filter((n) => n.userId === me.id)
    .sort((a, b) => b.createdAt - a.createdAt);
  res.json({ notifications: notifs });
});

app.post('/api/notifications/read', requireAuth, (req, res) => {
  const me = currentUser(req);
  db.data.notifications.forEach((n) => {
    if (n.userId === me.id) n.read = true;
  });
  db.save();
  res.json({ ok: true });
});

// ---------------------------------------------------------------------------
// conversations / messages (real-time via socket.io)
// ---------------------------------------------------------------------------

app.get('/api/conversations', requireAuth, (req, res) => {
  const me = currentUser(req);
  const myConvs = db.data.conversations.filter((c) => c.memberIds.includes(me.id));
  const result = myConvs
    .map((c) => {
      const otherId = c.memberIds.find((id) => id !== me.id);
      const other = db.data.users.find((u) => u.id === otherId);
      const msgs = db.data.messages
        .filter((m) => m.conversationId === c.id)
        .sort((a, b) => a.createdAt - b.createdAt);
      const last = msgs[msgs.length - 1];
      const unread = msgs.filter((m) => m.senderId !== me.id && !m.readBy.includes(me.id)).length;
      return {
        id: c.id,
        other: other
          ? { username: other.username, displayName: other.displayName, verified: !!other.verified, avatarUrl: other.avatarUrl || null }
          : { username: 'unknown', displayName: 'unknown user', verified: false, avatarUrl: null },
        lastMessage: last ? { text: last.text, createdAt: last.createdAt, mine: last.senderId === me.id } : null,
        unread,
      };
    })
    .sort((a, b) => (b.lastMessage ? b.lastMessage.createdAt : 0) - (a.lastMessage ? a.lastMessage.createdAt : 0));
  res.json({ conversations: result });
});

app.post('/api/conversations', requireAuth, (req, res) => {
  const me = currentUser(req);
  const target = findUserByUsername((req.body || {}).username);
  if (!target) return res.status(404).json({ error: 'user not found' });
  if (target.id === me.id) return res.status(400).json({ error: 'cannot message yourself' });

  let conv = db.data.conversations.find(
    (c) => c.memberIds.length === 2 && c.memberIds.includes(me.id) && c.memberIds.includes(target.id)
  );
  if (!conv) {
    conv = { id: crypto.randomUUID(), memberIds: [me.id, target.id], createdAt: Date.now() };
    db.data.conversations.push(conv);
    db.save();
  }
  res.json({ conversationId: conv.id });
});

app.get('/api/conversations/:id/messages', requireAuth, (req, res) => {
  const me = currentUser(req);
  const conv = db.data.conversations.find((c) => c.id === req.params.id);
  if (!conv || !conv.memberIds.includes(me.id)) return res.status(404).json({ error: 'conversation not found' });

  const msgs = db.data.messages.filter((m) => m.conversationId === conv.id).sort((a, b) => a.createdAt - b.createdAt);
  msgs.forEach((m) => {
    if (m.senderId !== me.id && !m.readBy.includes(me.id)) m.readBy.push(me.id);
  });
  db.save();

  res.json({
    messages: msgs.map((m) => {
      const sender = db.data.users.find((u) => u.id === m.senderId);
      return {
        id: m.id,
        text: m.text,
        createdAt: m.createdAt,
        mine: m.senderId === me.id,
        senderUsername: sender ? sender.username : 'unknown',
      };
    }),
  });
});

app.post('/api/conversations/:id/messages', requireAuth, (req, res) => {
  const me = currentUser(req);
  const conv = db.data.conversations.find((c) => c.id === req.params.id);
  if (!conv || !conv.memberIds.includes(me.id)) return res.status(404).json({ error: 'conversation not found' });

  const text = String((req.body || {}).text || '').trim();
  if (!text) return res.status(400).json({ error: 'message text is required' });

  const msg = {
    id: crypto.randomUUID(),
    conversationId: conv.id,
    senderId: me.id,
    text,
    createdAt: Date.now(),
    readBy: [me.id],
  };
  db.data.messages.push(msg);
  db.save();

  io.to('conv:' + conv.id).emit('message', {
    id: msg.id,
    conversationId: conv.id,
    text: msg.text,
    createdAt: msg.createdAt,
    senderUsername: me.username,
  });

  res.json({ message: { id: msg.id, text: msg.text, createdAt: msg.createdAt, mine: true, senderUsername: me.username } });
});

// ---------------------------------------------------------------------------
// socket.io - just relays messages into conversation "rooms".
// clients only ever learn a conversationId through an authenticated REST call
// above, so this is fine for local/personal use but isn't hardened auth.
// ---------------------------------------------------------------------------

io.on('connection', (socket) => {
  socket.on('join', (conversationId) => {
    if (typeof conversationId === 'string') socket.join('conv:' + conversationId);
  });
});

db.init()
  .then(() => {
    server.listen(PORT, () => {
      console.log(`\nSTAYtion is running: http://localhost:${PORT}\n`);
    });
  })
  .catch((e) => {
    console.error('Failed to start STAYtion - could not initialize storage:', e);
    process.exit(1);
  });
