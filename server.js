'use strict';

const path = require('path');
const express = require('express');
const { openDatabase, todayInToronto, recordGuestVisit } = require('./db');

const GUEST_ID_RE = /^[a-zA-Z0-9_-]{1,100}$/;

function createApp(db, options = {}) {
  const now = options.now || (() => new Date());
  const app = express();
  app.use(express.json());

  app.get('/api/health', (req, res) => {
    res.json({ ok: true });
  });

  app.post('/api/analytics/heartbeat', (req, res) => {
    const guestId = req.body && req.body.guestId;
    if (typeof guestId !== 'string' || !GUEST_ID_RE.test(guestId)) {
      return res.status(400).json({ error: 'A valid guestId is required.' });
    }
    const date = todayInToronto(now());
    const isNewVisit = recordGuestVisit(db, date, guestId);
    res.json({ ok: true, date, newVisit: isNewVisit });
  });

  const publicDir = path.join(__dirname, 'public');
  app.use(express.static(publicDir));

  return app;
}

if (require.main === module) {
  const dbPath = process.env.DB_PATH || path.join(__dirname, 'data', 'lapause.db');
  const port = Number(process.env.PORT) || 3000;
  const db = openDatabase(dbPath);
  const app = createApp(db);
  app.listen(port, () => {
    console.log(`La Pause API listening on http://localhost:${port}`);
  });
}

module.exports = { createApp };
