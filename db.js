// Storage for STAYtion.
//
// Two modes, picked automatically:
//  - No MONGODB_URI set  -> stores everything in data/db.json on local disk.
//    Great for running on your own computer. Free hosts often wipe local
//    disk on every restart, so this mode is NOT reliable for a live deploy.
//  - MONGODB_URI set     -> stores everything in a MongoDB Atlas database
//    instead (Atlas has a free-forever tier). This survives restarts/redeploys
//    on free hosting, which local files don't.
//
// Either way, the rest of the app just uses db.data.users, db.data.posts,
// etc. exactly the same - the routes in server.js never need to know which
// mode is active.

const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, 'data');
const DATA_FILE = path.join(DATA_DIR, 'db.json');
const MEDIA_DIR = path.join(DATA_DIR, 'media');

const DEFAULT_DATA = {
  users: [],
  posts: [],
  likes: [],
  follows: [],
  conversations: [],
  messages: [],
  notifications: [],
  news: [],
  mediaIndex: [], // small metadata records only: {id, contentType, ownerId, createdAt}. Actual bytes live separately (see below).
};

const data = { ...DEFAULT_DATA };
let mode = 'file';
let mongoCollection = null;
let mongoMediaCollection = null;

async function init() {
  const uri = process.env.MONGODB_URI;

  if (uri) {
    mode = 'mongo';
    const { MongoClient } = require('mongodb');
    const client = new MongoClient(uri);
    await client.connect();
    const dbName = process.env.MONGODB_DB || 'staytion';
    mongoCollection = client.db(dbName).collection('appdata');
    mongoMediaCollection = client.db(dbName).collection('media');

    const doc = await mongoCollection.findOne({ _id: 'staytion-data' });
    if (doc) {
      delete doc._id;
      Object.assign(data, DEFAULT_DATA, doc);
    } else {
      Object.assign(data, DEFAULT_DATA);
      await mongoCollection.insertOne({ _id: 'staytion-data', ...data });
    }
    console.log('STAYtion: connected to MongoDB - your data will persist there across restarts.');
  } else {
    if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
    if (!fs.existsSync(MEDIA_DIR)) fs.mkdirSync(MEDIA_DIR, { recursive: true });
    let loaded = {};
    if (fs.existsSync(DATA_FILE)) {
      try {
        loaded = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
      } catch (e) {
        console.error('Could not read data/db.json, starting fresh.', e);
      }
    }
    Object.assign(data, DEFAULT_DATA, loaded);
    console.log(
      'STAYtion: using local file storage at data/db.json.\n' +
      'Set a MONGODB_URI environment variable to persist to a free MongoDB Atlas database instead (recommended once you deploy this online).'
    );
  }
}

function save() {
  if (mode === 'mongo' && mongoCollection) {
    mongoCollection
      .replaceOne({ _id: 'staytion-data' }, { _id: 'staytion-data', ...data }, { upsert: true })
      .catch((e) => console.error('Could not save to MongoDB:', e.message));
    return;
  }
  fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
}

// ---------------------------------------------------------------------------
// Media storage (post images/videos, avatars, banners).
//
// Kept OUT of the main `data` blob on purpose: MongoDB caps a single document
// at 16MB, and the main blob holds every user/post/message. If photos and
// videos lived inside it too, a handful of uploads could blow past that
// limit and corrupt the whole app's data. Instead each media file is its own
// small record - a separate Mongo document, or a separate file on disk -
// referenced from posts/profiles by a short id instead of embedding the
// actual bytes everywhere.
// ---------------------------------------------------------------------------

async function saveMediaBytes(id, buffer) {
  if (mode === 'mongo' && mongoMediaCollection) {
    await mongoMediaCollection.replaceOne(
      { _id: id },
      { _id: id, bytes: buffer, createdAt: Date.now() },
      { upsert: true }
    );
    return;
  }
  fs.writeFileSync(path.join(MEDIA_DIR, id), buffer);
}

async function getMediaBytes(id) {
  if (mode === 'mongo' && mongoMediaCollection) {
    const doc = await mongoMediaCollection.findOne({ _id: id });
    if (!doc) return null;
    return doc.bytes.buffer ? Buffer.from(doc.bytes.buffer) : Buffer.from(doc.bytes);
  }
  const filePath = path.join(MEDIA_DIR, id);
  if (!fs.existsSync(filePath)) return null;
  return fs.readFileSync(filePath);
}

async function deleteMediaBytes(id) {
  if (mode === 'mongo' && mongoMediaCollection) {
    await mongoMediaCollection.deleteOne({ _id: id }).catch(() => {});
    return;
  }
  const filePath = path.join(MEDIA_DIR, id);
  if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
}

module.exports = { data, init, save, saveMediaBytes, getMediaBytes, deleteMediaBytes };

