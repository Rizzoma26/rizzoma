(function(){
  'use strict';

  var cfg = window.RIZZOMA_CONFIG || {};
  var apiBase = String(cfg.registrationApiBase || '').replace(/\/+$/, '');
  var webApp = window.Telegram && window.Telegram.WebApp;
  if(!apiBase || !webApp || !webApp.initData) return;

  var params = new URL(location.href).searchParams;
  var startParam = String((webApp.initDataUnsafe && webApp.initDataUnsafe.start_param) || '');
  // This is only a local reuse check; every protected API validates signed initData server-side.
  var telegramUserId = webApp.initDataUnsafe && webApp.initDataUnsafe.user
    ? String(webApp.initDataUnsafe.user.id || '') : '';
  var rawReferral = startParam.replace(/^ref[_-]?/i, '') || params.get('ref') || '';
  var referralCode = /^[A-Z0-9]{4,8}$/i.test(rawReferral) ? rawReferral.toUpperCase() : undefined;

  function register() {
    return fetch(apiBase + '/api/v1/registrations/telegram', {
      method: 'POST', credentials: 'same-origin',
      headers: {'Content-Type':'application/json'},
      body: JSON.stringify({initData:webApp.initData, referralCode:referralCode})
    }).then(function(response){
      if(!response.ok) throw new Error('registration-' + response.status);
      return response.json();
    });
  }

  function reuseSession() {
    return fetch(apiBase + '/api/v1/session', {credentials:'same-origin'}).then(function(response){
      if(response.status !== 204) return null;
      return fetch(apiBase + '/api/v1/me', {credentials:'same-origin'}).then(function(identityResponse){
        if(!identityResponse.ok) return {user:null, registration:null};
        return identityResponse.json().then(function(identity){
          if(!telegramUserId || String(identity.telegramUserId) !== telegramUserId) return null;
          return {user:{id:identity.userId, telegramUserId:identity.telegramUserId}, registration:null};
        });
      });
    }).catch(function(){ return null; });
  }

  window.RIZZOMA_REGISTRATION = reuseSession().then(function(existing){
    // The HTTPS bootstrap already created a session. Reuse it instead of
    // issuing a second token for every protected-page load.
    return existing || register();
  }).then(function(result){
    var participant = {user:result.user, registration:result.registration};
    window.dispatchEvent(new CustomEvent('rizzoma:registered', {detail:participant}));
    return participant;
  }).catch(function(error){
    console.warn('participant registration deferred', error && error.message);
    return null;
  });
})();
