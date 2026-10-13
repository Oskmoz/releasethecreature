'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = Number(process.env.PORT) || 3000;
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
const STATE_FILE = path.join(DATA_DIR, 'state.json');
const PUBLIC_DIR = path.join(__dirname, 'public');
// Mode dev : outils de test (points, jauges, âge, lieux…). Double verrou : il faut DEV=1
// ET un NODE_ENV différent de "production" (l'image Docker fixe NODE_ENV=production).
const DEV = process.env.DEV === '1' && process.env.NODE_ENV !== 'production';
// Derrière Traefik, la vraie IP est la dernière entrée de X-Forwarded-For. Sans proxy (local),
// on ignore cet en-tête : sinon n'importe qui pourrait changer d'IP pour contourner les limites.
const TRUST_PROXY = process.env.TRUST_PROXY === '1';

// --- Limites anti-spam (par IP) ---
const LIMITS = {
  read: { burst: 40, perSec: 2 },   // GET /api/state (polling toutes les 5 s, plusieurs onglets OK)
  write: { burst: 15, perSec: 0.5 } // toutes les requêtes POST
};
const NEW_VISITORS_PER_IP_PER_DAY = 10; // limite la création d'identités (et donc des points de bienvenue)
const NICK_DAILY = 30;                  // changements de pseudo par jour et par visiteur
const LIKE_COOLDOWN = 800;              // ms entre deux likes d'un même visiteur
const LIKE_TOGGLES_PER_EVENT = 4;       // like/unlike répétés sur la même action

const H = 3600 * 1000;
const MIN = 60 * 1000;
// Vitesse de base à laquelle chaque jauge se vide (points par heure)
const RATE = {
  food: 100 / 14,  // 14 h de 100 à 0
  joy: 100 / 10,   // 10 h
  clean: 100 / 16, // 16 h
  fit: 100 / 12,   // 12 h
  sleep: 100 / 18  // 18 h
};
const STATS = Object.keys(RATE);
const GRACE_MS = 3 * H;         // survie à 0 de faim avant la mort
const COOLDOWN_MS = 20 * 1000;  // 1 action / 20 s / IP
const HATCH_DELAY_MS = 60 * 1000;
const NAP_MS = 4 * MIN;         // durée de la sieste après "bercer"
const MAX_EVENTS = 25;

// --- Points ---
const PTS_ACTION = 10;          // par action réussie
const PTS_WELCOME = 50;         // à la première visite
const PTS_PRESENCE = 1;         // par minute de présence
const PRESENCE_CAP = 180;       // points de présence max par jour et par visiteur
// --- Nettoyage des données (le fichier d'état est réécrit souvent : on le garde petit) ---
const VISITOR_TTL = 60 * 24 * H;      // visiteur actif : oublié après 60 jours sans venir
const DRIVEBY_TTL = 3 * 24 * H;       // simple passage sans rien faire : oublié après 3 jours
const MAX_VISITORS = 20000;           // plafond dur, on garde les plus récents
const EVENT_TTL = 3 * 24 * H;         // le journal ne garde que les 3 derniers jours (et 25 lignes max)
const SAVE_EVERY = 5 * 1000;          // au plus une écriture disque toutes les 5 s
// Passants bonus cliquables : rares, et plafonnés côté serveur pour qu'on ne puisse pas en abuser
const BONUS_PTS = 20;
const BONUS_COOLDOWN = 5 * MIN; // au plus un bonus toutes les 5 min par visiteur
const BONUS_DAILY = 6;          // et 6 par jour
const BONUS_KINDS = {
  skieur: 'un skieur', surfeur: 'un surfeur', astronaute: 'un astronaute', livreur: 'un livreur de pizza',
  lapin: 'un lapin', renard: 'un renard', drone: 'un drone', comete: 'une comète dorée'
};

