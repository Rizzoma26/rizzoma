import {test} from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {createHmac} from 'node:crypto';

const token = '12345:synthetic-environment-test-token';
function signed(id = 42, age = 0, key = token) {
  const p = new URLSearchParams({auth_date:String(Math.floor(Date.now()/1000)-age),user:JSON.stringify({id,first_name:'Test'})});
  const secret = createHmac('sha256','WebAppData').update(key).digest();
  p.set('hash',createHmac('sha256',secret).update([...p].map(([k,v])=>`${k}=${v}`).sort().join('\n')).digest('hex'));
  return p.toString();
}
async function listen(server) {
  server.listen(0,'127.0.0.1');
  await new Promise((resolve,reject)=>{server.once('listening',resolve);server.once('error',reject);});
  return 'http://127.0.0.1:'+server.address().port;
}
const close = server => new Promise(resolve=>server.close(resolve));

test('bot API requires a current session, matches signed identity and gates QA in both environments', async()=>{
  // Stub only the internal identity service. No database or Telegram traffic.
  const identity=http.createServer((req,res)=>{
    if(req.headers.cookie !== 'session=valid') return res.writeHead(401).end();
    res.writeHead(200,{'content-type':'application/json'}).end(JSON.stringify({userId:'u',telegramUserId:'42'}));
  });
  const base=await listen(identity);
  Object.assign(process.env,{
    BOT_TOKEN:token,APP_URL:'https://app.invalid',CORS_ORIGIN:'https://app.invalid',
    REGISTRATION_API_BASE:base,DATABASE_URL:'',DEV_ALLOWED_TG_IDS:'42',
    ADMIN_TG_IDS:'42',QA_ENABLED:'true',PAYMENT_MODE:'disabled',
    CHANNEL_ID:'-100123',DISCUSSION_ID:'',TELEGRAM_AUTH_MAX_AGE_SECONDS:'300'
  });
  try {
    for(const env of ['dev','prod']) {
      process.env.APP_ENV=env;
      process.env.QA_ENABLED=env==='dev'?'true':'false';
      const {app}=await import('../bot/bot.js?environment='+env);
      const server=http.createServer(app);
      const api=await listen(server);
      const post=(path,data,cookie='session=valid',origin='https://app.invalid')=>fetch(api+path,{
        method:'POST',headers:{'content-type':'application/json',cookie,origin},body:JSON.stringify({initData:data})
      });
      try {
        assert.equal((await post('/api/engagement',signed(),'')).status,401);
        assert.equal((await post('/api/engagement',signed(),'session=expired')).status,401);
        assert.equal((await post('/api/engagement',signed(43))).status,403);
        assert.equal((await post('/api/engagement',signed(42,0,'foreign-bot'))).status,401);
        assert.equal((await post('/api/engagement',signed(),'session=valid','https://foreign.invalid')).status,403);
        assert.equal((await post('/api/engagement',signed())).status,200);
        // Launch data can age while the previously issued session remains valid.
        assert.equal((await post('/api/engagement',signed(42,400))).status,200);
        assert.equal((await post('/api/admin/overview',signed())).status,env==='dev'?200:403);
      } finally { await close(server); }
    }
  } finally { await close(identity); }
});
