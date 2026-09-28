/* Browser persistence adapter for the legacy/demo client entities.
   PostgreSQL remains authoritative for registered users, payments, beta settings,
   and engagement awards whenever the protected API is available. */
(function (global) {
  'use strict';

  var STORAGE_KEYS = Object.freeze({
    database: 'rizzoma_mock_db',
    currentUser: 'rizzoma_me',
    attribution: 'rizzoma_attribution',
    claims: 'rizzoma_claims',
    beta: 'rizzoma_beta',
    engagement: 'rizzoma_engagement'
  });
  var CLOUD_KEYS = [STORAGE_KEYS.database, STORAGE_KEYS.currentUser,
                    STORAGE_KEYS.attribution, STORAGE_KEYS.claims];
  var ATTRIBUTION_TTL = 30 * 24 * 60 * 60 * 1000;

  class ClientStateRepository {
    constructor(options) {
      options = options || {};
      this.entities = options.entities || global.RIZZOMA_ENTITIES;
      this.localStorage = options.localStorage || null;
      try { if (!this.localStorage) this.localStorage = global.localStorage; }
      catch (_) { this.localStorage = null; }
      this.telegram = options.telegram || { cloud: function () { return null; }, startParam: function () { return ''; } };
      this.location = options.location || global.location;
      this.keys = STORAGE_KEYS;
      this.cloudKeys = CLOUD_KEYS.slice();
      this.storage = Object.freeze({
        get: (key) => this.get(key),
        set: (key, value) => this.set(key, value),
        del: (key) => this.del(key)
      });
    }

    get(key) {
      try { return this.localStorage ? this.localStorage.getItem(key) : null; }
      catch (_) { return null; }
    }

    set(key, value) {
      try { if (this.localStorage) this.localStorage.setItem(key, value); }
      catch (_) { /* local storage can be unavailable in private contexts */ }
      this.cloudPush(key, value);
    }

    del(key) {
      try { if (this.localStorage) this.localStorage.removeItem(key); }
      catch (_) { /* local storage can be unavailable in private contexts */ }
      this.cloudPush(key, null);
    }

    cloudPush(key, value) {
      var cloud = this.telegram.cloud();
      if (!cloud || this.cloudKeys.indexOf(key) < 0) return;
      try {
        if (value === null) cloud.removeItem(key, function () {});
        else if (String(value).length <= 4000) cloud.setItem(key, String(value), function () {});
      } catch (_) { /* Telegram CloudStorage is an optional cache mirror */ }
    }

    cloudPull(done) {
      var cloud = this.telegram.cloud();
      if (!cloud) return;
      try {
        cloud.getItems(this.cloudKeys, (error, data) => {
          if (error || !data) return;
          var adopted = false;
          this.cloudKeys.forEach((key) => {
            if (data[key] && !this.get(key)) {
              try {
                if (this.localStorage) this.localStorage.setItem(key, data[key]);
                adopted = true;
              } catch (_) { /* keep the remote mirror available for a later open */ }
            }
          });
          if (adopted) {
            if (done) done();
          } else {
            this.cloudKeys.forEach((key) => {
              var value = this.get(key);
              if (value) this.cloudPush(key, value);
            });
          }
        });
      } catch (_) { /* CloudStorage failure must not prevent app startup */ }
    }

    loadDatabase() {
      var raw = this.get(STORAGE_KEYS.database);
      if (raw) {
        try { return this.entities.normalizeDatabase(JSON.parse(raw)); }
        catch (_) { /* restore an empty demo database from malformed cache */ }
      }
      return this.entities.emptyDatabase();
    }

    saveDatabase(database) {
      this.set(STORAGE_KEYS.database, JSON.stringify(database));
    }

    newCode(database, random) {
      var alphabet = 'ACDEFHJKLMNPRTUVWXY3479';
      random = random || Math.random;
      var code;
      do {
        code = '';
        for (var i = 0; i < 6; i++) code += alphabet[Math.floor(random() * alphabet.length)];
      } while (database.users[code]);
      return code;
    }

    ensureUser(database, code, patch) {
      if (!database.users[code]) database.users[code] = this.entities.createDemoUser(code);
      if (patch) Object.assign(database.users[code], patch);
      return database.users[code];
    }

    me(database) {
      var code = this.get(STORAGE_KEYS.currentUser);
      return code && database.users[code] ? code : null;
    }

    setMe(code) {
      this.set(STORAGE_KEYS.currentUser, code);
    }

    myUser(database) {
      var code = this.me(database);
      return code ? database.users[code] : null;
    }

    refCount(user) {
      return user && user.referrals ? user.referrals.length : 0;
    }

    claims(database) {
      var code = this.me(database);
      if (!code) return [];
      if (!database.claims) database.claims = {};
      if (!Array.isArray(database.claims[code])) database.claims[code] = [];
      return database.claims[code];
    }

    saveClaims(database) {
      var code = this.me(database);
      if (!code) return;
      this.saveDatabase(database);
      this.set(STORAGE_KEYS.claims, JSON.stringify({ code: code, list: this.claims(database) }));
    }

    grantClaim(database, index) {
      if (!Number.isInteger(index) || index < 0 || index >= 10) return false;
      var list = this.claims(database);
      if (list.indexOf(index) >= 0) return false;
      list.push(index);
      list.sort(function (a, b) { return a - b; });
      this.saveClaims(database);
      return true;
    }

    adoptCloudClaims(database) {
      var raw = this.get(STORAGE_KEYS.claims);
      var code = this.me(database);
      if (!raw || !code) return;
      try {
        var cached = JSON.parse(raw);
        if (cached && cached.code === code && Array.isArray(cached.list)) {
          if (!database.claims) database.claims = {};
          var current = Array.isArray(database.claims[code]) ? database.claims[code] : [];
          var merged = this.entities.mergeClaims(current, cached.list);
          if (!this.entities.sameList(current, merged)) {
            database.claims[code] = merged;
            this.saveDatabase(database);
          }
        }
      } catch (_) { /* ignore an invalid optional compact mirror */ }
    }

    readAttribution(now) {
      var raw = this.get(STORAGE_KEYS.attribution);
      if (!raw) return null;
      try {
        var attribution = JSON.parse(raw);
        if (!attribution || !attribution.code || !attribution.ts) return null;
        if ((now === undefined ? Date.now() : now) - attribution.ts > ATTRIBUTION_TTL) {
          this.del(STORAGE_KEYS.attribution);
          return null;
        }
        return attribution;
      } catch (_) { return null; }
    }

    captureReferral(database, now) {
      var url = new URL(this.location.href);
      var code = url.searchParams.get('ref');
      if (!code) code = String(this.telegram.startParam() || '').replace(/^ref[_-]?/i, '');
      if (!code) {
        var match = this.location.pathname.match(/\/r\/([A-Za-z0-9]{4,10})\/?$/);
        if (match) code = match[1];
      }
      if (!code || !/^[A-Za-z0-9]{4,8}$/.test(code)) return;
      code = code.toUpperCase().slice(0, 8);
      if (code === this.me(database)) return;
      var current = this.readAttribution(now);
      if (current && current.code === code) {
        if (!database.users[code]) {
          this.ensureUser(database, code, {});
          this.saveDatabase(database);
        }
        return;
      }
      this.ensureUser(database, code, {});
      this.saveDatabase(database);
      this.set(STORAGE_KEYS.attribution, JSON.stringify({
        code: code,
        ts: now === undefined ? Date.now() : now
      }));
    }

    loadBetaOpen(fallback) {
      var raw = this.get(STORAGE_KEYS.beta);
      if (raw) {
        try {
          var values = JSON.parse(raw);
          if (Array.isArray(values)) return new Set(values.map(Number));
        } catch (_) { /* use configured defaults for a malformed cache */ }
      }
      return new Set((fallback || []).map(Number));
    }

    saveBetaOpen(list) {
      var values = Array.from(new Set(list.map(Number))).sort(function (a, b) { return a - b; });
      try { if (this.localStorage) this.localStorage.setItem(STORAGE_KEYS.beta, JSON.stringify(values)); }
      catch (_) { /* beta state also comes from the server in the protected app */ }
      return new Set(values);
    }

    loadEngagement() {
      return this.entities.readEngagement(this.get(STORAGE_KEYS.engagement));
    }

    saveEngagement(snapshot) {
      try { if (this.localStorage) this.localStorage.setItem(STORAGE_KEYS.engagement, JSON.stringify(snapshot)); }
      catch (_) { /* the server remains authoritative for activity points */ }
    }
  }

  global.RIZZOMA_CLIENT_STATE = Object.freeze({
    ClientStateRepository: ClientStateRepository,
    keys: STORAGE_KEYS,
    cloudKeys: CLOUD_KEYS.slice(),
    attributionTtl: ATTRIBUTION_TTL
  });
})(window);