// --- Lieux : multiplicateurs d'usure des jauges pendant un séjour ---
const STAY_MS = 3 * H;
const PLACES = {
  maison:   { name: 'à la maison', rates: {} },
  montagne: { name: 'à la montagne', cold: true, rates: { joy: 1.7, fit: 0.7, sleep: 1.2 } },
  plage:    { name: 'à la plage', rates: { clean: 2.2, sleep: 0.6, joy: 0.8 } },
  espace:   { name: 'dans l’espace', rates: { fit: 1.9, food: 1.3, sleep: 1.3 } },
  ville:    { name: 'en ville', rates: { joy: 0.7, food: 1.3, clean: 1.4, fit: 0.8 } }
};
const COLORS = { orange: 'orange', bleu: 'bleu', vert: 'vert', rose: 'rose', violet: 'violet', or: 'or' };
const ACCESSORIES = {
  chapeau: { slot: 'head', name: 'un chapeau haut-de-forme', short: 'le chapeau' },
  bonnet: { slot: 'head', name: 'un bonnet en laine', short: 'le bonnet' },
  couronne: { slot: 'head', name: 'une couronne', short: 'la couronne' },
  lunettes: { slot: 'face', name: 'des lunettes de soleil', short: 'les lunettes' },
  noeud: { slot: 'neck', name: 'un nœud papillon', short: 'le nœud papillon' },
  echarpe: { slot: 'neck', name: 'une écharpe', short: 'l’écharpe' }
};
// Catalogue envoyé tel quel au client (source de vérité côté serveur)
const SHOP = [
  { id: 'place:montagne', cat: 'lieux', name: 'Montagne', price: 300, desc: 'Séjour de 3 h. Il a froid : sa joie fond vite, il faut plus de câlins. Un bonnet ou une écharpe le protège.' },
  { id: 'place:plage', cat: 'lieux', name: 'Plage', price: 300, desc: 'Séjour de 3 h. Le sable le salit très vite, mais il dort mieux et s’ennuie moins.' },
  { id: 'place:espace', cat: 'lieux', name: 'Espace', price: 400, desc: 'Séjour de 3 h. En apesanteur il saute très haut, mais perd sa forme et a plus faim.' },
  { id: 'place:ville', cat: 'lieux', name: 'Ville', price: 300, desc: 'Séjour de 3 h. Balade en ville : il s’amuse beaucoup, mais la street food lui donne faim et la pollution le salit.' },
  { id: 'place:maison', cat: 'lieux', name: 'Retour maison', price: 100, desc: 'Écourter le séjour et le ramener chez lui.' },
  { id: 'color:orange', cat: 'couleurs', name: 'Orange', price: 100, desc: 'La couleur d’origine.' },
  { id: 'color:bleu', cat: 'couleurs', name: 'Bleu', price: 200, desc: 'Bleu océan.' },
  { id: 'color:vert', cat: 'couleurs', name: 'Vert', price: 200, desc: 'Vert jungle.' },
  { id: 'color:rose', cat: 'couleurs', name: 'Rose', price: 200, desc: 'Rose bonbon.' },
  { id: 'color:violet', cat: 'couleurs', name: 'Violet', price: 200, desc: 'Violet cosmique.' },
  { id: 'color:or', cat: 'couleurs', name: 'Or', price: 500, desc: 'Doré et brillant. Classe absolue.' },
  { id: 'acc:chapeau', cat: 'accessoires', slot: 'head', name: 'Chapeau', price: 150, desc: 'Haut-de-forme très distingué.' },
  { id: 'acc:bonnet', cat: 'accessoires', slot: 'head', name: 'Bonnet', price: 150, desc: 'Tout chaud. Le protège du froid à la montagne.' },
  { id: 'acc:couronne', cat: 'accessoires', slot: 'head', name: 'Couronne', price: 500, desc: 'Pour un roi. Ou une reine. Ou un dino.' },
  { id: 'acc:lunettes', cat: 'accessoires', slot: 'face', name: 'Lunettes', price: 150, desc: 'Lunettes de soleil. Trop stylé.' },
  { id: 'acc:noeud', cat: 'accessoires', slot: 'neck', name: 'Nœud pap', price: 150, desc: 'Nœud papillon rouge.' },
  { id: 'acc:echarpe', cat: 'accessoires', slot: 'neck', name: 'Écharpe', price: 150, desc: 'Écharpe rayée. Le protège du froid à la montagne.' },
  { id: 'unacc:head', cat: 'accessoires', slot: 'head', remove: true, name: 'Retirer la tête', price: 50, desc: 'Lui enlever son couvre-chef.' },
  { id: 'unacc:face', cat: 'accessoires', slot: 'face', remove: true, name: 'Retirer les lunettes', price: 50, desc: 'Lui enlever ses lunettes.' },
  { id: 'unacc:neck', cat: 'accessoires', slot: 'neck', remove: true, name: 'Retirer le cou', price: 50, desc: 'Lui enlever ce qu’il porte au cou.' }
];
const SHOP_BY_ID = Object.fromEntries(SHOP.map((i) => [i.id, i]));
// Délai minimum entre deux changements, par catégorie (la créature est commune à tous)
const BUY_COOLDOWN = { place: 20 * MIN, color: 10 * MIN, acc: 2 * MIN };

