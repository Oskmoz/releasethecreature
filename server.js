'use strict';
const http = require('http');
const crypto = require('crypto');
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
// Admin (prod comprise) : les mêmes outils que le mode dev, réservés à qui connaît ADMIN_TOKEN.
// Le jeton ne quitte jamais le serveur : le client le saisit une fois et l'envoie dans l'en-tête X-Admin.
// Trop court ou absent = admin désactivé (32 caractères minimum, ex. : openssl rand -hex 32).
const ADMIN_TOKEN = (process.env.ADMIN_TOKEN || '').length >= 32 ? process.env.ADMIN_TOKEN : null;
if (process.env.ADMIN_TOKEN && !ADMIN_TOKEN) console.warn('ADMIN_TOKEN ignoré : 32 caractères minimum');
// Google Analytics : désactivé tant que GA_ID n'est pas défini (format G-XXXXXXX vérifié).
// Les domaines de Google ne sont autorisés dans la CSP que dans ce cas, et le client ne charge
// le script qu'après le consentement du visiteur (bandeau cookies).
// Adresse publique du site (balises canonical/partage, robots.txt, sitemap) : SITE_URL, sinon https://DOMAIN
const SITE_URL = (() => {
  const u = process.env.SITE_URL || (process.env.DOMAIN ? 'https://' + process.env.DOMAIN : '');
  return /^https?:\/\/[a-z0-9.-]+(:\d+)?$/i.test(u) ? u : '';
})();
const GA_ID = /^G-[A-Z0-9]{4,15}$/.test(process.env.GA_ID || '') ? process.env.GA_ID : null;
if (process.env.GA_ID && !GA_ID) console.warn('GA_ID ignoré : format attendu G-XXXXXXXXXX');

// --- Limites anti-spam (par IP) ---
const LIMITS = {
  read: { burst: 40, perSec: 2 },   // GET /api/state (polling toutes les 5 s, plusieurs onglets OK)
  write: { burst: 15, perSec: 0.5 } // toutes les requêtes POST
};
const NEW_VISITORS_PER_IP_PER_DAY = 10; // limite la création d'identités (et donc des points de bienvenue)
const NICK_DAILY = 30;                  // changements de pseudo par jour et par visiteur
const LIKE_COOLDOWN = 800;              // ms entre deux likes d'un même visiteur
const LIKE_TOGGLES_PER_EVENT = 4;       // like/unlike répétés sur la même action
// Points au toucher (tap / clic sur le décor) : plafonnés pour qu'un auto-clicker ne rapporte pas plus qu'un humain
const TAPS_PER_PT = 10;                 // 10 touches = 1 point
const TAP_RATE = 8;                     // touches par seconde comptées au maximum (un humain rapide)
const TAP_DAILY = 100;                  // points de toucher max par jour et par visiteur
const LEADERS_TTL = 15 * 1000;          // les classements des joueurs sont recalculés au plus toutes les 15 s

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
// Métamorphose : un œuf mystère remplace la créature, l'espèce est tirée au hasard (jamais la même).
// Elle repart au niveau 1 et sa vie actuelle entre au Panthéon.
const MORPH_PRICE = 2000;
SHOP.push({ id: 'morph:egg', cat: 'metamorphose', name: 'Œuf mystère', price: MORPH_PRICE, desc: 'Transforme la créature en œuf : il en sortira une espèce au hasard, différente de l’actuelle (peut-être l’épique ?). Retour au niveau 1.' });
const SHOP_BY_ID = Object.fromEntries(SHOP.map((i) => [i.id, i]));
// Délai minimum entre deux changements, par catégorie (la créature est commune à tous)
const BUY_COOLDOWN = { place: 20 * MIN, color: 10 * MIN, acc: 2 * MIN, morph: 6 * H };

// Espèces : tirées au hasard à chaque éclosion. weight = chances relatives (Horus est la créature épique, plus rare)
const SPECIES = { dino: 'un dino', phenix: 'un phénix', renard: 'un renard mystique', lezard: 'un lézard géant', meduse: 'une gorgone', horus: 'ÉPIQUE : un dieu-faucon', lapin: 'un lapin de combat', requin: 'un requin des terres' };
const SPECIES_WEIGHT = { dino: 4, phenix: 4, renard: 4, lezard: 4, meduse: 4, lapin: 4, requin: 4, horus: 1 };
const EPIC = { horus: true };
function pickSpecies(not) {
  const keys = Object.keys(SPECIES).filter((k) => k !== not), total = keys.reduce((n, k) => n + SPECIES_WEIGHT[k], 0);
  let r = Math.random() * total;
  for (const k of keys) { r -= SPECIES_WEIGHT[k]; if (r < 0) return k; }
  return keys[0];
}
// Noms tirés au hasard à chaque éclosion
const NAMES = [
  // classiques
  'Rex', 'Kaiju', 'Draco', 'Ignis', 'Titan', 'Onyx', 'Orion', 'Nova', 'Atlas', 'Vulcain', 'Raptor', 'Zéphyr', 'Kairo', 'Sirius', 'Ragnar', 'Ember',
  // planètes, lunes et étoiles
  'Mercure', 'Vénus', 'Mars', 'Jupiter', 'Saturne', 'Uranus', 'Neptune', 'Pluton', 'Cérès', 'Éris', 'Titania', 'Europe', 'Io', 'Ganymède', 'Callisto',
  'Encelade', 'Triton', 'Phobos', 'Déimos', 'Obéron', 'Rhéa', 'Téthys', 'Hypérion', 'Véga', 'Altaïr', 'Rigel', 'Bételgeuse', 'Antarès', 'Aldébaran',
  'Polaris', 'Capella', 'Andromède', 'Cassiopée', 'Pégase', 'Lyra', 'Draconis', 'Quasar', 'Pulsar', 'Nébula', 'Cosmo', 'Galaxie', 'Comète', 'Astéro',
  // créatures de légende
  'Godzilla', 'Kong', 'Nessie', 'Yéti', 'Bigfoot', 'Kraken', 'Hydre', 'Griffon', 'Chimère', 'Basilic', 'Wyvern', 'Golem', 'Gargouille', 'Minotaure',
  'Cerbère', 'Léviathan', 'Béhémoth', 'Sphinx', 'Pégasus', 'Fenrir', 'Jormungand', 'Tarasque', 'Mothra', 'Rodan', 'Chupacabra', 'Wendigo', 'Kitsune',
  'Tengu', 'Naga', 'Quetzal', 'Banshee', 'Djinn', 'Troll', 'Ogre', 'Gobelin', 'Lutin', 'Farfadet',
  // héros et dieux
  'Zeus', 'Thor', 'Odin', 'Loki', 'Hercule', 'Achille', 'Apollon', 'Artémis', 'Athéna', 'Hermès', 'Anubis', 'Râ', 'Osiris', 'Bastet', 'Freya',
  'Merlin', 'Arthur', 'Lancelot', 'Excalibur', 'Gilgamesh', 'Ulysse', 'Persée', 'Thésée', 'Icare', 'Prométhée',
  // gentiment ridicules
  'Cornichon', 'Bidule', 'Machin', 'Patapouf', 'Choupette', 'Grumeau', 'Brioche', 'Pistache', 'Nugget', 'Croquette', 'Cacahuète', 'Moustache',
  'Gribouille', 'Pompon', 'Biscotte', 'Raclette', 'Tartiflette', 'Saucisse', 'Bretzel', 'Waffle', 'Mochi', 'Tofu', 'Wasabi', 'Sushi', 'Ramen',
  'Pixel', 'Bitoniau', 'Zigouigoui', 'Chouquette', 'Barnabé', 'Gaston', 'Marcel', 'Gérard', 'Josiane', 'Ginette', 'Roger', 'Jean-Claude',
  // sonores
  'Bzzt', 'Kaboum', 'Zorglub', 'Grominet', 'Zigzag', 'Tornado', 'Tsunami', 'Blizzard', 'Typhon', 'Volcan', 'Séisme', 'Éclair', 'Tonnerre',
  'Obsidienne', 'Quartz', 'Jade', 'Rubis', 'Saphir', 'Topaze', 'Cobalt', 'Titane', 'Néon', 'Argon', 'Krypton', 'Xénon', 'Radon'
];
// Messages du journal (une centaine par action) : voir messages.js
const MESSAGES = require('./messages');
const ACTIONS = {
  feed: {
    stat: 'food', gain: 25, side: {},
    ...MESSAGES.feed
  },
  pet: {
    stat: 'joy', gain: 20, side: {},
    ...MESSAGES.pet
  },
  wash: {
    stat: 'clean', gain: 35, side: { joy: -2 },
    ...MESSAGES.wash
  },
  play: {
    stat: 'fit', gain: 30, side: { joy: 5, food: -4, sleep: -6 },
    ...MESSAGES.play
  },
  rock: {
    stat: 'sleep', gain: 35, side: {}, nap: true,
    ...MESSAGES.rock
  },
  heal: {
    stat: null, gain: 25, side: {}, // stat null : la jauge la plus basse au moment du soin
    ...MESSAGES.heal
  }
};
// Jauge la plus basse (cible du soin)
const lowestStat = () => STATS.reduce((a, k) => (state[k] < state[a] ? k : a), STATS[0]);

