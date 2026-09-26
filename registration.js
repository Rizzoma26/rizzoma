(function(){
  'use strict';

  var cfg = window.RIZZOMA_CONFIG || {};
  var apiBase = String(cfg.registrationApiBase || '').replace(/\/+$/, '');
  var webApp = window.Telegram && window.Telegram.WebApp;
  if(!apiBase || !webApp || !webApp.initData) return;

  var params = new URL(location.href).searchParams;
  var startParam = String((webApp.initDataUnsafe && webApp.initDataUnsafe.start_param) || '');
  var rawReferral = startParam.replace(/^ref[_-]?/i, '') || params.get('ref') || '';
  var referralCode = /^[A-Z0-9]{4,8}$/i.test(rawReferral) ? rawReferral.toUpperCase() : undefined;

  window.RIZZOMA_REGISTRATION = fetch(apiBase + '/api/v1/registrations/telegram', {
    method: 'POST',
    headers: {'Content-Type':'application/json'},
    body: JSON.stringify({initData:webApp.initData, referralCode:referralCode})
  }).then(function(response){
    if(!response.ok) throw new Error('registration-' + response.status);
    return response.json();
  }).then(function(result){
    var participant = {user:result.user, registration:result.registration};
    window.dispatchEvent(new CustomEvent('rizzoma:registered', {detail:participant}));
    return participant;
  }).catch(function(error){
    console.warn('participant registration deferred', error && error.message);
    return null;
  });
})();
