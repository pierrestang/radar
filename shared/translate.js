// Radar — francisation des événements venus des flux (titres, notes, lieux).
// Traduction par dictionnaire : déterministe, gratuite, rien n'est envoyé à un service tiers.
// Les textes inconnus restent tels quels.

const COUNTRIES = {
  'Albania': 'Albanie', 'Algeria': 'Algérie', 'Andorra': 'Andorre', 'Angola': 'Angola', 'Argentina': 'Argentine',
  'Armenia': 'Arménie', 'Australia': 'Australie', 'Austria': 'Autriche', 'Azerbaijan': 'Azerbaïdjan', 'Belarus': 'Biélorussie',
  'Belgium': 'Belgique', 'Benin': 'Bénin', 'Bolivia': 'Bolivie', 'Bosnia and Herzegovina': 'Bosnie-Herzégovine',
  'Bosnia-Herzegovina': 'Bosnie-Herzégovine', 'Brazil': 'Brésil', 'Bulgaria': 'Bulgarie', 'Burkina Faso': 'Burkina Faso',
  'Cameroon': 'Cameroun', 'Canada': 'Canada', 'Cape Verde': 'Cap-Vert', 'Cape Verde Islands': 'Cap-Vert', 'Chile': 'Chili',
  'China': 'Chine', 'China PR': 'Chine', 'Colombia': 'Colombie', 'Congo': 'Congo', 'DR Congo': 'RD Congo', 'Congo DR': 'RD Congo',
  'Costa Rica': 'Costa Rica', 'Croatia': 'Croatie', 'Cuba': 'Cuba', 'Curacao': 'Curaçao', 'Curaçao': 'Curaçao', 'Cyprus': 'Chypre',
  'Czech Republic': 'Tchéquie', 'Czechia': 'Tchéquie', 'Denmark': 'Danemark', 'Ecuador': 'Équateur', 'Egypt': 'Égypte',
  'England': 'Angleterre', 'Estonia': 'Estonie', 'Faroe Islands': 'Îles Féroé', 'Finland': 'Finlande', 'France': 'France',
  'Gabon': 'Gabon', 'Georgia': 'Géorgie', 'Germany': 'Allemagne', 'Ghana': 'Ghana', 'Gibraltar': 'Gibraltar', 'Greece': 'Grèce',
  'Guinea': 'Guinée', 'Haiti': 'Haïti', 'Honduras': 'Honduras', 'Hungary': 'Hongrie', 'Iceland': 'Islande', 'India': 'Inde',
  'Indonesia': 'Indonésie', 'Iran': 'Iran', 'IR Iran': 'Iran', 'Iraq': 'Irak', 'Israel': 'Israël', 'Italy': 'Italie',
  'Ivory Coast': "Côte d'Ivoire", "Cote d'Ivoire": "Côte d'Ivoire", "Côte d'Ivoire": "Côte d'Ivoire", 'Jamaica': 'Jamaïque',
  'Japan': 'Japon', 'Jordan': 'Jordanie', 'Kazakhstan': 'Kazakhstan', 'Kosovo': 'Kosovo', 'Latvia': 'Lettonie',
  'Liechtenstein': 'Liechtenstein', 'Lithuania': 'Lituanie', 'Luxembourg': 'Luxembourg', 'Mali': 'Mali', 'Malta': 'Malte',
  'Mexico': 'Mexique', 'Moldova': 'Moldavie', 'Montenegro': 'Monténégro', 'Morocco': 'Maroc', 'Netherlands': 'Pays-Bas',
  'Holland': 'Pays-Bas', 'New Zealand': 'Nouvelle-Zélande', 'Nigeria': 'Nigeria', 'North Macedonia': 'Macédoine du Nord',
  'Northern Ireland': 'Irlande du Nord', 'Norway': 'Norvège', 'Panama': 'Panama', 'Paraguay': 'Paraguay', 'Peru': 'Pérou',
  'Poland': 'Pologne', 'Portugal': 'Portugal', 'Qatar': 'Qatar', 'Republic of Ireland': 'Irlande', 'Ireland': 'Irlande',
  'Romania': 'Roumanie', 'Russia': 'Russie', 'San Marino': 'Saint-Marin', 'Saudi Arabia': 'Arabie saoudite', 'Scotland': 'Écosse',
  'Senegal': 'Sénégal', 'Serbia': 'Serbie', 'Slovakia': 'Slovaquie', 'Slovenia': 'Slovénie', 'South Africa': 'Afrique du Sud',
  'South Korea': 'Corée du Sud', 'Korea Republic': 'Corée du Sud', 'Spain': 'Espagne', 'Sweden': 'Suède', 'Switzerland': 'Suisse',
  'Tunisia': 'Tunisie', 'Turkey': 'Turquie', 'Türkiye': 'Turquie', 'Turkiye': 'Turquie', 'Ukraine': 'Ukraine',
  'United States': 'États-Unis', 'USA': 'États-Unis', 'Uruguay': 'Uruguay', 'Uzbekistan': 'Ouzbékistan', 'Venezuela': 'Venezuela',
  'Wales': 'Pays de Galles',
};

