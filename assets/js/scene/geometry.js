/* ============================================================
   RIZZOMA — геометрия сцены дерева: мандала-клин, спина ветви,
   узлы-скиллы, облако точек и сигилы.

   Только числа, без DOM и Path2D: один и тот же код работает
   и как браузерный скрипт (window.RIZZOMA_SCENE_GEOMETRY), и как
   CommonJS-модуль (генератор tools/build-scene-data.mjs, тесты).
   Path2D из этих чисел собирает index.html.

   Алгоритм перенесён из index.html без изменений: те же сиды, тот же
   порядок вызовов генератора и та же арифметика. Наружу координаты
   отдаются округлёнными до 1e-6 (≈0,003 px на максимальном зуме):
   Math.sin/cos в разных движках расходятся в последнем бите, после
   округления этого расхождения нет — числа генератора в Node и расчёта
   в браузере совпадают, а файл не зависит от версии Node.
   ============================================================ */
(function(root, factory){
  const api = factory();
  root.RIZZOMA_SCENE_GEOMETRY = api;
  if(typeof module === 'object' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function(){
'use strict';

/* Номер алгоритма: меняется при любой правке кода ниже, влияющей на числа.
   Входит в version — устаревший ресурс сцены страница не примет. */
const ALGORITHM = 1;

const MAND_S = 3;                                   // три ветви → тройная симметрия
const WEDGE_SEED = 480921;
const WEDGE_OPTS = {depth:6, spread:0.44, decay:0.86, kink:0.14, dot:1.9};
const HALO_SEED = 90210;
const HALO_SIZES = [0.0072, 0.0054, 0.0039, 0.0027, 0.0017];

const clamp = (v,a,b) => v<a?a:(v>b?b:v);
const q = v => Math.round(v * 1e6) / 1e6 + 0;           // + 0: без «-0» в JSON
const qa = a => a.map(q);
const qp = p => [q(p[0]), q(p[1])];
function mulberry32(a){ return () => { a|=0; a=a+0x6D2B79F5|0; let t=Math.imul(a^a>>>15,1|a); t=t+Math.imul(t^t>>>7,61|t)^t; return ((t^t>>>14)>>>0)/4294967296; }; }
function hashStr(s){ let h=2166136261; for(let i=0;i<s.length;i++){ h^=s.charCodeAt(i); h=Math.imul(h,16777619); } return h>>>0; }

/* детерминированный сигил: seed = хеш строки. Один генератор на аватар узла,
   иконку скилла в окне и знак на канве — источник формы один. */
function sigilPath(seed){
  const rnd = mulberry32(hashStr(String(seed)));
  const arms = 3 + Math.floor(rnd()*3);
  let d = '';
  for(let a=0;a<arms;a++){
    let x = 50, y = 92 - a*6;
    const seg = 3 + Math.floor(rnd()*3);
    let path = `M ${x} ${y}`;
    for(let s=0;s<seg;s++){
      const dx = (10 + rnd()*22) * (rnd()<0.5?-1:1);
      const dy = -(12 + rnd()*20);
      x += dx*0.5; y += dy*0.6;
      path += ` L ${x.toFixed(1)} ${y.toFixed(1)}`;
      x += dx*0.5;
      path += ` L ${x.toFixed(1)} ${y.toFixed(1)}`;
    }
    d += path + ' ';
  }
  return d.trim();
}

/* Один «клин» строится рекурсивным ветвлением с ломаными сегментами.
   groups[d]: seg — тройки точек звена [x,y, mx,my, ex,ey, …], dots — концы
   звеньев [ex,ey, …] с радиусом r, pts — те же концы парами.
   polys — звенья трасс точками: по ним рисуется «прожиг» ветви. */
function buildWedge(seed, opts){
  const rnd = mulberry32(seed);
  const {depth, spread, decay, kink} = opts;
  const groups = Array.from({length:depth+1}, (_, d) => ({
    seg:[], dots:[], r:(0.006 + (depth-d)*0.0016) * (opts.dot || 1), pts:[]
  }));
  const paths = [];
  const polys = [];

  function branch(x,y,ang,len,d,trail,segs){
    if(d>depth) return;
    // ломаный сегмент: середина смещена в сторону — трайбл-ритм вместо прямой
    const mx = x + Math.cos(ang)*len*0.55 + Math.cos(ang+Math.PI/2)*len*kink*(rnd()<0.5?-1:1);
    const my = y + Math.sin(ang)*len*0.55 + Math.sin(ang+Math.PI/2)*len*kink*(rnd()<0.5?-1:1);
    const ex = x + Math.cos(ang)*len, ey = y + Math.sin(ang)*len;
    const g = groups[d];
    g.seg.push(x,y, mx,my, ex,ey);
    g.dots.push(ex,ey);
    g.pts.push([ex,ey]);
    const t2 = trail.concat([[ex,ey]]);
    const s2 = segs.concat([[[x,y],[mx,my],[ex,ey]]]);
    if(d===depth){ paths.push(t2); polys.push(s2); return; }
    const kids = rnd()<0.22 ? 3 : 2;
    for(let i=0;i<kids;i++){
      const off = (i - (kids-1)/2) * spread * (0.75 + rnd()*0.5);
      branch(ex, ey, ang+off, len*decay*(0.85+rnd()*0.3), d+1, t2, s2);
    }
  }
  branch(0,0,-Math.PI/2,0.30,0,[[0,0]],[]);
  return {groups, paths, polys};
}

/* Спина ветви — самая длинная корневая трасса клина. */
function spineOf(wedge){
  let best = 0, bd = -1;
  wedge.paths.forEach((p, i) => {
    const e = p[p.length-1], d = Math.hypot(e[0], e[1]);
    if(d > bd){ bd = d; best = i; }
  });
  return {pts: wedge.paths[best], polys: wedge.polys[best]};
}

/* Узлы садятся на вершины спины: кольца выбираются по радиусу, а не по
   номеру. polys узла — диапазон [from, to) звеньев спины. */
function skillsOf(spine, branches){
  const R = spine.pts.map(p => Math.hypot(p[0], p[1]));
  const skills = [];
  branches.forEach((br, b) => {
    const last = spine.pts.length - 1;
    const outer = last - 2;
    const n = br.idx.length, r0 = R[2], r1 = R[outer];
    let cursor = 1;
    const idxs = br.idx.map((_, k) => {
      const target = r0 + (r1 - r0)*k/(n - 1);
      let bi = Math.max(2, cursor + 1), bd = Infinity;
      for(let j = Math.max(2, cursor + 1); j <= outer - (n - 1 - k); j++){
        const d = Math.abs(R[j] - target);
        if(d < bd){ bd = d; bi = j; }
      }
      cursor = bi;
      return bi;
    });
    br.idx.forEach((ti, k) => {
      const idx = idxs[k];
      const p = spine.pts[idx];
      skills.push({i: ti, b, k, wx: p[0], wy: p[1], from: k === 0 ? 0 : idxs[k-1], to: idx});
    });
  });
  return skills;
}

/* габарит всех трёх лучей (с запасом под заголовки ветвей) */
function extentOf(skills){
  let h = 0.1, v = 0.1;
  skills.forEach(s => {
    const a = s.b*(Math.PI*2/MAND_S), ca = Math.cos(a), sa = Math.sin(a);
    const r = Math.hypot(s.wx, s.wy), rr = (r + 0.10)/(r || 1);
    const x = (s.wx*ca - s.wy*sa)*rr, y = (s.wx*sa + s.wy*ca)*rr;
    h = Math.max(h, Math.abs(x)); v = Math.max(v, Math.abs(y));
  });
  return {h, v};
}

/* Облако точек между ветвями: центры кружков по корзинам размера. */
function haloOf(wedge){
  const rnd = mulberry32(HALO_SEED);
  const span = Math.PI/MAND_S;
  const buckets = HALO_SIZES.map(s => ({s, pts:[]}));
  const D = wedge.groups.length;
  for(let d=2; d<D; d++){
    const pts = wedge.groups[d].pts;
    const step = d < 4 ? 1 : 2;
    for(let i=0;i<pts.length;i+=step){
      const r = Math.hypot(pts[i][0], pts[i][1]);
      if(r < 0.12) continue;
      const a0 = Math.atan2(pts[i][1], pts[i][0]);
      const n = 3 + Math.floor(rnd()*3);
      for(let k=0;k<n;k++){
        const u  = rnd();
        const da = (rnd()<0.5?-1:1) * span * u;
        const rr = r * (0.90 + rnd()*0.24);
        const x = Math.cos(a0+da)*rr, y = Math.sin(a0+da)*rr;
        const fall = Math.pow(1-u, 1.6);
        const bi = clamp(Math.round((1-fall)*(HALO_SIZES.length-1)), 0, HALO_SIZES.length-1);
        buckets[bi].pts.push(x, y);
      }
    }
  }
  return buckets;
}

/* Всё, от чего зависят числа сцены. Хэш этого описания — version ресурса. */
function inputsOf(economy){
  return {
    algorithm: ALGORITHM, symmetry: MAND_S,
    wedge: {seed: WEDGE_SEED, ...WEDGE_OPTS}, halo: {seed: HALO_SEED, sizes: HALO_SIZES},
    branches: economy.BRANCHES.map(b => b.idx),
    skills: economy.TIERS.map(t => t.skill)
  };
}
function versionOf(economy){
  return hashStr(JSON.stringify(inputsOf(economy))).toString(16).padStart(8, '0');
}

/* Полный расчёт сцены — в генераторе и как запасной путь страницы.
   Выбор спины и колец идёт на полной точности, как раньше; округляется
   только результат. */
function build(economy){
  const wedge = buildWedge(WEDGE_SEED, WEDGE_OPTS);
  const spine = spineOf(wedge);
  const skills = skillsOf(spine, economy.BRANCHES);
  const extent = extentOf(skills);
  return {
    version: versionOf(economy),
    groups: wedge.groups.map(g => ({seg: qa(g.seg), dots: qa(g.dots), r: g.r})),
    spine: {pts: spine.pts.map(qp), polys: spine.polys.map(poly => poly.map(qp))},
    skills: skills.map(s => ({...s, wx: q(s.wx), wy: q(s.wy)})),
    extent: {h: q(extent.h), v: q(extent.v)},
    halo: haloOf(wedge).map(b => ({s: b.s, pts: qa(b.pts)})),
    sigils: economy.TIERS.map(t => sigilPath('SKILL_' + t.skill))
  };
}

return {ALGORITHM, MAND_S, mulberry32, hashStr, sigilPath, buildWedge, build, versionOf, inputsOf};
});
