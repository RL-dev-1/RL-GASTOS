function slug(s) {
  return s.toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

const SEED_CATEGORIES_EXPENSE_NAMES = ['Gastos varios','Universidad','Salida Mica','Salida amigos','Desayuno','Almuerzo','Cena','Cuidado personal','Educación','Lujo','Ropa','Bebidas','Emergencia','Transporte','Hogar','Suscripción'];
const SEED_CATEGORIES_INCOME_NAMES = ['Interés','Salario','Viático','Otro ingreso'];
const SEED_MEDIOS_NAMES = ['Efectivo','Débito Itaú','TC Itaú Normal','TC Itaú Black','TC Atlas','TC GNB','TC Sudameris Plus','TC Sudameris Clásica'];

const CAT_ICONS = {'Gastos varios':'○','Universidad':'◇','Salida Mica':'♡','Salida amigos':'△','Desayuno':'◑','Almuerzo':'●','Cena':'◐','Cuidado personal':'◈','Educación':'□','Lujo':'✦','Ropa':'▪','Bebidas':'◉','Emergencia':'⚡','Transporte':'→','Hogar':'⌂','Suscripción':'↻','Interés':'↗','Salario':'$','Viático':'↗','Otro ingreso':'+'};

// Mica: id de la categoría y subcategorías (almacenadas en entry.subcategory)
const MICA_CAT_ID = 'cat_salida_mica';
const MICA_SUBCATS = [
  { id: 'cena',     label: 'Cena',          emoji: '🍽️' },
  { id: 'hotel',    label: 'Hotel',         emoji: '🏨' },
  { id: 'almuerzo', label: 'Almuerzo',      emoji: '🥪' },
  { id: 'snacks',   label: 'Snacks',        emoji: '🍿' },
  { id: 'nafta',    label: 'Nafta salidas', emoji: '⛽' }
];
const MICA_SUBCAT_LABEL = MICA_SUBCATS.reduce((m, s) => (m[s.id] = s.label, m), {});

const SEED_CAT_KEYWORDS = {
  'Universidad':['uni','universidad','ucatolica','católica','cuota uni','matrícula'],
  'Salida Mica':['mica','amor','salida mica','cena mica','date'],
  'Salida amigos':['amigos','amigo','salida amigos','boliche','bar','joda'],
  'Desayuno':['desayuno','café','coffee','cafetería','panadería','pan','medialunas'],
  'Almuerzo':['almuerzo','lunch','comida','super','supermercado','market','mercado'],
  'Cena':['cena','dinner','pizza'],
  'Cuidado personal':['barberia','barbería','gym','peluquería','farmacia','farma','crema'],
  'Educación':['libro','libros','curso','ingles','inglés','anglo','educación','idioma'],
  'Lujo':['lujo','reloj','electrónico','electronico','gadget','apple','iphone','mac','tech'],
  'Ropa':['ropa','zapatilla','zapato','camisa','pantalon','pantalón','zapatillas','remera'],
  'Bebidas':['bebida','cerveza','alcohol','whisky','vino','trago','fernet','birra'],
  'Emergencia':['emergencia','urgencia','médico','medico','hospital'],
  'Transporte':['uber','taxi','bolt','bus','nafta','estacionamiento','combustible','gasolina'],
  'Hogar':['hogar','limpieza','luz','agua','internet','alquiler','expensa'],
  'Suscripción':['suscripción','suscripcion','netflix','spotify','youtube','premium','hbo','disney'],
  'Interés':['interés','interes','cobro','cuota cobrada','rendimiento'],
  'Salario':['salario','sueldo','pago trabajo','nómina'],
  'Viático':['viatico','viático','viaje'],
  'Otro ingreso':['otro ingreso','extra','freelance','venta']
};
const SEED_MEDIO_KEYWORDS = {
  'Efectivo':['efectivo','cash','en mano'],
  'Débito Itaú':['débito itaú','debito itaú','débito itau','debito itau','debito'],
  'TC Itaú Normal':['itaú normal','itau normal','tc itaú normal','tc itau normal'],
  'TC Itaú Black':['black','itaú black','itau black','5881'],
  'TC Atlas':['atlas','tc atlas'],
  'TC GNB':['gnb','tc gnb','banco gnb'],
  'TC Sudameris Plus':['sudameris plus','tc sudameris plus'],
  'TC Sudameris Clásica':['sudameris clásica','sudameris clasica','tc sudameris clásica','tc sudameris clasica','sudameris']
};


function buildSeedCategories() {
  const nowIso = new Date().toISOString();
  const out = [];
  SEED_CATEGORIES_EXPENSE_NAMES.forEach(name => out.push({
    id: 'cat_' + slug(name), name, type: 'expense',
    keywords: SEED_CAT_KEYWORDS[name] || [],
    active: true, legacyNames: [], createdAt: nowIso, updatedAt: nowIso
  }));
  SEED_CATEGORIES_INCOME_NAMES.forEach(name => out.push({
    id: 'cat_' + slug(name), name, type: 'income',
    keywords: SEED_CAT_KEYWORDS[name] || [],
    active: true, legacyNames: [], createdAt: nowIso, updatedAt: nowIso
  }));
  return out;
}
function buildSeedPaymentMethods() {
  const nowIso = new Date().toISOString();
  return SEED_MEDIOS_NAMES.map(name => ({
    id: 'pay_' + slug(name), name,
    keywords: SEED_MEDIO_KEYWORDS[name] || [],
    active: true, legacyNames: [], createdAt: nowIso, updatedAt: nowIso
  }));
}


export { buildSeedCategories, buildSeedPaymentMethods, MICA_SUBCATS };
