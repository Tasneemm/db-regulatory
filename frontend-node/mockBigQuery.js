const fs = require('fs');
const crypto = require('crypto');
const bcrypt = require('bcrypt');
const { v4: uuidv4 } = require('uuid');

let storePath = null;
let key = null; // Buffer
let store = { users: [] };

function init(options = {}) {
  storePath = options.storePath || require('path').join(__dirname, 'mock_bq_store.json');
  const keyEnv = options.key || process.env.ENCRYPTION_KEY;
  if (!keyEnv) {
    // generate a random key for demo (not persisted across restarts)
    console.warn('ENCRYPTION_KEY not provided — generating ephemeral key (demo only)');
    key = crypto.randomBytes(32);
  } else {
    // accept base64 or raw
    try {
      key = Buffer.from(keyEnv, 'base64');
      if (key.length !== 32) throw new Error('invalid key length');
    } catch (err) {
      // fallback to raw
      key = Buffer.from(keyEnv);
    }
  }

  if (fs.existsSync(storePath)) {
    try {
      const raw = fs.readFileSync(storePath, 'utf8');
      store = JSON.parse(raw);
    } catch (err) {
      console.warn('Failed to read mock BQ store, starting fresh:', err.message);
      store = { users: [] };
    }
  } else {
    store = { users: [] };
    persist();
  }
}

function persist() {
  try {
    fs.writeFileSync(storePath, JSON.stringify(store, null, 2), { encoding: 'utf8' });
  } catch (err) {
    console.warn('Failed to persist mock BQ store:', err.message);
  }
}

function encrypt(plaintext) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return {
    iv: iv.toString('base64'),
    ciphertext: ciphertext.toString('base64'),
    tag: tag.toString('base64'),
  };
}

function decrypt(obj) {
  const iv = Buffer.from(obj.iv, 'base64');
  const ciphertext = Buffer.from(obj.ciphertext, 'base64');
  const tag = Buffer.from(obj.tag, 'base64');
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);
  const plain = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  return plain.toString('utf8');
}

function addUser(username, passwordPlain, displayName) {
  if (!username || !passwordPlain) throw new Error('username and password required');
  const existing = store.users.find(u => u.username === username);
  if (existing) return existing;
  const id = uuidv4();
  const passwordHash = bcrypt.hashSync(passwordPlain, 10);
  const enc = encrypt(passwordHash);
  const record = {
    id,
    username,
    displayName: displayName || username,
    password_encrypted: enc,
    created_at: new Date().toISOString(),
  };
  store.users.push(record);
  persist();
  return record;
}

function findUser(username) {
  const rec = store.users.find(u => u.username === username);
  if (!rec) return null;
  try {
    const passwordHash = decrypt(rec.password_encrypted);
    return {
      id: rec.id,
      username: rec.username,
      displayName: rec.displayName,
      passwordHash,
      created_at: rec.created_at,
    };
  } catch (err) {
    console.warn('Failed to decrypt password for', username, err.message);
    return null;
  }
}

function listUsers() {
  return store.users.map(u => ({ id: u.id, username: u.username, displayName: u.displayName, created_at: u.created_at }));
}

module.exports = { init, addUser, findUser, listUsers };