// Pseudos : nom + adjectif choisis dans des listes fermées, numéro tiré au sort (pas de texte libre)
const NICK_NOUNS = ['Pixel', 'Comète', 'Raptor', 'Nova', 'Tigre', 'Faucon', 'Ninja', 'Pirate', 'Robot', 'Panda', 'Renard', 'Loup', 'Dragon', 'Kraken', 'Phénix', 'Yéti', 'Titan', 'Sphinx', 'Cobra', 'Lynx', 'Orque', 'Hibou', 'Koala', 'Golem'];
const NICK_ADJS = ['Rapide', 'Cosmique', 'Magique', 'Mystique', 'Électrique', 'Sauvage', 'Agile', 'Céleste', 'Héroïque', 'Turbo', 'Néon', 'Rétro', 'Atomique', 'Solaire', 'Lunaire', 'Polaire', 'Sonique', 'Épique', 'Stellaire', 'Zen'];
const NICK_COOLDOWN = 10 * 1000;

// --- Hauts faits : attribués par le serveur à partir des compteurs de chaque visiteur ---
// stat = compteur suivi, n = seuil, pts = récompense, rare = annoncé dans le journal,
// secret = nom et description cachés (par le serveur) tant qu'il n'est pas débloqué
function series(stat, list, secret) { return list.map(([n, name, desc, pts, rare]) => ({ id: stat + '_' + n, stat, n, name, desc, pts, rare: !!rare, secret: !!secret })); }
const ACHIEVEMENTS = [
  ...series('earned', [
    [1, 'Premier sou', 'Gagner 1 point', 0], [10, 'Petite monnaie', 'Gagner 10 points', 0], [50, 'Tirelire', 'Gagner 50 points', 0],
    [100, 'Bas de laine', 'Gagner 100 points', 0], [250, 'Économe', 'Gagner 250 points', 0], [500, 'Rentier', 'Gagner 500 points', 0],
    [1000, 'Coffre-fort', 'Gagner 1 000 points', 0, true], [2500, 'Magnat', 'Gagner 2 500 points', 0, true],
    [5000, 'Trésor de dragon', 'Gagner 5 000 points', 0, true], [10000, 'Fortune légendaire', 'Gagner 10 000 points', 0, true]
  ]),
  ...series('feed', [[1, 'Nourrir la bête', 'Nourrir la bête une première fois', 5], [10, 'Cuistot', 'Nourrir la bête 10 fois', 10], [100, 'Chef étoilé', 'Nourrir la bête 100 fois', 25], [500, 'Garde-manger infini', 'Nourrir la bête 500 fois', 50, true]]),
  ...series('pet', [[1, 'Câliner la bête', 'Câliner la bête une première fois', 5], [10, 'Main douce', 'Câliner la bête 10 fois', 10], [100, 'Dompteur', 'Câliner la bête 100 fois', 25], [500, 'Murmureur de bêtes', 'Câliner la bête 500 fois', 50, true]]),
  ...series('wash', [[1, 'Laver la bête', 'Laver la bête une première fois', 5], [10, 'Shampouineur', 'Laver la bête 10 fois', 10], [100, 'Karcher humain', 'Laver la bête 100 fois', 25]]),
  ...series('play', [[1, 'Jouer avec la bête', 'Jouer avec la bête une première fois', 5], [10, 'Compagnon de jeu', 'Jouer avec la bête 10 fois', 10], [100, 'Coach sportif', 'Jouer avec la bête 100 fois', 25]]),
  ...series('heal', [[1, 'Infirmier', 'Soigner la bête une première fois', 5], [10, 'Médecin de garde', 'Soigner la bête 10 fois', 10], [100, 'Grand guérisseur', 'Soigner la bête 100 fois', 25]]),
  ...series('rock', [[1, 'Bercer la bête', 'Bercer la bête une première fois', 5], [10, 'Marchand de sable', 'Bercer la bête 10 fois', 10], [100, 'Berceuse vivante', 'Bercer la bête 100 fois', 25]]),
  ...series('actions', [[25, 'Habitué', 'Faire 25 actions', 15], [250, 'Pilier du clan', 'Faire 250 actions', 50], [1000, 'Gardien éternel', 'Faire 1 000 actions', 100, true]]),
  ...series('bonus', [[1, 'Réflexes', 'Attraper un passant bonus', 5], [10, 'Chasseur de passants', 'Attraper 10 passants bonus', 25], [50, 'Œil de lynx', 'Attraper 50 passants bonus', 75, true]]),
  ...series('likesGiven', [[1, 'Premier like', 'Aimer l’action d’un autre joueur', 5], [25, 'Supporter', 'Donner 25 likes', 15], [100, 'Cœur d’or', 'Donner 100 likes', 40]]),
  ...series('likesRecv', [[1, 'Apprécié', 'Recevoir un like', 5], [10, 'Populaire', 'Recevoir 10 likes', 20], [50, 'Star du journal', 'Recevoir 50 likes', 60, true]]),
  ...series('buys', [[1, 'Premier achat', 'Acheter quelque chose en boutique', 5], [10, 'Client fidèle', 'Faire 10 achats', 25]]),
  ...series('spent', [[500, 'Panier percé', 'Dépenser 500 points', 15], [5000, 'Flambeur', 'Dépenser 5 000 points', 50, true]]),
  ...series('taps', [[100, 'Doigt agile', 'Toucher l’écran 100 fois', 5], [1000, 'Tapoteur fou', 'Toucher l’écran 1 000 fois', 20], [10000, 'Mitraillette', 'Toucher l’écran 10 000 fois', 50, true]]),
  ...series('trips', [[1, 'Premier voyage', 'Emmener la bête en séjour', 10]]),
  ...series('places', [[4, 'Globe-trotter', 'Emmener la bête dans les 4 lieux', 50, true]], true),
  ...series('colors', [[1, 'Relooking', 'Changer la couleur de la bête', 10]]),
  ...series('accs', [[1, 'Fashion week', 'Offrir un accessoire à la bête', 10]]),
  ...series('hatches', [[1, 'Sage-femme', 'Faire éclore un œuf', 15]], true),
  ...series('hatchEpic', [[1, 'Œil d’Horus', 'Faire éclore une créature épique', 50, true]], true),
  // Découvertes : être présent (ou agir) pendant la vie d'une créature de chaque espèce
  ...series('met_dino', [[1, 'Jurassique', 'Découvrir le dino', 10]]),
  ...series('met_phenix', [[1, 'Oiseau de feu', 'Découvrir le phénix', 10]]),
  ...series('met_renard', [[1, 'Esprit de la forêt', 'Découvrir le renard mystique', 10]]),
  ...series('met_lezard', [[1, 'Sang-froid', 'Découvrir le lézard géant', 10]]),
  ...series('met_meduse', [[1, 'Regard de pierre', 'Découvrir la gorgone', 10]]),
  ...series('met_lapin', [[1, 'Premier round', 'Découvrir le lapin de combat', 10]]),
  ...series('met_requin', [[1, 'Dents de la mer', 'Découvrir le requin des terres', 10]]),
  ...series('met_horus', [[1, 'Vision divine', 'Découvrir le dieu-faucon épique', 40, true]], true),
  ...series('species', [[3, 'Naturaliste', 'Découvrir 3 espèces', 20], [Object.keys(SPECIES).length, 'Zoologiste', 'Découvrir toutes les espèces', 100, true]]),
  ...series('games', [[1, 'Joueur', 'Jouer à un mini-jeu', 5], [10, 'Habitué de l’arcade', 'Jouer à 10 mini-jeux', 25], [50, 'Pro du joystick', 'Jouer à 50 mini-jeux', 75, true]]),
  ...series('best_catch', [[25, 'Estomac sur pattes', 'Faire 25 à Attrape-miam', 20]]),
  ...series('best_mole', [[25, 'Main de fer', 'Faire 25 à Tape-cornichons', 20]]),
  ...series('best_rhythm', [[50, 'Roi de la piste', 'Faire 50 à Danse-rythme', 20]]),
  ...series('colorsSeen', [[3, 'Arc-en-ciel', 'Voir 3 couleurs dans l’album', 15], [6, 'Palette complète', 'Voir toutes les couleurs dans l’album', 60, true]]),
  ...series('accsSeen', [[3, 'Garde-robe', 'Voir 3 accessoires dans l’album', 15], [Object.keys(ACCESSORIES).length, 'Collectionneur de chapeaux', 'Voir tous les accessoires dans l’album', 60, true]]),
  ...series('streakBest', [[3, 'Habitué du matin', 'Revenir 3 jours de suite', 15], [7, 'Une semaine entière', 'Revenir 7 jours de suite', 50, true], [30, 'Inséparables', 'Revenir 30 jours de suite', 200, true]]),
  ...series('questsDone', [[1, 'Bon élève', 'Terminer une quête du jour', 5], [25, 'Employé du mois', 'Terminer 25 quêtes du jour', 40], [100, 'Chasseur de primes', 'Terminer 100 quêtes du jour', 100, true]]),
  ...series('heroDays', [[1, 'Héros d’un jour', 'Tenir un rôle de héros jusqu’à la fin de la journée', 30], [10, 'Légende vivante', 'Être héros du jour 10 fois', 150, true]]),
  ...series('goalsDone', [[1, 'Esprit d’équipe', 'Participer à un objectif collectif réussi', 10], [10, 'Pilier de la communauté', 'Participer à 10 objectifs collectifs réussis', 75, true]]),
  ...series('morphs', [[1, 'Métamorphose', 'Transformer la bête en une autre espèce', 25], [5, 'Savant fou', 'Faire 5 métamorphoses', 75, true]]),
  ...series('nicks', [[1, 'Nouvelle identité', 'Changer de pseudo', 5]], true),
  ...series('presence', [[10, 'Spectateur', 'Passer 10 minutes sur le site', 5], [60, 'Fidèle au poste', 'Passer 1 heure sur le site', 20], [600, 'Résident', 'Passer 10 heures sur le site', 75, true]]),
  ...series('feedHungry', [[1, 'Sauveteur', 'Nourrir la bête quand elle meurt de faim', 10]], true),
  ...series('feedDying', [[1, 'In extremis', 'Nourrir la bête au bord de la mort', 25, true]], true),
  ...series('wakeUp', [[1, 'Réveil brutal', 'Déranger la bête pendant sa sieste', 5]], true)
];
const ACH_CATALOG = ACHIEVEMENTS.map(({ id, name, desc, n, pts, stat, secret }) => ({ id, name, desc, n, pts, stat, secret }));

