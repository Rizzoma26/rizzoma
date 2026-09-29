/* ============================================================
   Генератор статических данных сцены: assets/generated/scene-data.js.

   Геометрия дерева (клин, спина, узлы, облако точек, сигилы) зависит
   только от сидов в assets/js/scene/geometry.js и от economy.js, поэтому
   считается один раз здесь, а не в каждом запуске приложения. Файл лежит
   в Git; tests/scene-data.test.mjs перегенерирует его и падает, если
   закоммиченная копия устарела.

   Запуск после правки economy.js (TIERS, BRANCHES) или geometry.js:
     npm run build:scene

   Кроме файла обновляется ?v=<хэш содержимого> в index.html: браузер
   держит ресурс в кэше как immutable, новый адрес — единственный способ
   доставить новую версию.
   ============================================================ */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import {createRequire} from 'node:module';
import {fileURLToPath, pathToFileURL} from 'node:url';

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const GEO = require('../assets/js/scene/geometry.js');
const ECON = require('../economy.js');

export const OUTPUT = path.join(ROOT, 'assets/generated/scene-data.js');
export const INDEX = path.join(ROOT, 'index.html');
/* ссылка на ресурс в index.html; хэш — первые 8 символов sha256 содержимого */
export const SCRIPT_REF = /assets\/generated\/scene-data\.js\?v=[0-9a-f]{8}/g;

export function render(){
  return '/* Сгенерировано tools/build-scene-data.mjs — не править вручную.\n' +
         '   Статическая геометрия сцены: одинакова для всех пользователей и контуров. */\n' +
         'window.RIZZOMA_SCENE = ' + JSON.stringify(GEO.build(ECON)) + ';\n';
}
export const contentHash = text => crypto.createHash('sha256').update(text).digest('hex').slice(0, 8);
export const scriptRef = text => `assets/generated/scene-data.js?v=${contentHash(text)}`;

const isEntry = process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url;
if(isEntry){
  const text = render();
  fs.mkdirSync(path.dirname(OUTPUT), {recursive: true});
  fs.writeFileSync(OUTPUT, text);
  const html = fs.readFileSync(INDEX, 'utf8');
  const refs = html.match(SCRIPT_REF) || [];
  if(refs.length !== 1){
    console.error(`index.html: ожидалась одна ссылка на scene-data.js?v=…, найдено ${refs.length}`);
    process.exit(1);
  }
  fs.writeFileSync(INDEX, html.replace(SCRIPT_REF, scriptRef(text)));
  console.log(`scene-data.js: ${text.length} байт, version ${GEO.versionOf(ECON)}, ${scriptRef(text)}`);
}