// Espèces : tirées au hasard à chaque éclosion
const SPECIES = { dino: 'un dino', phenix: 'un phénix', renard: 'un renard mystique' };
const NAMES = ['Rex', 'Kaiju', 'Draco', 'Ignis', 'Titan', 'Onyx', 'Orion', 'Nova', 'Atlas', 'Vulcain', 'Raptor', 'Zéphyr', 'Kairo', 'Sirius', 'Ragnar', 'Ember'];
const ACTIONS = {
  feed: {
    stat: 'food', gain: 25, side: {},
    msgs: [
      'a donné une chaussette à {n}. Il a adoré.',
      'a nourri {n} avec un croissant ramassé par terre.',
      'a lancé une pizza froide à {n}.',
      'a servi des spaghettis à {n}. Il les a fait rouler partout.',
      'a offert un cornichon à {n}. Il est ému.',
      'a glissé un post-it dans la bouche de {n}. Miam.'
    ],
    full: ['{n} n’a plus faim et vous regarde avec dégoût.', '{n} refuse de manger. Il est plein.']
  },
  pet: {
    stat: 'joy', gain: 20, side: {},
    msgs: [
      'a fait un câlin à {n}.',
      'a gratouillé le ventre de {n}. Il vibre.',
      'a raconté une blague nulle à {n}. Il a ri quand même.',
      'a chanté du Céline Dion à {n}.',
      'a fait coucou à {n}. {n} a fait coucou.',
      'a mis un petit chapeau à {n}. Il est magnifique.'
    ],
    full: ['{n} en a marre des câlins. Il veut de l’espace.']
  },
  wash: {
    stat: 'clean', gain: 35, side: { joy: -2 },
    msgs: [
      'a donné un bain moussant à {n}.',
      'a frotté le dos de {n} avec une brosse à dents.',
      'a passé {n} au jet d’eau. Il boude, mais il sent bon.',
      'a mis du shampoing à la fraise sur {n}.'
    ],
    full: ['{n} est déjà tout propre. Il s’ébroue, vexé.']
  },
  play: {
    stat: 'fit', gain: 30, side: { joy: 5, food: -4, sleep: -6 },
    msgs: [
      'a lancé une balle à {n}. Il l’a ramenée… enfin presque.',
      'a joué à chat avec {n}. {n} a triché.',
      'a fait une partie de foot avec {n}. 3 à 0 pour {n}.',
      'a fait danser {n} sur de la techno.'
    ],
    full: ['{n} est épuisé de jouer. Laissez-le souffler !']
  },
  rock: {
    stat: 'sleep', gain: 35, side: {}, nap: true,
    msgs: [
      'a bercé {n} en chantant une berceuse.',
      'a raconté une histoire à {n}. Il s’est endormi au milieu.',
      'a bordé {n} avec une couverture à pois.'
    ],
    full: ['{n} n’a pas sommeil et fait des grimaces.']
  }
};

// Pseudos : nom + adjectif choisis dans des listes fermées, numéro tiré au sort (pas de texte libre)
const NICK_NOUNS = ['Pixel', 'Comète', 'Raptor', 'Nova', 'Tigre', 'Faucon', 'Ninja', 'Pirate', 'Robot', 'Panda', 'Renard', 'Loup', 'Dragon', 'Kraken', 'Phénix', 'Yéti', 'Titan', 'Sphinx', 'Cobra', 'Lynx', 'Orque', 'Hibou', 'Koala', 'Golem'];
const NICK_ADJS = ['Rapide', 'Cosmique', 'Magique', 'Mystique', 'Électrique', 'Sauvage', 'Agile', 'Céleste', 'Héroïque', 'Turbo', 'Néon', 'Rétro', 'Atomique', 'Solaire', 'Lunaire', 'Polaire', 'Sonique', 'Épique', 'Stellaire', 'Zen'];
const NICK_COOLDOWN = 10 * 1000;

const pick = (a) => a[Math.floor(Math.random() * a.length)];
// Lecture sûre dans nos tables : "constructor", "__proto__"… ne doivent jamais être pris pour une clé valide
const own = (obj, k) => (typeof k === 'string' && Object.prototype.hasOwnProperty.call(obj, k) ? obj[k] : undefined);
const makeNick = (noun, adj) => noun + ' ' + adj + ' ' + (1 + Math.floor(Math.random() * 99));
const actor = (v) => (v ? v.nick : 'Un visiteur');
const clamp = (x) => Math.max(0, Math.min(100, x));
const fill = (s) => s.replace(/\{n\}/g, state.name);

function newCreature(now, best) {
  return {
    name: pick(NAMES), species: pick(Object.keys(SPECIES)), born: now, t: now,
    food: 70, joy: 70, clean: 70, fit: 70, sleep: 70,
    zeroAt: null, deadAt: null, hatchableAt: null, actions: 0,
    asleepUntil: 0, place: null, color: 'orange', acc: {},
    lastBuy: {}, best: best || null, events: [], eventSeq: (state && state.eventSeq) || 0
  };
}