const pick = (a) => a[Math.floor(Math.random() * a.length)];
// Lecture sûre dans nos tables : "constructor", "__proto__"… ne doivent jamais être pris pour une clé valide
const own = (obj, k) => (typeof k === 'string' && Object.prototype.hasOwnProperty.call(obj, k) ? obj[k] : undefined);
const makeNick = (noun, adj) => noun + ' ' + adj + ' ' + (1 + Math.floor(Math.random() * 99));
const actor = (v) => (v ? v.nick : 'Un visiteur');
const clamp = (x) => Math.max(0, Math.min(100, x));
const fill = (s) => s.replace(/\{n\}/g, state.name);

// Panthéon : les 10 créatures qui ont vécu le plus longtemps (seules ces 10 lignes sont conservées)
const HALL_SIZE = 10;
// 50 niveaux (mêmes seuils que la page) : les 10 premiers inchangés (niveau 10 à 4 jours), puis un niveau toutes les 12 h (niveau 50 à 24 jours)
const LEVEL_HOURS = [0, 0.25, 0.75, 1.5, 3, 6, 12, 24, 48, 96];
for (let l = 11; l <= 50; l++) LEVEL_HOURS.push(96 + (l - 10) * 12);
const levelOf = (ms) => LEVEL_HOURS.filter((h) => ms >= h * H).length;