const CLUBS = {
  'Paris Saint Germain': 'Paris Saint-Germain', 'Paris SG': 'Paris Saint-Germain', 'Olympiakos Piraeus': 'Olympiakos',
  'Olympiacos': 'Olympiakos', 'Celta Vigo': 'Celta de Vigo', 'Estac Troyes': 'ESTAC Troyes', 'Bayern Munich': 'Bayern Munich',
  'Red Star Belgrade': 'Étoile rouge de Belgrade', 'Crvena Zvezda': 'Étoile rouge de Belgrade', 'Sporting Lisbon': 'Sporting CP',
  'Atletico Madrid': 'Atlético de Madrid', 'Athletic Bilbao': 'Athletic Bilbao', 'Saint-Etienne': 'Saint-Étienne',
  'St Etienne': 'Saint-Étienne', 'Olympique Marseille': 'Marseille', 'Olympique Lyonnais': 'Lyon',
};

// Compétitions (de la plus longue à la plus courte pour éviter les remplacements partiels).
const COMPETITIONS = [
  ['UEFA Nations League', 'Ligue des nations'],
  ['UEFA Champions League', 'Ligue des champions'],
  ['UEFA Europa Conference League', 'Ligue Conférence'],
  ['UEFA Conference League', 'Ligue Conférence'],
  ['UEFA Europa League', 'Ligue Europa'],
  ['UEFA Super Cup', "Supercoupe de l'UEFA"],
  ['World Cup Qualification Europe', 'Qualifications Coupe du monde (Europe)'],
  ['World Cup Qualification UEFA', 'Qualifications Coupe du monde (Europe)'],
  ['World Cup Qualification', 'Qualifications Coupe du monde'],
  ['FIFA World Cup', 'Coupe du monde'],
  ['World Cup', 'Coupe du monde'],
  ['Club World Cup', 'Coupe du monde des clubs'],
  ['European Championship Qualification', 'Qualifications Euro'],
  ['Euro Qualification', 'Qualifications Euro'],
  ['UEFA European Championship', 'Euro'],
  ['European Championship', 'Euro'],
  ['International Friendlies', 'Match amical'],
  ['International Friendly', 'Match amical'],
  ['Friendlies', 'Match amical'],
  ['Club Friendlies', 'Match amical'],
  ['Women\'s World Cup', 'Coupe du monde féminine'],
  ['Africa Cup of Nations', "Coupe d'Afrique des nations"],
  ['Copa America', 'Copa América'],
  ['Trophee des Champions', 'Trophée des champions'],
  ['French Cup', 'Coupe de France'],
];

const STAGES = [
  [/^League Stage$/i, 'Phase de ligue'],
  [/^League ([A-D])$/i, 'Ligue $1'],
  [/^Group ([A-Z])$/i, 'Groupe $1'],
  [/^Group Stage$/i, 'Phase de groupes'],
  [/^(?:Round|Matchday|Week) (\d+)$/i, 'Journée $1'],
  [/^Knockout Round Play-?offs$/i, 'Barrages'],
  [/^Play-?offs?$/i, 'Barrages'],
  [/^Play-?off Round$/i, 'Barrages'],
  [/^Round of 64$/i, '32es de finale'],
  [/^Round of 32$/i, '16es de finale'],
  [/^Round of 16$/i, 'Huitièmes de finale'],
  [/^Last 16$/i, 'Huitièmes de finale'],
  [/^Quarter-?finals?$/i, 'Quarts de finale'],
  [/^Semi-?finals?$/i, 'Demi-finales'],
  [/^Third Place(?: Play-?off)?$/i, 'Match pour la 3e place'],
  [/^3rd Place(?: Final)?$/i, 'Match pour la 3e place'],
  [/^Final$/i, 'Finale'],
  [/^Finals$/i, 'Phase finale'],
  [/^(\d+)(?:st|nd|rd|th) Qualifying Round$/i, '$1er tour de qualification'],
  [/^Qualifying Round$/i, 'Tour de qualification'],
  [/^Preliminary Round$/i, 'Tour préliminaire'],
  [/^Regular Season$/i, 'Saison régulière'],
];

const CITIES = {
  'London': 'Londres', 'Munich': 'Munich', 'Seville': 'Séville', 'Lisbon': 'Lisbonne', 'Athens': 'Athènes', 'Piraeus': 'Le Pirée',
  'Genoa': 'Gênes', 'Naples': 'Naples', 'Turin': 'Turin', 'Florence': 'Florence', 'Venice': 'Venise', 'Vienna': 'Vienne',
  'Warsaw': 'Varsovie', 'Copenhagen': 'Copenhague', 'Brussels': 'Bruxelles', 'Antwerp': 'Anvers', 'Bruges': 'Bruges',
  'Cologne': 'Cologne', 'Moscow': 'Moscou', 'Bucharest': 'Bucarest', 'Edinburgh': 'Édimbourg', 'Geneva': 'Genève',
  'Basel': 'Bâle', 'Bern': 'Berne', 'Lucerne': 'Lucerne', 'The Hague': 'La Haye', 'Gothenburg': 'Göteborg', 'Prague': 'Prague',
  'Belgrade': 'Belgrade', 'Zagreb': 'Zagreb', 'Tbilisi': 'Tbilissi', 'Baku': 'Bakou', 'Valletta': 'La Valette',
  'Dusseldorf': 'Düsseldorf', 'Nuremberg': 'Nuremberg', 'Mainz': 'Mayence', 'Aachen': 'Aix-la-Chapelle', 'Saint Petersburg': 'Saint-Pétersbourg',
};

