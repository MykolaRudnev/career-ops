const COUNTRY_RULES = [
  ["Poland", /\b(?:poland|polska|warszawa|warsaw|krakow|wroclaw|gdansk|poznan|lodz|katowice|gliwice)\b/],
  ["Germany", /\b(?:germany|deutschland|berlin|hamburg|munich|munchen|frankfurt|stuttgart|cologne|koln|dusseldorf)\b/],
  ["Netherlands", /\b(?:netherlands|nederland|amsterdam|rotterdam|utrecht|eindhoven)\b/],
  ["Sweden", /\b(?:sweden|sverige|stockholm|gothenburg|goteborg|malmo)\b/],
  ["Finland", /\b(?:finland|suomi|helsinki|espoo|vantaa|tampere|turku)\b/],
  ["Denmark", /\b(?:denmark|danmark|copenhagen|kobenhavn|aarhus)\b/],
  ["Norway", /\b(?:norway|norge|oslo|bergen|trondheim)\b/],
  ["Czechia", /\b(?:czechia|czech republic|prague|praha|brno|ostrava)\b/],
  ["Slovakia", /\b(?:slovakia|slovensko|bratislava|kosice)\b/],
  ["Lithuania", /\b(?:lithuania|lietuva|vilnius|kaunas)\b/],
  ["Latvia", /\b(?:latvia|latvija|riga)\b/],
  ["Estonia", /\b(?:estonia|eesti|tallinn|tartu)\b/],
  ["Austria", /\b(?:austria|osterreich|vienna|wien|graz|linz|salzburg)\b/],
  ["Switzerland", /\b(?:switzerland|schweiz|suisse|zurich|geneva|geneve|basel|lausanne)\b/],
  ["Ireland", /\b(?:ireland|dublin|cork|galway|limerick)\b/],
  ["United Kingdom", /\b(?:united kingdom|great britain|uk|england|scotland|wales|london|manchester|edinburgh|glasgow|birmingham|bristol)\b/],
  ["France", /\b(?:france|paris|lyon|marseille|toulouse|bordeaux|lille)\b/],
  ["Belgium", /\b(?:belgium|belgie|brussels|bruxelles|antwerp|antwerpen|ghent|gent)\b/],
  ["Luxembourg", /\bluxembourg\b/],
  ["Portugal", /\b(?:portugal|lisbon|lisboa|porto)\b/],
  ["Spain", /\b(?:spain|espana|madrid|barcelona|valencia|seville|sevilla|malaga)\b/],
  ["Italy", /\b(?:italy|italia|milan|milano|rome|roma|turin|torino|bologna)\b/],
  ["Romania", /\b(?:romania|bucharest|bucuresti|cluj|timisoara)\b/],
  ["Hungary", /\b(?:hungary|magyarorszag|budapest)\b/],
  ["Croatia", /\b(?:croatia|hrvatska|zagreb|split)\b/],
  ["Slovenia", /\b(?:slovenia|slovenija|ljubljana|maribor)\b/],
  ["Bulgaria", /\b(?:bulgaria|sofia|plovdiv|varna)\b/],
  ["Greece", /\b(?:greece|athens|thessaloniki)\b/],
  ["Cyprus", /\b(?:cyprus|nicosia|limassol)\b/],
  ["Malta", /\b(?:malta|valletta)\b/],
  ["Iceland", /\b(?:iceland|reykjavik)\b/],
  ["United States", /\b(?:united states|usa|new york|san francisco|california|texas|seattle|boston|chicago)\b/],
  ["Canada", /\b(?:canada|toronto|vancouver|montreal|ottawa|calgary)\b/],
  ["Australia", /\b(?:australia|sydney|melbourne|brisbane|perth|adelaide)\b/],
  ["New Zealand", /\b(?:new zealand|auckland|wellington|christchurch)\b/],
];

function foldLocation(value) {
  return value
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .replace(/[łŁ]/g, "l")
    .replace(/[øØ]/g, "o")
    .replace(/ß/g, "ss")
    .toLowerCase();
}

export function inferJobCountries(location) {
  const text = typeof location === "string" ? location.trim() : "";
  if (!text) return ["Unknown"];

  const folded = foldLocation(text);
  const countries = COUNTRY_RULES.filter(([, pattern]) => pattern.test(folded)).map(([country]) => country);
  if (countries.length) return [...new Set(countries)];
  if (/\b(?:worldwide|anywhere|global)\b/.test(folded)) return ["Worldwide"];
  if (/\b(?:emea|europe|eu|european union)\b/.test(folded)) return ["Europe / EMEA"];
  return ["Unknown"];
}
