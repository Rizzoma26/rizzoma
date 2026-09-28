import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createHmac} from 'node:crypto';
import {register} from 'tsx/esm/api';
register();
const {AuthService} = await import('../apps/api/src/auth/auth.service.ts');
const {loadConfig} = await import('../apps/api/src/config.ts');
const {createApp} = await import('../apps/api/src/app.ts');
const {PostgresAuthRepository} = await import('../apps/api/src/auth/auth.repository.ts');
const token = '12345:synthetic-only-test-token';
const now = new Date();
function signed(id = 42, botToken = token, age = 0) {
  const p = new URLSearchParams({auth_date:String(Math.floor(now.getTime()/1000)-age), user:JSON.stringify({id,first_name:'Test'})});
  const secret = createHmac('sha256','WebAppData').update(botToken).digest();
  p.set('hash',createHmac('sha256',secret).update([...p].map(([k,v])=>`${k}=${v}`).sort().join('\n')).digest('hex'));
  return p.toString();
}
const sessions = new Map();
const repository = {
  async registerUser(user) { return {user:{id:'u',telegramUserId:user.id,status:'active'},created:true,source:'mini_app',referralCode:'TEST',referredByCode:null,registeredAt:now.toISOString()}; },
  async createSession(s) { sessions.set(s.tokenHash.toString('hex'), {id:'u',telegramUserId:'42'}); },
  async findActiveSession(hash) { return sessions.get(hash.toString('hex')) || null; }
};
function service(botToken = token, ids = undefined) {
  return new AuthService(repository,{botToken,allowedTelegramIds:ids,telegramAuthMaxAgeSeconds:300,sessionTtlSeconds:900,now:()=>now});
}
test('signed launch accepted; wrong bot, expired, future and duplicate payloads denied', async()=>{
  for(const auth of [service(), service(token,new Set(['42']))]) assert.equal((await auth.registerMiniApp(signed())).user.telegramUserId,'42');
  for(const data of [signed(42,'different-bot'),signed(42,token,301),signed(42,token,-120),signed()+'&auth_date=1','']) {
    await assert.rejects(service().registerMiniApp(data),e=>e.status===401);
  }
});
test('dev allowlist enforced at registration and on existing sessions',async()=>{
  const ids = new Set(['42']); const auth=service(token,ids);
  await assert.rejects(auth.registerMiniApp(signed(43)),e=>e.status===403);
  const result=await auth.registerMiniApp(signed());
  assert.equal((await auth.authenticate(result.accessToken)).telegramUserId,'42');
  ids.clear();
  await assert.rejects(auth.authenticate(result.accessToken),e=>e.status===403);
  await assert.rejects(service().authenticate('x'.repeat(43)),e=>e.status===401);
});
test('configuration fails closed without dev allowlist or with non-HTTPS origin',()=>{
  const env={APP_ENV:'dev',BOT_TOKEN:token,DATABASE_URL:'postgresql://test:test@localhost/test',ALLOWED_ORIGINS:'https://dev.invalid'};
  assert.throws(()=>loadConfig(env));
  assert.equal(loadConfig({...env,DEV_ALLOWED_TG_IDS:'42'}).appEnv,'dev');
  assert.throws(()=>loadConfig({...env,APP_ENV:'prod',ALLOWED_ORIGINS:'http://localhost'}));
});
test('HTTP exchange sets host-only HttpOnly cookie; protected endpoints reject absent and foreign cookies',async()=>{
  const originals = {};
  for(const key of Object.keys(repository)) { originals[key]=PostgresAuthRepository.prototype[key]; PostgresAuthRepository.prototype[key]=repository[key]; }
  const config=loadConfig({APP_ENV:'dev',DEV_ALLOWED_TG_IDS:'42',BOT_TOKEN:token,DATABASE_URL:'postgresql://test:test@localhost/test',ALLOWED_ORIGINS:'https://dev.invalid'});
  const server=createApp(config,{}).listen(0,'127.0.0.1');
  try {
    await new Promise(r=>server.once('listening',r));
    const base='http://127.0.0.1:'+server.address().port;
    for(const headers of [{},{'user-agent':'Telegram'},{cookie:'__Host-rizzoma-prod='+'x'.repeat(43)}]) assert.equal((await fetch(base+'/api/v1/me',{headers})).status,401);
    // Alternate spelling must not expose the internal bot registration route
    // through nginx's public /api/v1/ proxy.
    for(const path of ['/api/v1/registrations/bot/','/api/v1/registrations/BOT']) {
      assert.equal((await fetch(base+path,{method:'POST',headers:{'content-type':'application/json'},body:'{}'})).status,401);
    }
    const response=await fetch(base+'/api/v1/registrations/telegram',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({initData:signed()})});
    assert.equal(response.status,200);
    const cookie=response.headers.get('set-cookie');
    for(const flag of ['__Host-rizzoma-dev=','HttpOnly','Secure','SameSite=Strict','Path=/']) assert.ok(cookie.includes(flag));
    assert.ok(!cookie.includes('Domain='));
    assert.equal((await response.json()).accessToken,undefined);
    assert.equal((await fetch(base+'/api/v1/session',{headers:{cookie:cookie.split(';')[0]}})).status,204);
    assert.equal((await fetch(base+'/api/v1/me',{headers:{cookie:cookie.split(';')[0],origin:'https://foreign.invalid'}})).status,403);
    for(const [data,status] of [[signed(42,'foreign-bot'),401],[signed(42,token,301),401],[signed(43),403]]) {
      const rejected=await fetch(base+'/api/v1/registrations/telegram',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({initData:data})});
      assert.equal(rejected.status,status);
      assert.equal(rejected.headers.get('set-cookie'),null);
    }
  } finally { await new Promise(r=>server.close(r)); for(const [k,v] of Object.entries(originals)) PostgresAuthRepository.prototype[k]=v; }
});