let state;
try {
  state = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
} catch {
  state = newCreature(Date.now());
  addEvent('Un œuf vient d’éclore : c’est ' + SPECIES[state.species] + ' ! Bonjour, ' + state.name + ' !', Date.now());
}
// Migration des anciens fichiers d'état
for (const k of STATS) if (typeof state[k] !== 'number') state[k] = 70;
const defaults = { species: 'dino', asleepUntil: 0, place: null, color: 'orange', acc: {}, lastBuy: {}, zeroAt: null };
for (const k in defaults) if (state[k] === undefined) state[k] = defaults[k];
if (!state.zeroAt && !state.deadAt && state.food <= 0) state.zeroAt = state.t;
let visitors = state.visitors || {};
// Migration : un visiteur qui a déjà gagné ou dépensé des points compte comme joueur (gardé 60 jours)
for (const id in visitors) { const v = visitors[id]; if (v.acted === undefined) v.acted = v.pts !== PTS_WELCOME || !!v.lastNick || !!v.lastBonus; }
if (!state.eventSeq) state.eventSeq = 0;
for (const e of state.events) if (!e.id) { e.id = ++state.eventSeq; e.author = null; e.likers = []; }
delete state.visitors;

function addEvent(text, ts, author) {
  state.events.unshift({ id: ++state.eventSeq, ts, text, author: author || null, likers: [] });
  state.events.length = Math.min(state.events.length, MAX_EVENTS);
}

let saveTimer = null;
function save() {
  if (saveTimer) return;
  saveTimer = setTimeout(() => {
    saveTimer = null;
    writeState();
  }, SAVE_EVERY);
}
function writeState() {
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    const tmp = STATE_FILE + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify({ ...state, visitors }));
    fs.renameSync(tmp, STATE_FILE);
  } catch (e) { console.error('save failed', e.message); }
}

// Vitesse d'usure de chaque jauge à l'instant t (lieu, accessoires, sieste, malus)
function rates(t) {
  const place = PLACES[state.place ? state.place.key : 'maison'];
  const r = {};
  for (const k of STATS) r[k] = RATE[k] * (place.rates[k] || 1);
  if (place.cold && (state.acc.head === 'bonnet' || state.acc.neck === 'echarpe')) r.joy = RATE.joy * (1 + (place.rates.joy - 1) * 0.3);
  if (state.asleepUntil > t) { r.sleep = 0; r.joy *= 0.5; }
  // Sale, épuisé ou mou : il s'ennuie plus vite
  let m = 1;
  if (state.clean < 20) m += 0.3;
  if (state.sleep < 20) m += 0.3;
  if (state.fit < 20) m += 0.2;
  r.joy *= m;
  return r;
}

function decay(t0, t1) {
  const h = (t1 - t0) / H, r = rates(t0);
  const f0 = state.food;
  state.food = Math.max(0, f0 - h * r.food);
  if (state.food === 0 && !state.zeroAt) state.zeroAt = t0 + (r.food > 0 ? (f0 / r.food) * H : 0);
  for (const k of STATS) if (k !== 'food') state[k] = clamp(state[k] - h * r[k]);
}

function die() {
  state.deadAt = state.zeroAt + GRACE_MS;
  for (const k of STATS) state[k] = 0;
  state.hatchableAt = state.deadAt + HATCH_DELAY_MS;
  const lived = state.deadAt - state.born;
  if (!state.best || lived > state.best.ms) state.best = { name: state.name, ms: lived };
  addEvent(state.name + ' est mort de faim. Bravo à tous.', state.deadAt);
}

// Met l'état à jour jusqu'à "now", par segments (fin de séjour, fin de sieste)
function settle(now) {
  if (state.deadAt) return;
  let t = state.t;
  while (t < now) {
    let end = now;
    if (state.place && state.place.until > t && state.place.until < end) end = state.place.until;
    if (state.asleepUntil > t && state.asleepUntil < end) end = state.asleepUntil;
    decay(t, end);
    if (state.zeroAt && state.zeroAt + GRACE_MS <= end) { die(); break; }
    t = end;
    if (state.place && t >= state.place.until) {
      addEvent(state.name + ' est rentré à la maison.', state.place.until);
      state.place = null;
    }
  }
  state.t = now;
  save();
}

function view(now, vid) {
  settle(now);
  const s = state, v = vid && own(visitors, vid);
  const out = {
    name: s.name, species: s.species, born: s.born, dead: !!s.deadAt, deadAt: s.deadAt, canHatchAt: s.hatchableAt,
    actions: s.actions, best: s.best, now, cooldownMs: COOLDOWN_MS,
    events: s.events.map((e) => ({
      id: e.id, ts: e.ts, text: e.text, likes: e.likers.length,
      likable: !!e.author, mine: !!vid && e.author === vid, liked: !!vid && e.likers.includes(vid)
    })),
    nickParts: { nouns: NICK_NOUNS, adjs: NICK_ADJS },
    asleepUntil: s.asleepUntil, place: s.place, color: s.color, acc: s.acc,
    buyCooldown: {}, shop: SHOP, me: v ? { pts: v.pts, nick: v.nick, ...bonusInfo(v, now) } : null, dev: DEV
  };
  for (const k of STATS) out[k] = Math.round(s[k]);
  for (const c in BUY_COOLDOWN) out.buyCooldown[c] = (s.lastBuy[c] || 0) + BUY_COOLDOWN[c];
  return out;
}

