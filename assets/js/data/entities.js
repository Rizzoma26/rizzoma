/* Serializable client-side entities. Keep these shapes compatible with the
   existing localStorage keys; server-owned state is modelled by API contracts. */
(function (global) {
  'use strict';

  /** @typedef {{code:string,name:string,email:string,paid:boolean,referredBy:string|null,referrals:string[],ts:number}} DemoUser */
  /** @typedef {{name?:string,username?:string,photo?:string,email?:string}} DemoProfile */
  /** @typedef {{users:Object<string,DemoUser>,buyers:Object<string,string>,profiles:Object<string,DemoProfile>,claims:Object<string,number[]>}} DemoDatabase */
  /** @typedef {{code:string,ts:number}} ReferralAttribution */
  /** @typedef {{points:number,events?:Array<unknown>,tracking?:string,discussion?:string,ts?:number}} EngagementSnapshot */

  function emptyDatabase() {
    return { users: {}, buyers: {}, profiles: {}, claims: {} };
  }

  function recordOrEmpty(value) {
    return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  }

  function normalizeDatabase(value) {
    if (!value || typeof value !== 'object' || !value.users) return emptyDatabase();
    return {
      users: recordOrEmpty(value.users),
      buyers: recordOrEmpty(value.buyers),
      profiles: recordOrEmpty(value.profiles),
      claims: recordOrEmpty(value.claims)
    };
  }

  function createDemoUser(code, patch, now) {
    return Object.assign({
      code: code,
      name: '',
      email: '',
      paid: false,
      referredBy: null,
      referrals: [],
      ts: now === undefined ? Date.now() : now
    }, patch || {});
  }

  function mergeClaims(current, incoming) {
    return Array.from(new Set((current || []).concat(incoming || [])))
      .filter(function (index) { return index >= 0 && index < 10; })
      .sort(function (a, b) { return a - b; });
  }

  function sameList(left, right) {
    return left.length === right.length && left.every(function (value, index) {
      return value === right[index];
    });
  }

  function readEngagement(value) {
    if (typeof value !== 'string' || !value) return null;
    try {
      var snapshot = JSON.parse(value);
      return snapshot && typeof snapshot.points === 'number' ? snapshot : null;
    } catch (_) {
      return null;
    }
  }

  global.RIZZOMA_ENTITIES = Object.freeze({
    emptyDatabase: emptyDatabase,
    normalizeDatabase: normalizeDatabase,
    createDemoUser: createDemoUser,
    mergeClaims: mergeClaims,
    sameList: sameList,
    readEngagement: readEngagement
  });
})(window);