function newCreature(now, best) {
  return {
    name: pick(NAMES), species: pickSpecies(), born: now, t: now,
    food: 70, joy: 70, clean: 70, fit: 70, sleep: 70,
    zeroAt: null, deadAt: null, hatchableAt: null, actions: 0,
    asleepUntil: 0, place: null, color: 'orange', acc: {},
    lastBuy: {}, best: best || null, events: [], eventSeq: (state && state.eventSeq) || 0,
    hall: (state && state.hall) || [], goal: (state && state.goal) || null, heroes: (state && state.heroes) || null, hatchedBy: null
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
// Migration : l'ancien record unique devient la première ligne du Panthéon
if (!state.hall) state.hall = state.best ? [{ name: state.best.name, species: null, lived: state.best.ms, level: levelOf(state.best.ms), actions: null, hatchedBy: null, deadAt: null }] : [];
const defaults = { species: 'dino', asleepUntil: 0, place: null, color: 'orange', acc: {}, lastBuy: {}, zeroAt: null };
for (const k in defaults) if (state[k] === undefined) state[k] = defaults[k];
if (!state.zeroAt && !state.deadAt && state.food <= 0) state.zeroAt = state.t;
let visitors = state.visitors || {};
// Migration : un visiteur qui a déjà gagné ou dépensé des points compte comme joueur (gardé 60 jours)
for (const id in visitors) {
  const v = visitors[id];
  if (v.acted === undefined) v.acted = v.pts !== PTS_WELCOME || !!v.lastNick || !!v.lastBonus;
  if (!v.st) v.st = { earned: Math.max(0, v.pts) }; // hauts faits : on part du solde actuel des anciens joueurs
}
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
  addEvent(state.name + ' est mort de faim. Bravo à tous.', state.deadAt);
  archive(state.deadAt);
}
// Fin d'une vie (mort ou métamorphose) : record et Panthéon
function archive(end, morphed) {
  // Vie trafiquée par les outils (âge ou jauges modifiés) : ni record ni Panthéon
  if (state.tampered) { console.log('Panthéon : ' + state.name + ' ignoré (vie modifiée par les outils)'); return; }
  const lived = end - state.born;
  if (!state.best || lived > state.best.ms) state.best = { name: state.name, ms: lived };
  const rec = { name: state.name, species: state.species, lived, level: levelOf(lived), actions: state.actions, hatchedBy: state.hatchedBy || null, deadAt: end, ...(morphed ? { morphed: true } : {}) };
  state.hall = state.hall.concat(rec).sort((a, b) => b.lived - a.lived).slice(0, HALL_SIZE);
  const rank = state.hall.indexOf(rec) + 1;
  if (rank) addEvent(state.name + ' entre au Panthéon à la ' + (rank === 1 ? '1re' : rank + 'e') + ' place !' + (rank === 1 ? ' Nouveau record !' : ''), end);
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
    name: s.name, species: s.species, born: s.born, hall: s.hall, hatchedBy: s.hatchedBy || null, dead: !!s.deadAt, deadAt: s.deadAt, canHatchAt: s.hatchableAt,
    actions: s.actions, best: s.best, tampered: !!s.tampered, now, cooldownMs: COOLDOWN_MS,
    events: s.events.map((e) => ({
      id: e.id, ts: e.ts, text: e.text, likes: e.likers.length,
      likable: !!e.author, mine: !!vid && e.author === vid, liked: !!vid && e.likers.includes(vid), badges: e.author ? badgesOf(e.author, now) : []
    })),
    nickParts: { nouns: NICK_NOUNS, adjs: NICK_ADJS },
    asleepUntil: s.asleepUntil, place: s.place, color: s.color, acc: s.acc,
    goal: goalPublic(now), heroes: heroList(now, vid), buyCooldown: {}, shop: SHOP, ga: GA_ID, me: v ? { pts: v.pts, nick: v.nick, achCount: Object.keys(v.ach || {}).length, achTotal: ACHIEVEMENTS.length, achNew: takeNewAch(v), tapLeft: tapLeft(v, now), notes: takeNotes(v), badges: badgesOf(vid, now),...bonusInfo(v, now), ...dailyInfo(v, vid, now) } : null, dev: DEV
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
  v.id = id;
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

// Vérification du jeton admin : comparaison en temps constant, et 5 essais ratés par IP bloquent l'IP 15 min
const adminFails = new Map();
const ADMIN_MAX_FAILS = 5, ADMIN_LOCK_MS = 15 * 60 * 1000;
function isAdmin(req) {
  const tok = req.headers['x-admin'];
  if (!ADMIN_TOKEN || typeof tok !== 'string' || !tok) return false;
  const ip = clientIp(req), now = Date.now(), f = adminFails.get(ip);
  if (f && f.n >= ADMIN_MAX_FAILS && now - f.at < ADMIN_LOCK_MS) return false;
  const hash = (x) => crypto.createHash('sha256').update(x).digest();
  if (crypto.timingSafeEqual(hash(tok), hash(ADMIN_TOKEN))) { adminFails.delete(ip); return true; }
  const n = f && now - f.at < ADMIN_LOCK_MS ? f.n + 1 : 1;
  adminFails.set(ip, { n, at: now });
  if (n === ADMIN_MAX_FAILS) console.warn('admin : IP ' + ip + ' bloquée 15 min après ' + n + ' essais ratés');
  return false;
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
    "script-src 'self'" + (GA_ID ? ' https://www.googletagmanager.com' : ''),
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "font-src https://fonts.gstatic.com",
    "img-src 'self' data:" + (GA_ID ? ' https://*.google-analytics.com https://*.googletagmanager.com' : ''),
    "connect-src 'self'" + (GA_ID ? ' https://*.google-analytics.com https://*.analytics.google.com https://*.googletagmanager.com' : ''),
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
  const a = ACTIONS[kind], stat = a.stat || lowestStat();
  let refused = null; // jauge déjà (presque) pleine : l'action est refusée et ne compte ni points, ni quêtes, ni objectif
  // Hauts faits « spéciaux » : on regarde l'état AVANT l'action
  if (v && kind === 'feed' && state.food < 25) track(v, 'feedHungry', 1, now);
  if (v && kind === 'feed' && state.food < 8) track(v, 'feedDying', 1, now);
  if (v && kind !== 'rock' && state.asleepUntil > now) track(v, 'wakeUp', 1, now);
  meet(v, now);
  if (v) streakTick(v, now);
  if (state[stat] > (a.stat ? 92 : 80)) {
    state.joy = clamp(state.joy - 8);
    addEvent(fill(pick(a.full)), now);
    refused = stat;
  } else {
    state[stat] = clamp(state[stat] + a.gain);
    for (const k in a.side) state[k] = clamp(state[k] + a.side[k]);
    if (state.food > 0) state.zeroAt = null;
    if (a.nap) state.asleepUntil = now + NAP_MS;
    else if (state.asleepUntil > now) state.asleepUntil = now; // on le réveille
    addEvent(actor(v) + ' ' + fill(pick(a.msgs)), now, vid);
    if (v) { v.acted = true; earn(v, PTS_ACTION, now); track(v, kind, 1, now); track(v, 'actions', 1, now); goalContribute(v, vid, kind, now); }
  }
  save();
  send(res, 200, { gained: v && !refused ? PTS_ACTION : 0, refused, ...view(now, vid) });
}

function hatch(req, res) {
  const now = Date.now(), vid = visitorId(req), v = visitor(vid, now, req);
  settle(now);
  if (!state.deadAt) return send(res, 409, { error: 'alive', ...view(now, vid) });
  if (now < state.hatchableAt) return send(res, 429, { error: 'too_early', ...view(now, vid) });
  const best = state.best;
  state = newCreature(now, best);
  state.hatchedBy = v ? v.nick : null;
  track(v, 'hatches', 1, now);
  if (EPIC[state.species]) track(v, 'hatchEpic', 1, now);
  meet(v, now);
  addEvent(actor(v) + ' a fait éclore un œuf : c’est ' + SPECIES[state.species] + ' ! Bonjour, ' + state.name + ' !', now, vid);
  save();
  send(res, 200, view(now, vid));
}

// Présence : 1 point par minute passée sur le site, plafonné par jour
function ping(req, res) {
  const now = Date.now(), vid = visitorId(req), v = visitor(vid, now, req);
  let gained = 0;
  if (v) streakTick(v, now);
  if (v && now - v.lastPing >= 55 * 1000) {
    const day = new Date(now).toISOString().slice(0, 10);
    if (v.day !== day) { v.day = day; v.dayPts = 0; }
    if (v.dayPts < PRESENCE_CAP) { v.dayPts += PTS_PRESENCE; gained = PTS_PRESENCE; v.acted = true; earn(v, PTS_PRESENCE, now); }
    track(v, 'presence', 1, now);
    meet(v, now);
    v.lastPing = now;
    save();
  }
  send(res, 200, { gained, ...view(now, vid) });
}

// Incrémente un compteur du visiteur, débloque les hauts faits atteints et met les nouveautés en attente d'affichage
function track(v, stat, inc, now) {
  if (!v) return;
  v.st = v.st || {};
  v.st[stat] = (v.st[stat] || 0) + (inc === undefined ? 1 : inc);
  if (stat === 'earned') return checkAch(v, now);
  questProgress(v, stat, inc === undefined ? 1 : inc, now || Date.now());
  heroProgress(v, stat, inc === undefined ? 1 : inc, now || Date.now());
  checkAch(v, now);
}
// Première rencontre de ce visiteur avec l'espèce de la créature actuelle (vivante)
function meet(v, now) {
  if (!v || state.deadAt) return;
  v.met = v.met || {};
  // Album : couleurs et accessoires vus, plus haut niveau vu par espèce
  const al = v.album = v.album || { lvl: {}, colors: {}, acc: {} };
  al.lvl[state.species] = Math.max(al.lvl[state.species] || 0, albumLevel(now - state.born));
  if (!al.colors[state.color]) { al.colors[state.color] = 1; track(v, 'colorsSeen', 1, now); }
  for (const slot in state.acc) {
    const k = state.acc[slot];
    if (k && !al.acc[k]) { al.acc[k] = 1; track(v, 'accsSeen', 1, now); }
  }
  if (v.met[state.species]) return;
  v.met[state.species] = now;
  track(v, 'met_' + state.species, 1, now);
  track(v, 'species', 1, now);
}
function earn(v, pts, now) { if (!v || pts <= 0) return; v.pts += pts; track(v, 'earned', pts, now); }
function checkAch(v, now) {
  v.ach = v.ach || {};
  let reward = 0;
  for (const a of ACHIEVEMENTS) {
    if (v.ach[a.id] || ((v.st && v.st[a.stat]) || 0) < a.n) continue;
    v.ach[a.id] = now || Date.now();
    (v.achNew = v.achNew || []).push(a.id);
    reward += a.pts;
    if (a.rare) addEvent(actor(v) + ' débloque le haut fait « ' + a.name + ' » !', now || Date.now(), null);
  }
  if (reward) earn(v, reward, now); // les récompenses comptent dans les points gagnés (sans boucle : les hauts faits de points ne rapportent rien)
}

function takeNewAch(v) {
  if (!v.achNew || !v.achNew.length) return [];
  const out = v.achNew.map((id) => ACH_CATALOG.find((a) => a.id === id)).filter(Boolean);
  v.achNew = [];
  save();
  return out;
}
// Liste complète pour le panneau : catalogue + ce que ce visiteur a débloqué + sa progression
function achievements(req, res) {
  const now = Date.now(), vid = visitorId(req), v = vid && own(visitors, vid);
  const st = (v && v.st) || {}, got = (v && v.ach) || {};
  send(res, 200, {
    list: ACH_CATALOG.map((a) => got[a.id]
      ? { ...a, at: got[a.id], progress: a.n }
      // Secret pas encore débloqué : on n'envoie rien qui permettrait de le deviner
      : a.secret ? { id: 'secret_' + ACH_CATALOG.indexOf(a), secret: true, name: '???', desc: 'Haut fait secret. Continue de jouer pour le découvrir…', at: null }
        : { ...a, at: null, progress: Math.min(a.n, st[a.stat] || 0) })
  });
}

function today(now) { return new Date(now).toISOString().slice(0, 10); }

// --- Défis du jour : série, quêtes, objectif collectif (tout bascule à minuit UTC, comme les plafonds quotidiens) ---
const dayNum = (now) => Math.floor(now / (24 * H));
const hashDay = (n, salt) => { let x = Math.imul(n + salt * 7919, 2654435761) >>> 0; x ^= x >>> 15; x = Math.imul(x, 2246822519) >>> 0; x ^= x >>> 13; return x >>> 0; };
const STREAK_BASE = 10, STREAK_STEP = 5, STREAK_MAXSTEP = 8; // 10 pts le 1er jour, +5 par jour de série, jusqu'à 50
const STREAK_WEEK_BONUS = 50;                                 // tous les 7 jours de suite
const QUEST_POOL = [
  { id: 'feed', stat: 'feed', n: 3, text: 'Nourrir la bête 3 fois' },
  { id: 'pet', stat: 'pet', n: 3, text: 'Câliner la bête 3 fois' },
  { id: 'wash', stat: 'wash', n: 2, text: 'Laver la bête 2 fois' },
  { id: 'play', stat: 'play', n: 3, text: 'Jouer avec la bête 3 fois' },
  { id: 'rock', stat: 'rock', n: 2, text: 'Bercer la bête 2 fois' },
  { id: 'heal', stat: 'heal', n: 2, text: 'Soigner la bête 2 fois' },
  { id: 'actions', stat: 'actions', n: 8, text: 'Faire 8 actions au total' },
  { id: 'bonus', stat: 'bonus', n: 1, text: 'Attraper un passant bonus' },
  { id: 'games', stat: 'games', n: 2, text: 'Jouer à 2 mini-jeux' },
  { id: 'gamePts', stat: 'gamePts', n: 30, text: 'Gagner 30 pts aux mini-jeux' },
  { id: 'taps', stat: 'taps', n: 100, text: 'Toucher l’écran 100 fois' },
  { id: 'likes', stat: 'likesGiven', n: 3, text: 'Aimer 3 actions d’autres joueurs' },
  { id: 'presence', stat: 'presence', n: 15, text: 'Rester 15 minutes sur le site' }
];
const QUEST_COUNT = 3, QUEST_PTS = 20, QUEST_CHEST_PTS = 40;
function questsOf(now) {
  const pool = QUEST_POOL.slice(), n = dayNum(now), out = [];
  for (let i = 0; i < QUEST_COUNT; i++) out.push(pool.splice(hashDay(n, i + 1) % pool.length, 1)[0]);
  return out;
}
const GOAL_KINDS = [
  { stat: 'pet', label: 'câlins' }, { stat: 'feed', label: 'repas' }, { stat: 'wash', label: 'bains' },
  { stat: 'play', label: 'parties' }, { stat: 'rock', label: 'berceuses' }, { stat: 'actions', label: 'soins' }
];
const GOAL_PTS = 30;
const GOAL_PER_PLAYER = 4, GOAL_MIN = 15, GOAL_MAX = 600;

function note(v, head, name, desc, pts) {
  v.notes = v.notes || [];
  if (v.notes.length < 10) v.notes.push({ head, name, desc, pts: pts || 0 });
}
function takeNotes(v) {
  if (!v.notes || !v.notes.length) return [];
  const out = v.notes;
  v.notes = [];
  save();
  return out;
}

// Série : un jour de plus à la première activité de la journée, remise à 1 si on a raté un jour
function streakTick(v, now) {
  const day = today(now), s = v.streak = v.streak || { n: 0, last: '', best: 0 };
  if (s.last === day) return;
  s.n = s.last === today(now - 24 * H) ? s.n + 1 : 1;
  s.last = day; s.best = Math.max(s.best, s.n);
  v.acted = true;
  const pts = STREAK_BASE + STREAK_STEP * Math.min(s.n - 1, STREAK_MAXSTEP) + (s.n % 7 === 0 ? STREAK_WEEK_BONUS : 0);
  earn(v, pts, now);
  note(v, 'SÉRIE · JOUR ' + s.n, s.n === 1 ? 'Bienvenue !' : s.n + ' jours de suite', s.n % 7 === 0 ? 'Bonus de semaine complète' : 'Reviens demain pour continuer la série', pts);
  v.st.streakBest = Math.max(v.st.streakBest || 0, s.n);
  checkAch(v, now);
  save();
}
const streakNext = (n) => STREAK_BASE + STREAK_STEP * Math.min(n, STREAK_MAXSTEP) + ((n + 1) % 7 === 0 ? STREAK_WEEK_BONUS : 0);

// Quêtes : compteurs du jour, remis à zéro quand la date change
function questState(v, now) {
  const day = today(now);
  if (!v.q || v.q.day !== day) v.q = { day, c: {}, done: {}, chest: false };
  return v.q;
}
function questProgress(v, stat, inc, now) {
  const defs = questsOf(now);
  if (!defs.some((d) => d.stat === stat)) return;
  const q = questState(v, now);
  for (const d of defs) {
    if (d.stat !== stat || q.done[d.id]) continue;
    q.c[d.id] = Math.min(d.n, (q.c[d.id] || 0) + inc);
    if (q.c[d.id] < d.n) continue;
    q.done[d.id] = 1;
    earn(v, QUEST_PTS, now);
    note(v, 'QUÊTE TERMINÉE', d.text, '', QUEST_PTS);
    track(v, 'questsDone', 1, now);
  }
  if (!q.chest && defs.every((d) => q.done[d.id])) {
    q.chest = true;
    earn(v, QUEST_CHEST_PTS, now);
    note(v, 'COFFRE DU JOUR', 'Toutes les quêtes sont faites !', 'Reviens demain pour de nouvelles quêtes', QUEST_CHEST_PTS);
  }
}

// Objectif collectif : un par jour, chacun y contribue par ses actions, tous les contributeurs touchent la récompense
function ensureGoal(now) {
  const day = today(now);
  if (state.goal && state.goal.day === day) return state.goal;
  const kind = GOAL_KINDS[hashDay(dayNum(now), 99) % GOAL_KINDS.length];
  const actives = Object.values(visitors).filter((x) => x.acted && x.seen > now - 48 * H).length;
  const per = GOAL_PER_PLAYER * (kind.stat === 'actions' ? 2 : 1);
  state.goal = { day, stat: kind.stat, label: kind.label, target: Math.max(GOAL_MIN, Math.min(GOAL_MAX, actives * per)), count: 0, done: false, by: {}, paid: {} };
  return state.goal;
}
function goalPay(g, id, now) {
  if (g.paid[id]) return;
  g.paid[id] = 1;
  const w = own(visitors, id);
  if (!w) return;
  earn(w, GOAL_PTS, now);
  track(w, 'goalsDone', 1, now);
  note(w, 'OBJECTIF ATTEINT', 'Tous ensemble : ' + g.target + ' ' + g.label + ' !', 'Une aurore boréale illumine la bête', GOAL_PTS);
}
function goalContribute(v, vid, stat, now) {
  if (!v || !vid) return;
  const g = ensureGoal(now);
  if (g.stat !== 'actions' && g.stat !== stat) return;
  g.count++;
  g.by[vid] = (g.by[vid] || 0) + 1;
  if (!g.done && g.count >= g.target) {
    g.done = true;
    addEvent('Objectif du jour atteint : ' + g.target + ' ' + g.label + ' ! Une aurore boréale illumine la bête.', now);
    for (const id in g.by) goalPay(g, id, now);
  } else if (g.done) goalPay(g, vid, now);
}
// --- Héros du jour : le meilleur de la journée dans chaque domaine porte un badge (journal, pseudo) ---
const HERO_ROLES = [
  { id: 'mvp', stat: 'actions', icon: '👑', name: 'MVP du jour', min: 6, desc: 'le plus d’actions' },
  { id: 'chef', stat: 'feed', icon: '🍕', name: 'Chef du jour', min: 3, desc: 'le plus de repas servis' },
  { id: 'cal', stat: 'pet', icon: '💖', name: 'Câlineur du jour', min: 3, desc: 'le plus de câlins' },
  { id: 'wash', stat: 'wash', icon: '🧼', name: 'Lavandier du jour', min: 3, desc: 'le plus de bains' },
  { id: 'coach', stat: 'play', icon: '🎾', name: 'Coach du jour', min: 3, desc: 'le plus de jeux' },
  { id: 'sand', stat: 'rock', icon: '🌙', name: 'Marchand de sable', min: 3, desc: 'le plus de berceuses' },
  { id: 'saver', stat: 'feedHungry', icon: '🚑', name: 'Sauveur du jour', min: 1, desc: 'le plus de repas donnés à une bête affamée' },
  { id: 'arcade', stat: 'gamePts', icon: '🕹️', name: 'Roi de l’arcade', min: 15, desc: 'le plus de points aux mini-jeux' }
];
const HERO_PTS = 25, HERO_SAY_MS = 10 * MIN;
// Le jour change : les héros d'hier touchent leur prime, puis on repart de zéro
function ensureHeroes(now) {
  const day = today(now);
  if (state.heroes && state.heroes.day === day) return state.heroes;
  const prev = state.heroes;
  state.heroes = { day, roles: {}, said: {} };
  if (prev) for (const r of HERO_ROLES) {
    const h = prev.roles[r.id], w = h && own(visitors, h.id);
    if (!w) continue;
    earn(w, HERO_PTS, now);
    note(w, 'HÉROS D’HIER', r.icon + ' ' + r.name, 'Tu as tenu le rôle jusqu’à minuit', HERO_PTS);
    track(w, 'heroDays', 1, now);
  }
  return state.heroes;
}
function heroProgress(v, stat, inc, now) {
  const roles = HERO_ROLES.filter((r) => r.stat === stat);
  if (!roles.length || !v.id || v.admin) return;
  const h = ensureHeroes(now);
  if (!v.d || v.d.day !== h.day) v.d = { day: h.day, c: {} };
  const n = v.d.c[stat] = (v.d.c[stat] || 0) + inc;
  for (const r of roles) {
    if (n < r.min) continue;
    const cur = h.roles[r.id];
    if (cur && cur.id === v.id) { cur.n = n; continue; }
    if (cur && n <= cur.n) continue; // il faut battre le titulaire, l'égalité ne suffit pas
    h.roles[r.id] = { id: v.id, n };
    if (now - (h.said[r.id] || 0) >= HERO_SAY_MS) { // pas de spam si deux joueurs se disputent le titre
      h.said[r.id] = now;
      addEvent(r.icon + ' ' + actor(v) + ' devient ' + r.name + ' !', now, null);
    }
  }
}
function badgesOf(id, now) {
  const h = state.heroes;
  if (!h || h.day !== today(now)) return [];
  return HERO_ROLES.filter((r) => h.roles[r.id] && h.roles[r.id].id === id).map((r) => r.icon);
}
function heroList(now, vid) {
  const h = ensureHeroes(now);
  return HERO_ROLES.map((r) => {
    const c = h.roles[r.id], w = c && own(visitors, c.id);
    return { id: r.id, icon: r.icon, name: r.name, desc: r.desc, min: r.min, nick: w ? w.nick : null, n: c ? c.n : 0, mine: !!c && c.id === vid };
  });
}

function goalPublic(now) { const g = ensureGoal(now); return { stat: g.stat, label: g.label, target: g.target, count: g.count, done: g.done }; }
function dailyInfo(v, vid, now) {
  const day = today(now), q = questState(v, now), s = v.streak || { n: 0, last: '', best: 0 };
  const alive = s.last === day || s.last === today(now - 24 * H);
  const g = ensureGoal(now);
  return {
    streak: { n: alive ? s.n : 0, best: s.best, today: s.last === day, next: streakNext(alive ? s.n : 0) },
    quests: { list: questsOf(now).map((d) => ({ id: d.id, text: d.text, n: d.n, c: q.c[d.id] || 0, done: !!q.done[d.id], pts: QUEST_PTS })), chest: q.chest, chestPts: QUEST_CHEST_PTS },
    goal: { stat: g.stat, label: g.label, target: g.target, count: g.count, done: g.done, mine: g.by[vid] || 0, pts: GOAL_PTS, players: Object.keys(g.by).length }
  };
}

// Album : espèces rencontrées (avec le plus haut niveau vu), couleurs et accessoires aperçus
const ALBUM_H = [0, 0.25, 0.75, 1.5, 3, 6, 12, 24, 48, 96];
for (let lh = 11; lh <= 50; lh++) ALBUM_H.push(96 + (lh - 10) * 12);
const albumLevel = (ms) => ALBUM_H.filter((h) => ms >= h * H).length;
function album(req, res) {
  const vid = visitorId(req), v = vid && own(visitors, vid), al = (v && v.album) || { lvl: {}, colors: {}, acc: {} }, met = (v && v.met) || {};
  send(res, 200, {
    species: Object.keys(SPECIES).map((k) => ({ id: k, epic: !!EPIC[k], met: met[k] || 0, lvl: al.lvl[k] || 0 })),
    colors: Object.keys(COLORS).map((k) => ({ id: k, seen: !!al.colors[k] })),
    acc: Object.keys(ACCESSORIES).map((k) => ({ id: k, name: ACCESSORIES[k].short, seen: !!al.acc[k] })),
    maxLevel: ALBUM_H.length
  });
}
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
  v.lastBonus = now; v.bonusCount++; v.acted = true; earn(v, BONUS_PTS, now); track(v, 'bonus', 1, now);
  addEvent(actor(v) + ' a attrapé ' + label + ' au vol ! (+' + BONUS_PTS + ' pts)', now, vid);
  save();
  send(res, 200, { gained: BONUS_PTS, ...view(now, vid) });
}

// --- Mini-jeux : une occasion apparaît de temps en temps, une partie dure 20 s ---
// Le serveur ouvre la partie (start) et refuse un score rendu trop tôt ; le score est borné par jeu.
const GAMES = {
  // perPt = combien de points de score pour 1 point gagné (le rythme compte double : 2 par note parfaite)
  catch: { name: 'Attrape-miam', max: 45, perPt: 1 },
  mole: { name: 'Tape-cornichons', max: 45, perPt: 1 },
  rhythm: { name: 'Danse-rythme', max: 90, perPt: 2 }
};
const GAME_MS = 20 * 1000;
const GAME_COOLDOWN = 2 * MIN;  // au plus une partie toutes les 2 min
const GAME_DAILY = 10;          // parties qui rapportent des points, par jour
const GAME_PTS_MAX = 40;        // points max par partie
function gameStart(req, res, body) {
  const now = Date.now(), vid = visitorId(req), v = visitor(vid, now, req);
  const kind = body && own(GAMES, body.kind) ? body.kind : null;
  if (!v || !kind) return send(res, 400, { error: 'bad_request' });
  if (now - (v.gameAt || 0) < GAME_COOLDOWN) return send(res, 429, { error: 'cooldown' });
  v.game = { kind, at: now }; v.gameAt = now;
  send(res, 200, { ok: true });
}
function gameEnd(req, res, body) {
  const now = Date.now(), vid = visitorId(req), v = visitor(vid, now, req);
  const g = v && v.game;
  if (!g) return send(res, 409, { error: 'no_game', ...view(now, vid) });
  const el = now - g.at;
  if (el < GAME_MS - 2000 || el > GAME_MS + 60 * 1000) { v.game = null; return send(res, 409, { error: 'timing', ...view(now, vid) }); }
  v.game = null;
  const G = GAMES[g.kind], score = Math.max(0, Math.min(G.max, Math.round(Number(body && body.score) || 0)));
  const day = today(now);
  if (v.gameDay !== day) { v.gameDay = day; v.gameCount = 0; }
  const gained = v.gameCount < GAME_DAILY ? Math.min(GAME_PTS_MAX, Math.floor(score / G.perPt)) : 0;
  v.gameCount++; v.acted = true;
  v.gameBest = v.gameBest || {};
  const record = score > (v.gameBest[g.kind] || 0);
  if (record) v.gameBest[g.kind] = score;
  if (gained) earn(v, gained, now);
  track(v, 'games', 1, now);
  if (gained) track(v, 'gamePts', gained, now);
  // Hauts faits de score : le compteur garde le meilleur score
  v.st['best_' + g.kind] = Math.max(v.st['best_' + g.kind] || 0, score); checkAch(v, now);
  addEvent(actor(v) + ' a fait un score de ' + score + ' à ' + G.name + (record && score > 0 ? ', record perso !' : ' !') + (gained ? ' +' + gained + ' pts' : ''), now, vid);
  save();
  send(res, 200, { ...view(now, vid), gained, gameScore: score, gameRecord: record, gameBest: v.gameBest[g.kind] });
}

// Points au toucher : le client envoie un lot de touches toutes les quelques secondes.
// Le serveur ne croit pas le nombre annoncé : il le borne au temps écoulé depuis le dernier lot (TAP_RATE / s).
function tapLeft(v, now) { return v.tapDay === today(now) ? Math.max(0, TAP_DAILY - (v.tapPts || 0)) : TAP_DAILY; }
function tap(req, res, body) {
  const now = Date.now(), vid = visitorId(req), v = visitor(vid, now, req);
  const n = body && Number.isInteger(body.n) ? body.n : 0;
  if (!v || n < 1 || n > 1000) return send(res, 400, { error: 'bad_request', ...view(now, vid) });
  const elapsed = Math.min(30, (now - (v.tapAt || 0)) / 1000);
  const taps = Math.min(n, Math.floor(elapsed * TAP_RATE));
  v.tapAt = now;
  const day = today(now);
  if (v.tapDay !== day) { v.tapDay = day; v.tapPts = 0; v.tapAcc = 0; }
  let gained = 0;
  if (taps > 0) {
    v.acted = true;
    track(v, 'taps', taps, now);
    v.tapAcc = (v.tapAcc || 0) + taps;
    gained = Math.min(Math.floor(v.tapAcc / TAPS_PER_PT), TAP_DAILY - (v.tapPts || 0));
    v.tapAcc %= TAPS_PER_PT;
    if (gained > 0) { v.tapPts = (v.tapPts || 0) + gained; earn(v, gained, now); }
    save();
  }
  send(res, 200, { gained, ...view(now, vid) });
}

// Classements des joueurs (points gagnés, dépensés, temps de présence). Les identifiants secrets
// ne sortent jamais : on n'envoie que les pseudos, et un drapeau "me" calculé pour celui qui demande.
const BOARDS = ['earned', 'spent', 'presence', 'gamePts'];
let leadersCache = null;
function leaders(req, res) {
  const now = Date.now(), vid = visitorId(req), v = vid && own(visitors, vid);
  if (!leadersCache || now - leadersCache.at > LEADERS_TTL) {
    const tops = {};
    for (const b of BOARDS) {
      tops[b] = Object.keys(visitors)
        .filter((id) => !visitors[id].admin) // l'admin n'apparaît jamais dans les classements
        .map((id) => ({ id, val: (visitors[id].st && visitors[id].st[b]) || 0 }))
        .filter((r) => r.val > 0)
        .sort((x, y) => y.val - x.val)
        .slice(0, 10);
    }
    leadersCache = { at: now, tops };
  }
  const boards = {}, me = {};
  for (const b of BOARDS) {
    boards[b] = leadersCache.tops[b].map((r) => ({ nick: visitors[r.id] ? visitors[r.id].nick : '?', val: r.val, me: r.id === vid }));
    const mine = (v && v.st && v.st[b]) || 0;
    if (v && !v.admin && mine > 0) {
      let rank = 1;
      for (const id in visitors) if (!visitors[id].admin && ((visitors[id].st && visitors[id].st[b]) || 0) > mine) rank++;
      me[b] = { val: mine, rank, nick: v.nick };
    }
  }
  send(res, 200, { boards, me });
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
  } else if (type === 'morph') {
    const lvl = levelOf(now - state.born);
    archive(now, true);
    state.species = pickSpecies(state.species); state.born = now; state.actions = 0; state.tampered = false; // nouvelle vie : elle compte de nouveau
    text = actor(v) + ' a transformé ' + state.name + ' (niv. ' + lvl + ') en œuf mystère ! Qu’est-ce qui va en sortir ?';
  } else {
    const cur = state.acc[key];
    if (!cur) return send(res, 409, { error: 'already', ...view(now, vid) });
    delete state.acc[key];
    text = actor(v) + ' a retiré ' + ACCESSORIES[cur].short + ' de ' + state.name + '.';
  }
  v.pts -= item.price; v.acted = true;
  if (v.adminGift) v.adminGift = Math.max(0, v.adminGift - item.price); // on dépense d'abord les points offerts par l'admin
  state.lastBuy[cat] = now;
  if (!v.admin) { // les achats de l'admin (payés avec des points qu'il s'est donnés) ne comptent ni pour les hauts faits ni pour les classements
    track(v, 'buys', 1, now);
    track(v, 'spent', item.price, now);
    if (type === 'place' && key !== 'maison') {
      track(v, 'trips', 1, now);
      v.visited = v.visited || {};
      if (!v.visited[key]) { v.visited[key] = 1; track(v, 'places', 1, now); }
    } else if (type === 'color') track(v, 'colors', 1, now);
    else if (type === 'acc') track(v, 'accs', 1, now);
    else if (type === 'morph') { track(v, 'morphs', 1, now); if (EPIC[state.species]) track(v, 'hatchEpic', 1, now); }
  }
  if (type === 'morph') meet(v, now);
  addEvent(text, now, vid);
  save();
  send(res, 200, view(now, vid));
}

