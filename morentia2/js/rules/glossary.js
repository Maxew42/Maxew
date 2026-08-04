// Glossaire de jeu : les mots des cartes qui portent une règle.
//
// Chaque entrée liste ses formes fléchies telles qu'elles apparaissent sur les
// cartes — pas de morphologie devinée, la liste est explicite et vérifiable.
//
// Le classeur fait foi : quand une entrée porte un `rule`, son texte est celui
// de la feuille « À lire » du classeur, et le corps écrit ici ne sert que de
// repli si le classeur ne traite pas ce point. Les autres entrées décrivent ce
// que fait réellement `js/rules/` ; les modifier de concert.

/**
 * `rule`  — libellé de la feuille « À lire » qui prime sur `body`.
 * `terms` — formes reconnues dans le texte, casse indifférente.
 */
export const GLOSSARY = [
  // ------------------------------------------------------ structure d'un Jour
  {
    key: 'jour', label: 'Jour', rule: 'Jour',
    terms: ['Jour', 'Jours'],
    body: 'Un Jour est un round complet : Aube, Journée, Crépuscule, Guerre, Nuit, puis fin du Jour. '
      + 'Les effets « une fois par Jour » redeviennent disponibles à l’Aube.',
  },
  {
    key: 'aube', label: 'Aube',
    terms: ['Aube'],
    body: 'Première phase du Jour, dans cet ordre : la réserve rejoint l’or actif, les cartes épuisées '
      + 'se redressent, les bonus « jusqu’à la prochaine Aube » cessent, puis chaque joueur pioche. '
      + 'Les effets d’Aube des cartes se résolvent ensuite.',
  },
  {
    key: 'journee', label: 'Journée',
    terms: ['Journée'],
    body: 'Phase des tours de jeu. À son tour, un joueur joue une carte de sa main, achète une carte du '
      + 'marché, déploie une unité de son domaine, active une capacité « Action — », change d’Ordre, '
      + 'ou se couche. La Journée s’arrête quand tous les joueurs sont couchés.',
  },
  {
    key: 'crepuscule', label: 'Crépuscule',
    terms: ['Crépuscule'],
    body: 'Le contrôle de chaque lieu est déterminé, puis l’effet « Contrôle » de chaque lieu contrôlé '
      + 'se résout, une fois par lieu.',
  },
  {
    key: 'guerre', label: 'Guerre', rule: 'Guerre',
    terms: ['Guerre'],
    body: 'Comparez l’influence des domaines. Les gagnants gagnent 1 or dans leur réserve ; les perdants '
      + 'perdent 1 or actif si possible.',
  },
  {
    key: 'nuit', label: 'Nuit',
    terms: ['Nuit'],
    body: 'Les effets de Nuit se résolvent, puis chaque Durée baisse de 1 et chaque Seuil de monstre est '
      + 'vérifié. Les lieux arrivés à terme expirent. La partie s’achève quand assez de lieux ont expiré.',
  },
  {
    key: 'coucher', label: 'Se coucher',
    terms: ['couché', 'couchée', 'couchés', 'couchées', 'se coucher', 'couchez'],
    body: 'Un joueur couché passe son tour jusqu’à la fin de la Journée : il ne joue plus, n’achète plus '
      + 'et ne déploie plus. Tout le monde se relève à l’Aube.',
  },

  // ------------------------------------------------------------ zones du jeu
  {
    key: 'lieu', label: 'Lieu',
    terms: ['lieu', 'lieux'],
    body: 'Les lieux occupent une rangée d’emplacements au centre de la table. Les unités s’y battent '
      + 'pour le contrôle ; un lieu finit par expirer et distribue alors ses PV.',
  },
  {
    key: 'domaine', label: 'Domaine',
    terms: ['domaine', 'domaines'],
    body: 'Votre zone en retrait, hors des lieux. Les unités et les permanents y attendent ; leur '
      + 'influence compte pour la Guerre, pas pour le contrôle d’un lieu.',
  },
  {
    key: 'main', label: 'Main',
    terms: ['main'],
    body: 'Les cartes que vous seul voyez. Elles ne produisent aucun effet tant qu’elles y restent.',
  },
  {
    key: 'deck', label: 'Deck',
    terms: ['deck', 'decks'],
    body: 'Votre pile de pioche, face cachée. Chaque faction en compte 25 cartes.',
  },
  {
    key: 'defausse', label: 'Défausse',
    terms: ['défausse'],
    body: 'Pile visible où vont les cartes détruites et défaussées. Elle n’est pas remélangée : un deck '
      + 'vide reste vide.',
  },
  {
    key: 'marche', label: 'Marché', rule: 'Marché',
    terms: ['marché'],
    body: 'Rangée de cartes neutres visibles, achetables par tous. Sans achat pendant le Jour, la plus '
      + 'ancienne repart sous le deck de marché et une nouvelle la remplace.',
  },
  {
    key: 'present', label: 'Présence sur un lieu',
    terms: ['présent', 'présente', 'présents', 'présentes'],
    body: 'Une carte est présente sur un lieu quand elle occupe l’un de ses emplacements. Une carte du '
      + 'domaine n’est présente sur aucun lieu.',
  },
  {
    key: 'adjacent', label: 'Lieu adjacent',
    terms: ['adjacent', 'adjacents', 'adjacente', 'adjacentes'],
    body: 'Les lieux forment une rangée : sont adjacents les voisins immédiats, à gauche et à droite. '
      + 'Un lieu expiré n’est adjacent à rien.',
  },

  // ----------------------------------------------------------- or et compteurs
  {
    key: 'influence', label: 'Influence', rule: 'Influence',
    terms: ['influence'],
    body: 'La force d’une carte, dans le disque en haut à gauche. Elle décide du contrôle des lieux et de '
      + 'la Guerre. Un gain sans durée précisée est permanent.',
  },
  {
    key: 'or-actif', label: 'Or actif',
    terms: ['or actif', 'ors actifs'],
    body: 'L’or dépensable immédiatement. C’est lui qui paie les coûts, les déploiements et les Actions.',
  },
  {
    key: 'reserve', label: 'Réserve',
    terms: ['réserve'],
    body: 'L’or mis de côté. Il ne paie rien tant qu’il y reste, et rejoint l’or actif à l’Aube suivante.',
  },
  {
    key: 'or', label: 'Or', rule: 'Or',
    terms: ['or', 'ors'],
    body: 'L’or gagné pendant la Journée, le Crépuscule, la Guerre ou la Nuit rejoint la réserve, sauf si '
      + 'le texte précise « or actif ».',
  },
  {
    key: 'pv', label: 'PV — points de victoire',
    terms: ['PV'],
    body: 'Les points qui décident de la partie. Un lieu qui expire les distribue selon le classement ; '
      + 'à égalité de PV, l’or total tranche.',
  },
  {
    key: 'classement', label: 'Classement sur un lieu',
    terms: ['classement'],
    body: 'À l’expiration d’un lieu, les joueurs qui y ont au moins une carte sont classés par influence '
      + 'décroissante. À influence égale, même rang — et le rang suivant est sauté.',
  },
  {
    key: 'imprime', label: 'Valeur imprimée',
    terms: ['imprimé', 'imprimée', 'imprimés', 'imprimées'],
    body: 'La valeur écrite sur la carte, avant tout modificateur en jeu.',
  },

  // ------------------------------------------------------------ ce qu'on fait
  {
    key: 'rejoindre', label: 'Rejoindre un lieu', rule: 'Rejoindre un lieu',
    terms: ['rejoint', 'rejoindre', 'rejoignent', 'rejoigne'],
    body: 'Une carte rejoint un lieu lorsqu’elle y entre depuis la main, le marché, le domaine ou un '
      + 'autre lieu.',
  },
  {
    key: 'changer-lieu', label: 'Changer de lieu', rule: 'Changer de lieu',
    terms: ['changer de lieu', 'change directement de lieu'],
    body: 'Changer directement de lieu signifie passer d’un lieu à un autre sans transiter par le domaine.',
  },
  {
    key: 'deployer', label: 'Déployer',
    terms: ['déployer', 'déployez', 'déployée', 'déployé', 'déploiement'],
    body: 'Envoyer, pendant votre tour, une unité de votre domaine sur un lieu. Le premier déploiement '
      + 'du Jour est gratuit, les suivants coûtent 1 or actif. Une unité épuisée ou arrivée le même Jour '
      + 'ne peut pas être déployée.',
  },
  {
    key: 'detruire', label: 'Détruire', rule: 'Détruire / défausser',
    terms: ['détruire', 'détruisez', 'détruit', 'détruite', 'détruits', 'détruites', 'destruction'],
    body: 'Une carte détruite rejoint la défausse et déclenche les effets liés à la destruction. Une '
      + 'carte simplement défaussée ne déclenche pas ces effets.',
  },
  {
    key: 'defausser', label: 'Défausser',
    terms: ['défausser', 'défaussez', 'défaussé', 'défaussée', 'défaussés', 'défaussées'],
    body: 'Envoyer une carte à la défausse sans destruction : les effets « lorsque détruite » ne se '
      + 'déclenchent pas.',
  },
  {
    key: 'piocher', label: 'Piocher',
    terms: ['piochez', 'piocher', 'pioche'],
    body: 'Prendre la première carte de votre deck dans votre main. Un deck vide ne donne rien.',
  },
  {
    key: 'attacher', label: 'Attachement',
    terms: ['attachez', 'attaché', 'attachée', 'attachés', 'attachées', 'attachement', 'attachements'],
    body: 'Un attachement se pose sur une unité ou sur un lieu et n’occupe pas d’emplacement pour '
      + 'lui-même. Il part avec son support : détruit avec l’unité, défaussé quand le lieu expire.',
  },
  {
    key: 'expirer', label: 'Expiration d’un lieu',
    terms: ['expire', 'expirent', 'expiré', 'expirée', 'expirés', 'expirées', 'expirer', 'expiration'],
    body: 'À la Nuit, un lieu dont la Durée tombe à 0 — ou un monstre dont le Seuil est atteint — expire. '
      + 'Il distribue ses PV, chaque joueur retient ses Survivants, le reste est détruit, et un nouveau '
      + 'lieu le remplace.',
  },
  {
    key: 'epuise', label: 'Épuisée',
    terms: ['épuisé', 'épuisée', 'épuisés', 'épuisées', 'épuiser'],
    body: 'Une carte épuisée est couchée : elle ne peut pas être déployée et ses Actions sont '
      + 'indisponibles. Tout se redresse à l’Aube.',
  },
  {
    key: 'controle', label: 'Contrôle', rule: 'Contrôle',
    terms: ['contrôle', 'contrôlez', 'contrôlé', 'contrôlée', 'contrôler', 'contrôlent'],
    body: 'Le joueur avec strictement le plus d’influence totale contrôle le lieu. En cas d’égalité, '
      + 'personne ne le contrôle.',
  },
  {
    key: 'action', label: 'Action —', rule: 'Activer un effet',
    terms: ['Action —'],
    body: 'Activer un effet précédé de « Action — » coûte une action de votre tour. Les effets déclenchés '
      + 'et les effets d’Aube, de Crépuscule ou de Nuit ne coûtent pas d’action.',
  },

  // --------------------------------------------------------- ce que sont les cartes
  {
    key: 'unite', label: 'Unité',
    terms: ['unité', 'unités'],
    body: 'La carte de base du jeu : elle vit dans votre domaine ou sur un lieu, et son influence compte '
      + 'là où elle se trouve.',
  },
  {
    key: 'permanent', label: 'Permanent',
    terms: ['permanent', 'permanents', 'permanente'],
    body: 'Reste dans votre domaine et n’en sort pas. Son influence compte pour la Guerre.',
  },
  {
    key: 'ephemere', label: 'Éphémère',
    terms: ['éphémère', 'éphémères'],
    body: 'Se résout au moment où elle est jouée, puis rejoint la défausse. Elle n’occupe aucun '
      + 'emplacement.',
  },
  {
    key: 'base', label: 'Base',
    terms: ['Base'],
    body: 'La carte de faction posée devant vous pour toute la partie : son pouvoir est toujours actif.',
  },
  {
    key: 'jeton', label: 'Jeton',
    terms: ['jeton', 'jetons'],
    body: 'Carte créée par un effet, sans coût ni place dans un deck. Détruite, elle quitte la partie au '
      + 'lieu de rejoindre une défausse.',
  },
  {
    key: 'unique', label: 'Unique',
    terms: ['unique'],
    body: 'Vous ne pouvez pas contrôler deux cartes Uniques de même nom en même temps.',
  },
  {
    key: 'monstre', label: 'Monstre', rule: 'Monstres',
    terms: ['monstre', 'monstres'],
    body: 'Les Lieux — Monstre sans Durée restent en jeu jusqu’à ce que leur Seuil soit atteint. Le Seuil '
      + 'est vérifié à la Nuit ; le monstre vaincu, le lieu expire.',
  },
  {
    key: 'allie', label: 'Carte alliée',
    terms: ['allié', 'alliée', 'alliés', 'alliées'],
    body: 'Une carte que vous contrôlez, où qu’elle soit.',
  },
  {
    key: 'adverse', label: 'Carte adverse',
    terms: ['adverse', 'adverses'],
    body: 'Une carte contrôlée par un autre joueur.',
  },

  // ---------------------------------------------------- valeurs propres aux lieux
  {
    key: 'survivant', label: 'Survivants',
    terms: ['survivant', 'survivants'],
    body: 'Quand le lieu expire, chaque joueur retient jusqu’à ce nombre de ses cartes présentes : elles '
      + 'rejoignent son domaine, épuisées. Les autres sont détruites.',
  },
  {
    key: 'duree', label: 'Durée',
    terms: ['durée'],
    body: 'Nombre de Jours que le lieu tient encore. Elle baisse de 1 chaque Nuit ; à 0, le lieu expire.',
  },
  {
    key: 'seuil', label: 'Seuil',
    terms: ['seuil'],
    body: 'Influence totale à réunir sur un monstre pour le vaincre, toutes cartes confondues. Vérifié à '
      + 'la Nuit.',
  },
  {
    key: 'ordre', label: 'Ordre actif',
    terms: ['ordre actif', 'ordre', 'ordres'],
    body: 'Kalassir suit toujours l’un de ses trois Ordres. En changer coûte 1 or actif pendant votre '
      + 'tour, sauf effet contraire.',
  },
  {
    key: 'cout-domaine', label: 'Coût de domaine',
    terms: ['coût de domaine', 'coût domaine'],
    body: 'Prix à payer en or actif pour jouer la carte dans votre domaine.',
  },
  {
    key: 'cout-lieu', label: 'Coût de lieu',
    terms: ['coût de lieu', 'coût lieu'],
    body: 'Prix à payer en or actif pour jouer la carte directement sur un lieu — plus cher, mais elle '
      + 'compte tout de suite pour le contrôle.',
  },
  {
    key: 'cout-unique', label: 'Coût unique',
    terms: ['coût unique'],
    body: 'Les éphémères et les attachements paient ce prix unique depuis la main, quelle que soit leur '
      + 'destination.',
  },
];

