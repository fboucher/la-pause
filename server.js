'use strict';

const fs = require('fs');
const path = require('path');
const express = require('express');
const session = require('express-session');
const passport = require('passport');
const GoogleStrategy = require('passport-google-oauth20').Strategy;
const GitHubStrategy = require('passport-github2').Strategy;
const crypto = require('crypto');
const { Resend } = require('resend');
const { openDatabase, todayInToronto, recordGuestVisit, findUserById, upsertUser, getPlayerStats, syncPlayerStats, recordRegisteredVisit, recordWin, isDailyChallenge, submitDailyScore, getDailyLeaderboard, submitFreeWin, getFreeLeaderboard, saveMagicLinkToken, getMagicLinkToken, deleteMagicLinkToken } = require('./db');

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

  app.set('trust proxy', true);
  app.use(express.json());
  app.use(express.urlencoded({ extended: false }));

  if (options.mockUser) {
    app.use((req, res, next) => {
      req.isAuthenticated = () => true;
      req.user = options.mockUser;
      next();
    });
  }

  if (sessionSecret) {
    app.use(
      session({
        secret: sessionSecret,
        resave: false,
        saveUninitialized: false,
        cookie: {
          httpOnly: true,
          sameSite: 'lax',
          secure: process.env.NODE_ENV === 'production' ? 'auto' : false,
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
          callbackURL: options.googleCallbackURL || process.env.GOOGLE_CALLBACK_URL || '/auth/google/callback',
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
          callbackURL: options.githubCallbackURL || process.env.GITHUB_CALLBACK_URL || '/auth/github/callback',
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

  app.post('/auth/magic-link', async (req, res, next) => {
    const email = req.body.email ? req.body.email.trim().toLowerCase() : null;
    if (!email || !email.includes('@')) {
      return res.status(400).json({ error: 'Adresse e-mail invalide.' });
    }

    try {
      const token = crypto.randomBytes(32).toString('hex');
      const expiresAt = new Date(Date.now() + 15 * 60 * 1000).toISOString();
      saveMagicLinkToken(db, email, token, expiresAt);

      const host = req.get('host');
      const protocol = req.secure || req.headers['x-forwarded-proto'] === 'https' ? 'https' : 'http';
      const magicLink = `${protocol}://${host}/auth/magic-link/callback?token=${token}&email=${encodeURIComponent(email)}`;

      const resendApiKey = process.env.RESEND_API_KEY;
      const resendFrom = process.env.RESEND_FROM || 'onboarding@resend.dev';

      if (resendApiKey) {
        const resend = new Resend(resendApiKey);

        try {
          const { data, error } = await resend.emails.send({
            from: resendFrom,
            to: email,
            subject: 'La pause — Votre lien de connexion',
            text: `Bonjour,\n\nCliquez sur ce lien pour vous connecter à La pause :\n${magicLink}\n\nCe lien expirera dans 15 minutes.`,
            html: `<p>Bonjour,</p><p>Cliquez sur le lien ci-dessous pour vous connecter à <strong>La pause</strong> :</p><p><a href="${magicLink}">${magicLink}</a></p><p>Ce lien expirera dans 15 minutes.</p>`,
          });

          if (error) {
            console.error('Failed to send magic-link email via Resend:', error);
            console.log(`[MAGIC LINK DEV FALLBACK]: ${magicLink}`);
            return res.json({ success: true, message: 'Un e-mail de connexion a été envoyé (fallback local console).' });
          }

          res.json({ success: true, message: 'Un e-mail de connexion a été envoyé.' });
        } catch (sendErr) {
          console.error('Resend throw error:', sendErr);
          console.log(`[MAGIC LINK DEV FALLBACK]: ${magicLink}`);
          res.json({ success: true, message: 'Un e-mail de connexion a été envoyé (fallback local console).' });
        }
      } else {
        console.log(`[MAGIC LINK DEV FALLBACK]: ${magicLink}`);
        res.json({ success: true, message: 'Un e-mail de connexion a été envoyé (fallback local console).' });
      }
    } catch (err) {
      next(err);
    }
  });

  app.get('/auth/magic-link/callback', (req, res, next) => {
    const { token, email } = req.query;
    if (!token || !email) {
      return res.redirect('/?auth=failed');
    }

    try {
      const normalizedEmail = email.trim().toLowerCase();
      const tokenRecord = getMagicLinkToken(db, token);

      if (!tokenRecord) {
        return res.redirect('/?auth=failed');
      }

      if (tokenRecord.email.toLowerCase() !== normalizedEmail) {
        return res.redirect('/?auth=failed');
      }

      if (new Date(tokenRecord.expires_at) < new Date()) {
        deleteMagicLinkToken(db, token);
        return res.redirect('/?auth=failed');
      }

      deleteMagicLinkToken(db, token);

      const emailParts = normalizedEmail.split('@');
      const defaultName = emailParts[0].charAt(0).toUpperCase() + emailParts[0].slice(1);

      const user = upsertUser(db, {
        provider: 'magic-link',
        providerId: normalizedEmail,
        name: defaultName,
        email: normalizedEmail,
        avatar: `data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><circle cx="50" cy="50" r="40" fill="%239B8A78"/><text x="50" y="60" font-size="30" text-anchor="middle" fill="white">${defaultName.charAt(0).toUpperCase()}</text></svg>`
      });

      req.login(user, (err) => {
        if (err) return next(err);
        res.redirect('/');
      });
    } catch (err) {
      next(err);
    }
  });

  app.get('/auth/mock', (req, res, next) => {
    if (process.env.NODE_ENV === 'production' && process.env.ALLOW_MOCK_AUTH !== 'true') {
      return res.status(403).json({ error: 'Mock auth not allowed in production.' });
    }
    try {
      const user = upsertUser(db, {
        provider: 'mock',
        providerId: 'dev-user',
        name: 'Développeur Café',
        email: 'dev@c5m.ca',
        avatar: 'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><circle cx="50" cy="50" r="40" fill="%236F4E37"/><text x="50" y="60" font-size="30" text-anchor="middle" fill="white">☕</text></svg>'
      });
      req.login(user, (err) => {
        if (err) return next(err);
        res.redirect('/');
      });
    } catch (err) {
      next(err);
    }
  });

  app.get('/api/auth/me', (req, res) => {
    if (req.isAuthenticated && req.isAuthenticated()) {
      const date = todayInToronto(now());
      recordRegisteredVisit(db, date, req.user.id);
      return res.json({ authenticated: true, user: req.user });
    }
    res.json({ authenticated: false });
  });

  app.get('/api/definition', async (req, res) => {
    const word = req.query.word;
    if (!word || typeof word !== 'string' || !/^[a-zA-Zà-ÿÀ-Ÿ-]+$/.test(word)) {
      return res.status(400).json({ error: 'Mot invalide.' });
    }

    const normalizedWord = encodeURIComponent(word.trim().toLowerCase());
    const url = `https://www.larousse.fr/dictionnaires/francais/${normalizedWord}`;

    try {
      const response = await fetch(url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/115.0.0.0 Safari/537.36'
        }
      });

      if (!response.ok) {
        return res.status(404).json({ error: 'Définition introuvable.' });
      }

      const html = await response.text();

      const liMatch = html.match(/<li[^>]*class="DivisionDefinition"[^>]*>([\s\S]*?)<\/li>/);
      let rawText = null;
      if (liMatch) {
        rawText = liMatch[1];
      } else {
        const pMatch = html.match(/<p[^>]*class="Definition"[^>]*>([\s\S]*?)<\/p>/);
        if (pMatch) {
          rawText = pMatch[1];
        }
      }

      if (!rawText) {
        return res.status(404).json({ error: 'Définition introuvable.' });
      }

      let text = rawText;
      const colonIndex = text.search(/(\s*:\s*|&nbsp;:|&#160;:|&nbsp;\s*:)/);
      if (colonIndex !== -1) {
        text = text.substring(0, colonIndex);
      }
      text = text.replace(/<[^>]*>/g, '');
      text = text
        .replace(/&nbsp;/g, ' ')
        .replace(/&#160;/g, ' ')
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'");

      res.json({ definition: text.trim() });
    } catch (error) {
      console.error(`Error scraping Larousse for word "${word}":`, error);
      res.status(500).json({ error: 'Erreur lors de la récupération de la définition.' });
    }
  });

  app.get('/api/user/profile', (req, res) => {
    if (!req.isAuthenticated || !req.isAuthenticated()) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
    const date = todayInToronto(now());
    recordRegisteredVisit(db, date, req.user.id);
    const stats = getPlayerStats(db, req.user.id);
    res.json({
      id: req.user.id,
      provider: req.user.provider,
      provider_id: req.user.provider_id,
      name: req.user.name,
      email: req.user.email,
      avatar: req.user.avatar,
      created_at: req.user.created_at,
      stats,
    });
  });

  app.post('/api/user/sync', (req, res) => {
    if (!req.isAuthenticated || !req.isAuthenticated()) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
    const { tokens, wins, streak, best_streak } = req.body || {};
    const clientTokens = parseInt(tokens, 10) || 0;
    const clientWins = parseInt(wins, 10) || 0;
    const clientStreak = parseInt(streak, 10) || 0;
    const clientBestStreak = parseInt(best_streak, 10) || 0;

    const merged = syncPlayerStats(db, req.user.id, {
      tokens: clientTokens,
      wins: clientWins,
      streak: clientStreak,
      best_streak: clientBestStreak,
    });

    const date = todayInToronto(now());
    recordRegisteredVisit(db, date, req.user.id);

    res.json(merged);
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

  app.post('/api/analytics/win', (req, res) => {
    const { mode } = req.body || {};
    if (mode !== 'espresso' && mode !== 'latte' && mode !== 'free') {
      return res.status(400).json({ error: 'Invalid mode.' });
    }
    const date = todayInToronto(now());
    recordWin(db, date, mode);
    res.json({ ok: true });
  });

  app.post('/api/leaderboard/daily', (req, res) => {
    if (!req.isAuthenticated || !req.isAuthenticated()) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
    const { challenge, moves, hints } = req.body || {};
    if (!isDailyChallenge(challenge)) {
      return res.status(400).json({ error: 'Invalid challenge.' });
    }
    const m = Number.parseInt(moves, 10);
    const h = Number.parseInt(hints, 10);
    if (!Number.isInteger(m) || m < 1 || !Number.isInteger(h) || h < 0) {
      return res.status(400).json({ error: 'Invalid score.' });
    }
    const date = todayInToronto(now());
    const result = submitDailyScore(db, date, challenge, req.user.id, m, h, now().toISOString());
    res.json({ ok: true, date, challenge, ...result });
  });

  app.get('/api/leaderboard/daily', (req, res) => {
    const rawChallenge = req.query.challenge;
    const challenge = typeof rawChallenge === 'string' && rawChallenge !== '' ? rawChallenge : 'espresso';
    if (!isDailyChallenge(challenge)) {
      return res.status(400).json({ error: 'Invalid challenge.' });
    }
    const raw = req.query.date;
    const date = typeof raw === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(raw) ? raw : todayInToronto(now());
    res.json({ date, challenge, entries: getDailyLeaderboard(db, date, challenge) });
  });

  app.post('/api/leaderboard/unlimited', (req, res) => {
    if (!req.isAuthenticated || !req.isAuthenticated()) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
    const { wins } = req.body || {};
    const w = Number.parseInt(wins, 10);
    if (!Number.isInteger(w) || w < 0) {
      return res.status(400).json({ error: 'Invalid wins.' });
    }
    const result = submitFreeWin(db, req.user.id, w, now().toISOString());
    res.json({ ok: true, ...result });
  });

  app.get('/api/leaderboard/unlimited', (req, res) => {
    res.json({ entries: getFreeLeaderboard(db) });
  });

  app.get('/api/admin/metrics', (req, res) => {
    const adminSecret = options.adminSecret || process.env.ADMIN_SECRET || 'dev-secret-token';
    const clientToken = req.headers['x-admin-token'] || req.query.token;
    if (!clientToken || clientToken !== adminSecret) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
    const rows = db.prepare('SELECT date, guests, registered, puzzle_wins, free_wins FROM daily_analytics ORDER BY date').all();
    res.json(rows);
  });

  app.get('/admin/analytics', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'admin.html'));
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