// --- Outils de dev (inaccessibles hors mode dev : la route répond 404) ---
function devTool(req, res, body, admin) {
  const now = Date.now(), vid = visitorId(req), v = visitor(vid, now, req);
  if (admin && v && body && body.op !== 'leave') v.admin = true; // compte admin : exclu des classements, ses achats ne débloquent rien
  if (!body || typeof body.op !== 'string') return send(res, 400, { error: 'bad_request' });
  settle(now);
  const num = (x, def) => (typeof x === 'number' && isFinite(x) ? x : def);
  switch (body.op) {
    case 'whoami': return send(res, 200, { admin: true });
    case 'points': case 'addPts': {
      if (!v) break;
      const before = v.pts;
      v.pts = Math.max(0, body.op === 'points' ? Math.round(num(body.pts, 1000)) : v.pts + Math.round(num(body.pts, 0)));
      // Points offerts par l'admin à lui-même : on les retient pour les lui retirer s'il redevient joueur normal
      if (admin) v.adminGift = Math.max(0, (v.adminGift || 0) + v.pts - before);
      break;
    }
    case 'leave': // l'admin redevient un joueur normal : classements et hauts faits à nouveau, sans les points offerts
      if (!v) break;
      v.pts = Math.max(0, v.pts - (v.adminGift || 0));
      delete v.adminGift; delete v.admin;
      leadersCache = null;
      console.log('admin : ' + v.nick + ' redevient joueur normal');
      save();
      return send(res, 200, view(now, vid));
    case 'stats':
      if (state.deadAt) break;
      state.tampered = true; // jauges remplies à la main : sa durée de vie n'est plus honnête
      for (const k of STATS) if (typeof body[k] === 'number') state[k] = clamp(body[k]);
      state.zeroAt = state.food > 0 ? null : now;
      break;
    case 'age': if (!state.deadAt) { state.born = now - num(body.hours, 0) * H; state.tampered = true; } break;
    case 'place':
      if (state.deadAt) break;
      state.place = own(PLACES, body.key) && body.key !== 'maison' ? { key: body.key, until: now + num(body.minutes, 180) * MIN } : null;
      break;
    case 'species': if (own(SPECIES, body.species)) state.species = body.species; break;
    case 'nap': if (!state.deadAt) state.asleepUntil = now + NAP_MS; break;
    case 'cooldowns': state.lastBuy = {}; lastAction.delete(clientIp(req)); if (v) { v.lastBonus = 0; v.bonusCount = 0; v.gameAt = 0; v.gameCount = 0; } break;
    case 'kill': if (!state.deadAt) { state.zeroAt = now - GRACE_MS; die(); state.hatchableAt = now + 5000; } break;
    default: return send(res, 400, { error: 'unknown_op' });
  }
  if (DEV) addEvent('[DEV] ' + body.op, now); // en prod, les gestes de l'admin restent discrets
  else console.log('admin : ' + body.op + (v ? ' (' + v.nick + ')' : ''));
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
  track(v, 'nicks', 1, now);
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
  ev.everLiked = ev.everLiked || [];
  if (i < 0 && !ev.everLiked.includes(vid)) {
    ev.everLiked.push(vid);
    track(v, 'likesGiven', 1, now);
    track(own(visitors, ev.author), 'likesRecv', 1, now);
  }
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

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.jpg': 'image/jpeg', '.png': 'image/png' };
// Référencement : robots.txt et sitemap générés avec l'adresse publique
const STARTED = new Date().toISOString().slice(0, 10);
const SEO_FILES = {
  '/robots.txt': () => ['text/plain; charset=utf-8', 'User-agent: *\nAllow: /\nDisallow: /api/\n' + (SITE_URL ? 'Sitemap: ' + SITE_URL + '/sitemap.xml\n' : '')],
  '/sitemap.xml': () => ['application/xml; charset=utf-8', '<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n  <url><loc>' + (SITE_URL || '') + '/</loc><lastmod>' + STARTED + '</lastmod><changefreq>daily</changefreq><priority>1.0</priority></url>\n</urlset>\n']
};

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
    if (req.method === 'GET' && url === '/api/achievements') return achievements(req, res);
    if (req.method === 'GET' && url === '/api/album') return album(req, res);
    if (req.method === 'GET' && url === '/api/leaders') return leaders(req, res);
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
      if (name === 'tap') return readJson(req, res, (body) => tap(req, res, body));
      if (name === 'game/start') return readJson(req, res, (body) => gameStart(req, res, body));
      if (name === 'game/end') return readJson(req, res, (body) => gameEnd(req, res, body));
      // Outils : ouverts en mode dev, sinon réservés à l'admin (404 pour les autres, comme si la route n'existait pas)
      if (name === 'dev') { const adm = isAdmin(req); if (DEV || adm) return readJson(req, res, (body) => devTool(req, res, body, adm)); }
    }
    return send(res, 404, { error: 'not_found' });
  }
  if (req.method === 'GET' && url === '/healthz') { res.writeHead(200); return res.end('ok'); }
  if ((req.method === 'GET' || req.method === 'HEAD') && SEO_FILES[url]) {
    const [type, body] = SEO_FILES[url]();
    res.writeHead(200, { ...secHeaders(req), 'Content-Type': type, 'Cache-Control': 'public, max-age=3600' });
    return res.end(req.method === 'HEAD' ? undefined : body);
  }
  if (req.method === 'GET' || req.method === 'HEAD') {
    const rel = url === '/' ? 'index.html' : url.slice(1);
    const file = path.join(PUBLIC_DIR, path.normalize(rel));
    if (file.startsWith(PUBLIC_DIR + path.sep) && fs.existsSync(file) && fs.statSync(file).isFile()) {
      res.writeHead(200, { ...secHeaders(req), 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
      if (req.method === 'HEAD') return res.end();
      // La page d'accueil reçoit l'adresse publique du site dans ses balises (canonical, partage, données structurées)
      if (rel === 'index.html') return res.end(fs.readFileSync(file, 'utf8').replace(/%SITE%/g, SITE_URL));
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
