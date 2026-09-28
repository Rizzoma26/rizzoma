(async function () {
  'use strict';
  var tg = window.Telegram && window.Telegram.WebApp;
  if (!tg || !tg.initData) return;
  var status = document.getElementById('status');
  status.textContent = 'Проверяем вход…';

  async function hasMatchingSession() {
    // This value only avoids a redundant exchange; protected APIs still validate signed initData.
    var telegramUserId = tg.initDataUnsafe && tg.initDataUnsafe.user
      ? String(tg.initDataUnsafe.user.id || '') : '';
    if (!telegramUserId) return false;
    var session = await fetch('/api/v1/session', {credentials:'same-origin'});
    if (session.status !== 204) return false;
    var identityResponse = await fetch('/api/v1/me', {credentials:'same-origin'});
    if (!identityResponse.ok) return false;
    var identity = await identityResponse.json();
    return String(identity.telegramUserId) === telegramUserId;
  }

  try {
    try {
      if (await hasMatchingSession()) {
        location.replace('/app.html' + location.search + location.hash);
        return;
      }
    } catch (_) { /* attempt the signed exchange if the session probe is unavailable */ }

    var start = new URLSearchParams(tg.initData).get('start_param') || '';
    var referral = start.replace(/^ref[_-]?/i, '') || new URLSearchParams(location.search).get('ref') || '';
    var response = await fetch('/api/v1/registrations/telegram', {
      method: 'POST', credentials: 'same-origin',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({initData: tg.initData, referralCode: /^[A-Z0-9]{4,8}$/i.test(referral) ? referral.toUpperCase() : undefined})
    });
    if (!response.ok) throw new Error('Access denied');
    location.replace('/app.html' + location.search + location.hash);
  } catch (_) {
    status.textContent = 'Вход недоступен. Откройте приложение заново через своего бота. Для dev нужен доступ тестера.';
  }
})();