const RESULT_TAGS = { FT: 'terminé', AET: 'après prolongation', PEN: 'aux tirs au but', HT: 'mi-temps', LIVE: 'en cours', POSTP: 'reporté', CANC: 'annulé' };

const decode = (s) => String(s)
  .replace(/&apos;|&#0?39;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&nbsp;/g, ' ');

const team = (name) => {
  const n = name.trim();
  return COUNTRIES[n] || CLUBS[n] || n;
};

export function frTitle(title) {
  let t = decode(title).trim();
  // « Italy v France », « Italy vs. France », « Italy - France »
  let m = t.match(/^(.+?)\s+(?:v|vs\.?|VS|versus)\s+(.+?)(?:\s+\((\w+)\))?$/);
  if (m) return `${team(m[1])} VS ${team(m[2])}${m[3] ? ` (${RESULT_TAGS[m[3].toUpperCase()] || m[3]})` : ''}`;
  // « Austria 0-1 France (FT) »
  m = t.match(/^(.+?)\s+(\d+)\s*[-–:]\s*(\d+)\s+(.+?)(?:\s+\((\w+)\))?$/);
  if (m) return `${team(m[1])} ${m[2]}-${m[3]} ${team(m[4])}${m[5] ? ` (${RESULT_TAGS[m[5].toUpperCase()] || m[5]})` : ''}`;
  return t;
}

function frCompetitionLine(line) {
  // « UEFA Nations League - League A - 5 » → « Ligue des nations · Ligue A · Journée 5 »
  const parts = line.split(/\s+-\s+/);
  let comp = parts[0];
  let known = false;
  for (const [en, fr] of COMPETITIONS) if (comp === en || comp.startsWith(en + ' ')) { comp = comp.replace(en, fr); known = true; break; }
  if (/^Ligue \d$|^Coupe de France$|^Premier League$|^La ?Liga$|^Serie A$|^Bundesliga$/i.test(comp)) known = true;
  if (!known || parts.length === 1) return known ? comp : null;
  const rest = parts.slice(1).map((p, i, arr) => {
    for (const [re, fr] of STAGES) if (re.test(p)) return p.replace(re, fr);
    if (/^\d+$/.test(p) && i === arr.length - 1) return `Journée ${p}`;
    return p;
  });
  return [comp, ...rest].join(' · ');
}

export function frNotes(notes) {
  return decode(notes).split('\n').map((line) => {
    const l = line.trim();
    let m;
    if ((m = l.match(/^Half[- ]?time:?\s*(\d+\s*[-–]\s*\d+)$/i))) return `Mi-temps : ${m[1].replace(/\s/g, '')}`;
    if ((m = l.match(/^Full[- ]?time:?\s*(\d+\s*[-–]\s*\d+)$/i))) return `Score final : ${m[1].replace(/\s/g, '')}`;
    if ((m = l.match(/^Venue:?\s*(.+)$/i))) return `Stade : ${m[1]}`;
    if ((m = l.match(/^Attendance:?\s*(.+)$/i))) return `Affluence : ${m[1]}`;
    if ((m = l.match(/^(?:TV|Broadcast(?:er)?s?|Channel)s?:?\s*(.+)$/i))) return `Diffusion : ${m[1]}`;
    if ((m = l.match(/^Kick[- ]?off:?\s*(.+)$/i))) return `Coup d'envoi : ${m[1]}`;
    return frCompetitionLine(l) || line;
  }).join('\n');
}

/** Retire les lignes inutiles (arbitres) et les lignes vides en trop. */
export function cleanNotes(notes) {
  return String(notes).split('\n')
    .filter((l) => !/^\s*(?:Referees?|Arbitres?|Assistant referees?|VAR)\s*:/i.test(l))
    .filter((l) => !/^\s*(?:Airs on |Powered by |Data from Wikidata|US movie release date|Support Fixtur\.es)/i.test(l))
    .join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

export function frLocation(loc) {
  const s = decode(loc).trim();
  const i = s.lastIndexOf(',');
  if (i < 0) return CITIES[s] || s;
  // « Stade, Ville » → on ne garde que le stade
  return s.slice(0, i).trim();
}

/** Renvoie une copie francisée d'un événement de flux. */
export function frenchify(ev) {
  const out = { ...ev, title: frTitle(ev.title) };
  if (ev.notes) out.notes = frNotes(cleanNotes(ev.notes)) || undefined;
  if (ev.location) out.location = frLocation(ev.location);
  return out;
}