/**
 * Faux amis : tournures où un mot du glossaire ne parle pas du jeu. Elles
 * entrent dans la recherche comme les autres formes — les plus longues d'abord,
 * « au lieu de » passe donc avant « lieu » — mais ne mènent à aucune règle et
 * ressortent en texte ordinaire.
 *
 * La forme s'arrête sur une lettre : la frontière de fin l'exige. « au lieu d »
 * couvre « au lieu d’une ». Et elle reste collée à l'idiome — « au lieu
 * adjacent » parle bien d'un lieu de jeu.
 */
const EXCEPTIONS = ['au lieu de', 'au lieu d'];

const BY_KEY = new Map(GLOSSARY.map(e => [e.key, e]));

// Les lettres accentuées ne sont pas des « caractères de mot » pour \b : la
// frontière est vérifiée à la main. L'apostrophe n'en fait pas partie, pour que
// « l’Aube » et « d’influence » soient reconnus.
const LETTER = 'A-Za-zÀ-ÖØ-öø-ÿ';

const escape = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Les formes les plus longues d'abord : « or actif » avant « or ». */
function pattern(entries) {
  const forms = EXCEPTIONS.map(term => ({ term, key: null }));
  for (const entry of entries) {
    for (const term of entry.terms) forms.push({ term, key: entry.key });
  }
  forms.sort((a, b) => b.term.length - a.term.length);
  const alts = forms.map(f => escape(f.term)).join('|');
  return {
    re: new RegExp(`(?<![${LETTER}])(${alts})(?![${LETTER}])`, 'giu'),
    byForm: new Map(forms.map(f => [f.term.toLowerCase(), f.key])),
  };
}