// --- Visiteurs anonymes (id aléatoire généré par le navigateur) ---
function visitorId(req) {
  const id = req.headers['x-visitor'];
  return typeof id === 'string' && /^[a-z0-9]{16,40}$/i.test(id) ? id : null;
}
function visitor(id, now, req) {
  if (!id) return null;
  let v = own(visitors, id);
  if (!v) {
    // Nouvelle identité : plafonnée par IP pour empêcher de farmer les points de bienvenue
    const ip = req ? clientIp(req) : 'unknown', day = new Date(now).toISOString().slice(0, 10);
    let c = newVisitorsByIp.get(ip);
    if (!c || c.day !== day) { c = { day, n: 0 }; newVisitorsByIp.set(ip, c); }
    if (c.n >= NEW_VISITORS_PER_IP_PER_DAY) return null;
    c.n++;
    v = visitors[id] = { pts: PTS_WELCOME, seen: now, lastPing: 0, day: '', dayPts: 0 };
  }
  if (!v.nick) v.nick = makeNick(pick(NICK_NOUNS), pick(NICK_ADJS));
  v.seen = now;
  return v;
}
// Nettoyage : visiteurs inactifs, visiteurs de passage, plafond global, vieilles lignes du journal
function cleanup() {
  const now = Date.now();
  let removed = 0;
  for (const id in visitors) {
    const v = visitors[id];
    if (v.seen < now - VISITOR_TTL || (!v.acted && v.seen < now - DRIVEBY_TTL)) { delete visitors[id]; removed++; }
  }
  const ids = Object.keys(visitors);
  if (ids.length > MAX_VISITORS) {
    ids.sort((a, b) => visitors[a].seen - visitors[b].seen);
    for (const id of ids.slice(0, ids.length - MAX_VISITORS)) { delete visitors[id]; removed++; }
  }
  const before = state.events.length;
  state.events = state.events.filter((e) => e.ts >= now - EVENT_TTL);
  if (removed || state.events.length !== before) {
    console.log('nettoyage : ' + removed + ' visiteur(s), ' + (before - state.events.length) + ' ligne(s) de journal');
    save();
  }
}
cleanup();
setInterval(cleanup, H).unref();

// Anti-spam : dernière action par IP (la dernière entrée de X-Forwarded-For
// est celle ajoutée par Traefik, donc non falsifiable par le client).
const lastAction = new Map();
function clientIp(req) {
  const xff = req.headers['x-forwarded-for'];
  if (TRUST_PROXY && typeof xff === 'string' && xff) return xff.split(',').pop().trim();
  return req.socket.remoteAddress || 'unknown';
}

// Seau à jetons par IP : on autorise des rafales courtes, puis un débit moyen
const buckets = new Map();
function allow(ip, kind) {
  const lim = LIMITS[kind], key = kind + ':' + ip, now = Date.now();
  let b = buckets.get(key);
  if (!b) { b = { tokens: lim.burst, t: now }; buckets.set(key, b); }
  b.tokens = Math.min(lim.burst, b.tokens + ((now - b.t) / 1000) * lim.perSec);
  b.t = now;
  if (b.tokens < 1) return false;
  b.tokens -= 1;
  return true;
}
const newVisitorsByIp = new Map(); // ip -> { day, n }
const likeToggles = new Map();     // vid:eventId -> nombre de like/unlike
setInterval(() => {
  const now = Date.now();
  for (const [k, b] of buckets) if (now - b.t > 10 * MIN) buckets.delete(k);
  const day = new Date(now).toISOString().slice(0, 10);
  for (const [ip, c] of newVisitorsByIp) if (c.day !== day) newVisitorsByIp.delete(ip);
  if (likeToggles.size > 50000) likeToggles.clear();
}, MIN).unref();
setInterval(() => {
  const limit = Date.now() - COOLDOWN_MS;
  for (const [ip, t] of lastAction) if (t < limit) lastAction.delete(ip);
}, 60 * 1000).unref();

