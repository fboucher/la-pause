'use strict';

const fs = require('fs');
const path = require('path');
const express = require('express');
const session = require('express-session');
const passport = require('passport');
const GoogleStrategy = require('passport-google-oauth20').Strategy;
const GitHubStrategy = require('passport-github2').Strategy;
const { openDatabase, todayInToronto, recordGuestVisit, findUserById, upsertUser } = require('./db');

function loadEnv() {
  const envPath = path.join(__dirname, '.env');
  if (fs.existsSync(envPath)) {
    const content = fs.readFileSync(envPath, 'utf8');
    for (const line of content.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const eqIdx = trimmed.indexOf('=');
      if (eqIdx > 0) {
        const key = trimmed.slice(0, eqIdx).trim();
        const value = trimmed.slice(eqIdx + 1).trim();
        if (!process.env[key]) {
          process.env[key] = value;
        }
      }
    }
  }
}
loadEnv();

const GUEST_ID_RE = /^[a-zA-Z0-9_-]{1,100}$/;

function createApp(db, options = {}) {
  const now = options.now || (() => new Date());
  const app = express();

  const sessionSecret = options.sessionSecret || process.env.SESSION_SECRET;
  if (!sessionSecret && !options.skipAuthSecretCheck) {
    throw new Error('SESSION_SECRET environment variable is required.');
  }

  app.set('trust proxy', 1);
  app.use(express.json());
  app.use(express.urlencoded({ extended: false }));

  if (sessionSecret) {
    app.use(
      session({
        secret: sessionSecret,
        resave: false,
        saveUninitialized: false,
        cookie: {
          httpOnly: true,
          sameSite: 'lax',
          secure: process.env.NODE_ENV === 'production',
        },
      })
    );
    app.use(passport.initialize());
    app.use(passport.session());
  }

  passport.serializeUser((user, done) => {
    done(null, user.id);
  });

  passport.deserializeUser((id, done) => {
    try {
      const user = findUserById(db, id);
      done(null, user || false);
    } catch (err) {
      done(err);
    }
  });

  const googleClientId = options.googleClientId || process.env.GOOGLE_CLIENT_ID;
  const googleClientSecret = options.googleClientSecret || process.env.GOOGLE_CLIENT_SECRET;
  if (googleClientId && googleClientSecret) {
    passport.use(
      new GoogleStrategy(
        {
          clientID: googleClientId,
          clientSecret: googleClientSecret,
          callbackURL: options.googleCallbackURL || '/auth/google/callback',
        },
        (accessToken, refreshToken, profile, done) => {
          try {
            const user = upsertUser(db, {
              provider: 'google',
              providerId: profile.id,
              name: profile.displayName,
              email: profile.emails?.[0]?.value ?? null,
              avatar: profile.photos?.[0]?.value ?? null,
            });
            done(null, user);
          } catch (err) {
            done(err);
          }
        }
      )
    );
  }

  const githubClientId = options.githubClientId || process.env.GITHUB_CLIENT_ID;
  const githubClientSecret = options.githubClientSecret || process.env.GITHUB_CLIENT_SECRET;
  if (githubClientId && githubClientSecret) {
    passport.use(
      new GitHubStrategy(
        {
          clientID: githubClientId,
          clientSecret: githubClientSecret,
          callbackURL: options.githubCallbackURL || '/auth/github/callback',
        },
        (accessToken, refreshToken, profile, done) => {
          try {
            const avatar = profile.photos?.[0]?.value || profile._json?.avatar_url || null;
            const user = upsertUser(db, {
              provider: 'github',
              providerId: String(profile.id),
              name: profile.displayName || profile.username,
              email: profile.emails?.[0]?.value ?? null,
              avatar,
            });
            done(null, user);
          } catch (err) {
            done(err);
          }
        }
      )
    );
  }

  app.get('/auth/google', (req, res, next) => {
    if (!googleClientId || !googleClientSecret) {
      return res.status(500).json({ error: 'Google Auth not configured' });
    }
    passport.authenticate('google', { scope: ['profile', 'email'] })(req, res, next);
  });

  app.get('/auth/google/callback', (req, res, next) => {
    passport.authenticate('google', {
      successRedirect: '/',
      failureRedirect: '/?auth=failed',
    })(req, res, next);
  });

  app.get('/auth/github', (req, res, next) => {
    if (!githubClientId || !githubClientSecret) {
      return res.status(500).json({ error: 'GitHub Auth not configured' });
    }
    passport.authenticate('github', { scope: ['user:email'] })(req, res, next);
  });

  app.get('/auth/github/callback', (req, res, next) => {
    passport.authenticate('github', {
      successRedirect: '/',
      failureRedirect: '/?auth=failed',
    })(req, res, next);
  });

  app.get('/api/auth/me', (req, res) => {
    if (req.isAuthenticated && req.isAuthenticated()) {
      return res.json({ authenticated: true, user: req.user });
    }
    res.json({ authenticated: false });
  });

  app.post('/api/auth/logout', (req, res, next) => {
    if (typeof req.logout === 'function') {
      req.logout((err) => {
        if (err) return next(err);
        if (req.session) {
          req.session.destroy(() => {
            res.clearCookie('connect.sid');
            res.json({ ok: true });
          });
        } else {
          res.json({ ok: true });
        }
      });
    } else {
      res.json({ ok: true });
    }
  });

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