let cached = null;

/**
 * Glossaire résolu pour un catalogue : les entrées liées à la feuille « À lire »
 * y prennent le texte du classeur. Mémorisé tant que le catalogue ne change pas.
 */
export function buildGlossary(catalog) {
  if (cached?.catalog === catalog) return cached;
  const fromSheet = new Map((catalog?.rules || []).map(r => [r.label, r.body]));
  const entries = GLOSSARY.map(e => ({
    ...e,
    body: (e.rule && fromSheet.get(e.rule)) || e.body,
  }));
  cached = { catalog, entries, byKey: new Map(entries.map(e => [e.key, e])), ...pattern(entries) };
  return cached;
}

/** Entrée du glossaire d'une clé, texte du classeur compris. */
export function glossaryEntry(catalog, key) {
  return buildGlossary(catalog).byKey.get(key) || BY_KEY.get(key) || null;
}

/**
 * Découpe un texte en morceaux ordinaires et en mots-clés.
 * `seen` sert à ne marquer que la première occurrence par carte : le texte
 * reste lisible et chaque règle reste accessible une fois.
 */
export function splitKeywords(text, glossary, seen = null) {
  const out = [];
  const { re, byForm } = glossary;
  re.lastIndex = 0;
  let last = 0;
  for (let m = re.exec(text); m; m = re.exec(text)) {
    const key = byForm.get(m[1].toLowerCase());
    if (!key || (seen && seen.has(key))) continue;
    if (seen) seen.add(key);
    if (m.index > last) out.push({ text: text.slice(last, m.index) });
    out.push({ text: m[1], key });
    last = m.index + m[1].length;
  }
  if (last < text.length) out.push({ text: text.slice(last) });
  return out;
}