const SECURITY_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'no-referrer',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Content-Security-Policy': [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "font-src https://fonts.gstatic.com",
    "img-src 'self' data:",
    "connect-src 'self'",
    "frame-ancestors 'none'",
    "base-uri 'none'",
    "form-action 'none'"
  ].join('; ')
};
// HSTS : force le HTTPS chez le navigateur, seulement si la requête est bien arrivée en HTTPS via le proxy
function secHeaders(req) {
  return TRUST_PROXY && req && req.headers['x-forwarded-proto'] === 'https'
    ? { ...SECURITY_HEADERS, 'Strict-Transport-Security': 'max-age=31536000' } : SECURITY_HEADERS;
}
function send(res, code, obj) {
  if (res.headersSent) return;
  const body = JSON.stringify(obj);
  res.writeHead(code, { ...SECURITY_HEADERS, 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(body);
}

function act(req, res, kind) {
  const now = Date.now();
  const ip = clientIp(req), vid = visitorId(req), v = visitor(vid, now, req);
  const wait = (lastAction.get(ip) || 0) + COOLDOWN_MS - now;
  if (wait > 0) return send(res, 429, { error: 'cooldown', retryMs: wait, ...view(now, vid) });
  settle(now);
  if (state.deadAt) return send(res, 409, { error: 'dead', ...view(now, vid) });
  lastAction.set(ip, now);
  state.actions++;
  const a = ACTIONS[kind];
  if (state[a.stat] > 92) {
    state.joy = clamp(state.joy - 8);
    addEvent(fill(pick(a.full)), now);
  } else {
    state[a.stat] = clamp(state[a.stat] + a.gain);
    for (const k in a.side) state[k] = clamp(state[k] + a.side[k]);
    if (state.food > 0) state.zeroAt = null;
    if (a.nap) state.asleepUntil = now + NAP_MS;
    else if (state.asleepUntil > now) state.asleepUntil = now; // on le réveille
    addEvent(actor(v) + ' ' + fill(pick(a.msgs)), now, vid);
    if (v) { v.pts += PTS_ACTION; v.acted = true; }
  }
  save();
  send(res, 200, { gained: v ? PTS_ACTION : 0, ...view(now, vid) });
}

function hatch(req, res) {
  const now = Date.now(), vid = visitorId(req), v = visitor(vid, now, req);
  settle(now);
  if (!state.deadAt) return send(res, 409, { error: 'alive', ...view(now, vid) });
  if (now < state.hatchableAt) return send(res, 429, { error: 'too_early', ...view(now, vid) });
  const best = state.best;
  state = newCreature(now, best);
  addEvent(actor(v) + ' a fait éclore un œuf : c’est ' + SPECIES[state.species] + ' ! Bonjour, ' + state.name + ' !', now, vid);
  save();
  send(res, 200, view(now, vid));
}

// Présence : 1 point par minute passée sur le site, plafonné par jour
function ping(req, res) {
  const now = Date.now(), vid = visitorId(req), v = visitor(vid, now, req);
  let gained = 0;
  if (v && now - v.lastPing >= 55 * 1000) {
    const day = new Date(now).toISOString().slice(0, 10);
    if (v.day !== day) { v.day = day; v.dayPts = 0; }
    if (v.dayPts < PRESENCE_CAP) { v.pts += PTS_PRESENCE; v.dayPts += PTS_PRESENCE; gained = PTS_PRESENCE; v.acted = true; }
    v.lastPing = now;
    save();
  }
  send(res, 200, { gained, ...view(now, vid) });
}

function today(now) { return new Date(now).toISOString().slice(0, 10); }
function bonusInfo(v, now) {
  const left = v.bonusDay === today(now) ? Math.max(0, BONUS_DAILY - (v.bonusCount || 0)) : BONUS_DAILY;
  return { bonusAt: (v.lastBonus || 0) + BONUS_COOLDOWN, bonusLeft: left };
}
function bonus(req, res, body) {
  const now = Date.now(), vid = visitorId(req), v = visitor(vid, now, req);
  const label = body && own(BONUS_KINDS, body.kind);
  if (!label || !v) return send(res, 400, { error: 'bad_request', ...view(now, vid) });
  const day = today(now);
  if (v.bonusDay !== day) { v.bonusDay = day; v.bonusCount = 0; }
  if (v.bonusCount >= BONUS_DAILY) return send(res, 429, { error: 'limit', ...view(now, vid) });
  if (now - (v.lastBonus || 0) < BONUS_COOLDOWN) return send(res, 429, { error: 'cooldown', ...view(now, vid) });
  v.lastBonus = now; v.bonusCount++; v.pts += BONUS_PTS; v.acted = true;
  addEvent(actor(v) + ' a attrapé ' + label + ' au vol ! (+' + BONUS_PTS + ' pts)', now, vid);
  save();
  send(res, 200, { gained: BONUS_PTS, ...view(now, vid) });
}

function buy(req, res, body) {
  const now = Date.now(), vid = visitorId(req), v = visitor(vid, now, req);
  const item = own(SHOP_BY_ID, body && body.item);
  if (!item) return send(res, 400, { error: 'unknown', ...view(now, vid) });
  if (!v) return send(res, 400, { error: 'no_visitor', ...view(now, vid) });
  settle(now);
  if (state.deadAt) return send(res, 409, { error: 'dead', ...view(now, vid) });
  const [type, key] = item.id.split(':');
  const cat = type === 'unacc' ? 'acc' : type;
  const until = (state.lastBuy[cat] || 0) + BUY_COOLDOWN[cat];
  if (now < until) return send(res, 429, { error: 'cooldown', retryMs: until - now, ...view(now, vid) });
  if (v.pts < item.price) return send(res, 402, { error: 'points', ...view(now, vid) });

  let text;
  if (type === 'place') {
    if (key === 'maison') {
      if (!state.place) return send(res, 409, { error: 'already', ...view(now, vid) });
      state.place = null;
      text = actor(v) + ' a ramené ' + state.name + ' à la maison.';
    } else {
      if (state.place && state.place.key === key) return send(res, 409, { error: 'already', ...view(now, vid) });
      state.place = { key, until: now + STAY_MS };
      text = actor(v) + ' a emmené ' + state.name + ' ' + PLACES[key].name + ' pour 3 h !';
    }
  } else if (type === 'color') {
    if (state.color === key) return send(res, 409, { error: 'already', ...view(now, vid) });
    state.color = COLORS[key];
    text = actor(v) + ' a repeint ' + state.name + ' en ' + key + '.';
  } else if (type === 'acc') {
    const a = ACCESSORIES[key];
    if (state.acc[a.slot] === key) return send(res, 409, { error: 'already', ...view(now, vid) });
    state.acc[a.slot] = key;
    text = actor(v) + ' a offert ' + a.name + ' à ' + state.name + '.';
  } else {
    const cur = state.acc[key];
    if (!cur) return send(res, 409, { error: 'already', ...view(now, vid) });
    delete state.acc[key];
    text = actor(v) + ' a retiré ' + ACCESSORIES[cur].short + ' de ' + state.name + '.';
  }
  v.pts -= item.price; v.acted = true;
  state.lastBuy[cat] = now;
  addEvent(text, now, vid);
  save();
  send(res, 200, view(now, vid));
}

// --- Outils de dev (inaccessibles hors mode dev : la route répond 404) ---
function devTool(req, res, body) {
  const now = Date.now(), vid = visitorId(req), v = visitor(vid, now, req);
  if (!body || typeof body.op !== 'string') return send(res, 400, { error: 'bad_request' });
  settle(now);
  const num = (x, def) => (typeof x === 'number' && isFinite(x) ? x : def);
  switch (body.op) {
    case 'points': if (v) v.pts = Math.max(0, Math.round(num(body.pts, 1000))); break;
    case 'stats':
      if (state.deadAt) break;
      for (const k of STATS) if (typeof body[k] === 'number') state[k] = clamp(body[k]);
      state.zeroAt = state.food > 0 ? null : now;
      break;
    case 'age': state.born = now - num(body.hours, 0) * H; break;
    case 'place':
      if (state.deadAt) break;
      state.place = own(PLACES, body.key) && body.key !== 'maison' ? { key: body.key, until: now + num(body.minutes, 180) * MIN } : null;
      break;
    case 'species': if (own(SPECIES, body.species)) state.species = body.species; break;
    case 'nap': if (!state.deadAt) state.asleepUntil = now + NAP_MS; break;
    case 'cooldowns': state.lastBuy = {}; lastAction.delete(clientIp(req)); if (v) { v.lastBonus = 0; v.bonusCount = 0; } break;
    case 'kill': if (!state.deadAt) { state.zeroAt = now - GRACE_MS; die(); state.hatchableAt = now + 5000; } break;
    default: return send(res, 400, { error: 'unknown_op' });
  }
  addEvent('[DEV] ' + body.op, now);
  save();
  send(res, 200, view(now, vid));
}

function setNick(req, res, body) {
  const now = Date.now(), vid = visitorId(req), v = visitor(vid, now, req);
  if (!v || !body || !NICK_NOUNS.includes(body.noun) || !NICK_ADJS.includes(body.adj)) return send(res, 400, { error: 'bad_request', ...view(now, vid) });
  if (now - (v.lastNick || 0) < NICK_COOLDOWN) return send(res, 429, { error: 'cooldown', ...view(now, vid) });
  const day = today(now);
  if (v.nickDay !== day) { v.nickDay = day; v.nickCount = 0; }
  if (v.nickCount >= NICK_DAILY) return send(res, 429, { error: 'limit', ...view(now, vid) });
  v.nick = makeNick(body.noun, body.adj);
  v.lastNick = now; v.nickCount++; v.acted = true;
  save();
  send(res, 200, view(now, vid));
}

// Like / unlike d'une action d'un autre joueur (pas de points en jeu : rien à gagner à tricher)
function like(req, res, body) {
  const now = Date.now(), vid = visitorId(req), v = visitor(vid, now, req);
  const ev = body && typeof body.id === 'number' && state.events.find((e) => e.id === body.id);
  if (!v || !ev || !ev.author) return send(res, 400, { error: 'bad_request', ...view(now, vid) });
  if (ev.author === vid) return send(res, 409, { error: 'own', ...view(now, vid) });
  if (now - (v.lastLike || 0) < LIKE_COOLDOWN) return send(res, 429, { error: 'cooldown', ...view(now, vid) });
  const tk = vid + ':' + ev.id, toggles = likeToggles.get(tk) || 0;
  if (toggles >= LIKE_TOGGLES_PER_EVENT) return send(res, 429, { error: 'limit', ...view(now, vid) });
  likeToggles.set(tk, toggles + 1);
  v.lastLike = now; v.acted = true;
  const i = ev.likers.indexOf(vid);
  if (i >= 0) ev.likers.splice(i, 1); else ev.likers.push(vid);
  save();
  send(res, 200, view(now, vid));
}

function readJson(req, res, cb) {
  let data = '', tooBig = false;
  req.on('data', (c) => {
    if (tooBig) return;
    data += c;
    if (data.length > 2048) { tooBig = true; send(res, 413, { error: 'too_large' }); req.destroy(); }
  });
  req.on('end', () => {
    if (tooBig) return;
    let body = null;
    try { body = JSON.parse(data || '{}'); } catch { body = null; }
    if (!body || typeof body !== 'object' || Array.isArray(body)) return send(res, 400, { error: 'bad_json' });
    safe(res, () => cb(body));
  });
}
// Une erreur inattendue dans un handler ne doit jamais faire tomber tout le serveur
function safe(res, fn) {
  try { fn(); } catch (e) {
    console.error('handler error', e);
    if (!res.headersSent) send(res, 500, { error: 'server_error' });
  }
}

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css', '.svg': 'image/svg+xml', '.ico': 'image/x-icon' };

const server = http.createServer((req, res) => safe(res, () => route(req, res)));
// Garde-fous contre les connexions lentes ou abusives
server.headersTimeout = 10 * 1000;
server.requestTimeout = 15 * 1000;
server.keepAliveTimeout = 5 * 1000;
server.maxHeadersCount = 50;

function route(req, res) {
  const url = req.url.split('?')[0];
  if (url.startsWith('/api/')) {
    const ip = clientIp(req);
    if (!allow(ip, req.method === 'GET' ? 'read' : 'write')) return send(res, 429, { error: 'rate_limited' });
    if (req.method === 'POST') {
      // Anti-CSRF : un autre site ne peut pas poster ici (il faudrait l'en-tête X-Visitor, que les navigateurs
      // refusent d'envoyer en cross-origin sans autorisation CORS, et l'origine doit être la nôtre)
      const origin = req.headers.origin;
      if (origin && origin.replace(/^https?:\/\//, '') !== req.headers.host) return send(res, 403, { error: 'bad_origin' });
      if (!visitorId(req)) return send(res, 400, { error: 'no_visitor' });
    }
    if (req.method === 'GET' && url === '/api/state') { visitor(visitorId(req), Date.now(), req); return send(res, 200, view(Date.now(), visitorId(req))); }
    if (req.method === 'POST') {
      const name = url.slice(5);
      if (own(ACTIONS, name)) return act(req, res, name);
      if (name === 'hatch') return hatch(req, res);
      if (name === 'ping') return ping(req, res);
      if (name === 'buy') return readJson(req, res, (body) => buy(req, res, body));
      if (name === 'bonus') return readJson(req, res, (body) => bonus(req, res, body));
      if (name === 'nick') return readJson(req, res, (body) => setNick(req, res, body));
      if (name === 'like') return readJson(req, res, (body) => like(req, res, body));
      if (DEV && name === 'dev') return readJson(req, res, (body) => devTool(req, res, body));
    }
    return send(res, 404, { error: 'not_found' });
  }
  if (req.method === 'GET' && url === '/healthz') { res.writeHead(200); return res.end('ok'); }
  if (req.method === 'GET' || req.method === 'HEAD') {
    const rel = url === '/' ? 'index.html' : url.slice(1);
    const file = path.join(PUBLIC_DIR, path.normalize(rel));
    if (file.startsWith(PUBLIC_DIR + path.sep) && fs.existsSync(file) && fs.statSync(file).isFile()) {
      res.writeHead(200, { ...secHeaders(req), 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
      if (req.method === 'HEAD') return res.end();
      return fs.createReadStream(file).pipe(res);
    }
  }
  res.writeHead(404, SECURITY_HEADERS); res.end('not found');
}

server.listen(PORT, () => {
  console.log('creature on :' + PORT);
  if (DEV) console.warn('\n  ⚠  MODE DEV ACTIF : outils de triche disponibles sur /api/dev. Ne jamais utiliser en prod.\n  données : ' + DATA_DIR + '\n');
});

for (const sig of ['SIGTERM', 'SIGINT']) {
  process.on(sig, () => {
    writeState();
    process.exit(0);
  });
}
