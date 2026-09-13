// Default seed data: the Meadows Park Restaurant menu (Chemperi).
// Prices are in paise and represent menu prices.

import { DEFAULT_BILL_LAYOUT, type Category, type MenuItem, type State } from './types';

/**
 * Bump this whenever the bundled seed menu below changes. Saved states whose
 * `menuVersion` is older get their categories/items replaced by the current
 * seed menu on load (see store.normalizeState) — this is how menu updates
 * reach existing installs.
 */
export const MENU_VERSION = 3;

interface SeedItem {
  n: string;
  p: number; // paise
  v?: boolean; // veg, default true
  s?: number; // stock, default unlimited
  c: number; // category index
  vrs?: { id: string; label: string; price: number }[]; // size/portion variants
}

function cat(id: string, name: string, sort: number): Category {
  return { id, name, sort };
}

const HALF = (p: number) => ({ id: 'v-1', label: 'Half', price: p });
const FULL = (p: number) => ({ id: 'v-2', label: 'Full', price: p });
const FAMILY = (p: number) => ({ id: 'v-3', label: 'Family', price: p });

export function seedItems(): MenuItem[] {
  const C = {
    bev: 'cat-bev', // Tea & Coffee
    bf: 'cat-bf', // Breakfast
    noodles: 'cat-noodles', // Noodles
    chicken: 'cat-chicken', // Chicken
    breads: 'cat-breads', // Bread
    soup: 'cat-soup', // Soup
    biryani: 'cat-biryani', // Biriyani
    rice: 'cat-rice', // Rice & Pulao
    veg: 'cat-veg', // Veg
    fish: 'cat-fish', // Fish
    tattukada: 'cat-tattukada', // Tattukada Special
    beef: 'cat-beef', // Beef
    grill: 'cat-grill', // Grill
    meals: 'cat-meals', // Meals
  } as const;

  const raw: SeedItem[] = [
    // Tea & Coffee
    { c: 0, n: 'Tea', p: 1500 },
    { c: 0, n: 'Coffee', p: 2000 },
    { c: 0, n: 'Black Tea', p: 1000 },
    { c: 0, n: 'Lime Tea', p: 1500 },
    { c: 0, n: 'Horlicks & Boost', p: 3000 },
    { c: 0, n: 'Milk', p: 2500 },
    // Breakfast
    { c: 1, n: 'Masala Dosa', p: 7000 },
    { c: 1, n: 'Ghee Roast', p: 5000 },
    { c: 1, n: 'Appam', p: 1500 },
    { c: 1, n: 'Idiyappam', p: 1500 },
    { c: 1, n: 'Poori', p: 1500 },
    { c: 1, n: 'Puttu', p: 1500 },
    { c: 1, n: 'Bhaji', p: 4000 },
    { c: 1, n: 'Kadala', p: 4000 },
    { c: 1, n: 'Green Peas', p: 4000 },
    { c: 1, n: 'Egg Roast', p: 4000, v: false },
    { c: 1, n: 'Egg Curry', p: 4000, v: false },
    // Noodles
    { c: 2, n: 'Veg Noodles', p: 12000 },
    { c: 2, n: 'Egg Noodles', p: 14000, v: false },
    { c: 2, n: 'Chicken Noodles', p: 15000, v: false },
    { c: 2, n: 'Schezwan Chicken Noodles', p: 17000, v: false },
    // Chicken
    {
      c: 3,
      n: 'Chilly Chicken',
      p: 14000,
      v: false,
      vrs: [HALF(14000), FULL(28000), FAMILY(52000)],
    },
    {
      c: 3,
      n: 'Chicken Manchurian',
      p: 14000,
      v: false,
      vrs: [HALF(14000), FULL(28000), FAMILY(52000)],
    },
    {
      c: 3,
      n: 'Garlic Chicken',
      p: 15000,
      v: false,
      vrs: [HALF(15000), FULL(30000), FAMILY(58000)],
    },
    {
      c: 3,
      n: 'Ginger Chicken',
      p: 15000,
      v: false,
      vrs: [HALF(15000), FULL(30000), FAMILY(58000)],
    },
    {
      c: 3,
      n: 'Butter Chicken',
      p: 15000,
      v: false,
      vrs: [HALF(15000), FULL(32000), FAMILY(58000)],
    },
    // Bread
    { c: 4, n: 'Porotta', p: 1500 },
    { c: 4, n: 'Chapathi', p: 1500 },
    { c: 4, n: 'Kuboos', p: 1200 },
    { c: 4, n: 'Pathal', p: 1500 },
    // Soup
    {
      c: 5,
      n: 'Dragon Chicken',
      p: 15000,
      v: false,
      vrs: [HALF(15000), FULL(30000), FAMILY(58000)],
    },
    { c: 5, n: 'Chicken Masala', p: 20000, v: false },
    { c: 5, n: 'Chicken 65', p: 13000, v: false },
    { c: 5, n: 'Pepper Chicken', p: 20000, v: false },
    { c: 5, n: 'Sweet Corn Chicken', p: 10000, v: false },
    { c: 5, n: 'Hot & Sour Veg', p: 10000 },
    { c: 5, n: 'Hot & Sour Chicken', p: 12000, v: false },
    { c: 5, n: 'Manchow Veg', p: 10000 },
    { c: 5, n: 'Manchow Chicken', p: 12000, v: false },
    // Biriyani
    {
      c: 6,
      n: 'Chicken Biriyani',
      p: 14000,
      v: false,
      vrs: [HALF(14000), FULL(18000)],
    },
    { c: 6, n: 'Chicken Chill Biryani', p: 18000, v: false },
    { c: 6, n: 'Chicken Kizhi Biryani', p: 20000, v: false },
    {
      c: 6,
      n: 'Beef Biryani',
      p: 15000,
      v: false,
      vrs: [HALF(15000), FULL(20000)],
    },
    { c: 6, n: 'Egg Biryani', p: 14000, v: false },
    // "Seasonal" — price varies; set to a sensible default, editable in Menu.
    { c: 6, n: 'Fish Biryani', p: 20000, v: false },
    // Rice & Pulao
    { c: 7, n: 'Veg Fried Rice', p: 12000 },
    { c: 7, n: 'Egg Fried Rice', p: 14000, v: false },
    { c: 7, n: 'Chicken Fried Rice', p: 15000, v: false },
    { c: 7, n: 'Schezwan Chicken Fried Rice', p: 17000, v: false },
    { c: 7, n: 'Lemon Rice', p: 12000 },
    { c: 7, n: 'Jeera Rice', p: 12000 },
    { c: 7, n: 'Veg Pulao', p: 13000 },
    { c: 7, n: 'Green Peas Pulao', p: 13000 },
    { c: 7, n: 'Kashmiri Pulao', p: 14000 },
    // Veg
    { c: 8, n: 'Dal Fry', p: 8000 },
    { c: 8, n: 'Dal Tadka', p: 8000 },
    { c: 8, n: 'Tomato Fry', p: 8000 },
    {
      c: 8,
      n: 'Chilly Gobi',
      p: 9000,
      vrs: [HALF(9000), FULL(18000)],
    },
    {
      c: 8,
      n: 'Gobi Manchurian',
      p: 9000,
      vrs: [HALF(9000), FULL(18000)],
    },
    { c: 8, n: 'Chilly Paneer', p: 14000 },
    { c: 8, n: 'Paneer Butter Masala', p: 15000 },
    // Fish — "Seasonal"/"A/P Size" items get a sensible default, editable in Menu.
    { c: 9, n: 'Fish Curry', p: 15000, v: false },
    { c: 9, n: 'Fish Masala', p: 15000, v: false },
    { c: 9, n: 'Fish Roast', p: 20000, v: false },
    { c: 9, n: 'Fish Pollichathu', p: 20000, v: false },
    // Tattukada Special
    { c: 10, n: 'Appam Mix Egg', p: 12000, v: false },
    { c: 10, n: 'Appam Mix Chicken', p: 14000, v: false },
    { c: 10, n: 'Appam Mix Beef', p: 15000, v: false },
    { c: 10, n: 'Appam Pollichathu', p: 15000, v: false },
    { c: 10, n: 'Special Pollichathu', p: 18000, v: false },
    { c: 10, n: 'Bread Omlet', p: 8000, v: false },
    { c: 10, n: 'Steamed Bread with Chicken Stew', p: 15000, v: false },
    { c: 10, n: 'Mushroom Masala', p: 16000 },
    { c: 10, n: 'Mushroom Chilly', p: 15000 },
    { c: 10, n: 'Kadai Veg', p: 15000 },
    // Beef
    { c: 11, n: 'Beef Fry', p: 13000, v: false },
    { c: 11, n: 'Beef Roast', p: 15000, v: false },
    { c: 11, n: 'Beef Masala', p: 15000, v: false },
    {
      c: 11,
      n: 'Beef Chilly',
      p: 15000,
      v: false,
      vrs: [HALF(15000), FULL(30000), FAMILY(56000)],
    },
    {
      c: 11,
      n: 'Beef Dry Fry',
      p: 16000,
      v: false,
      vrs: [HALF(16000), FULL(30000), FAMILY(60000)],
    },
    // Grill
    {
      c: 12,
      n: 'Alfaham (N)',
      p: 14000,
      v: false,
      vrs: [HALF(14000), FULL(28000), FAMILY(52000)],
    },
    {
      c: 12,
      n: 'Peri Peri',
      p: 15000,
      v: false,
      vrs: [HALF(15000), FULL(30000), FAMILY(60000)],
    },
    {
      c: 12,
      n: 'Pepper',
      p: 15000,
      v: false,
      vrs: [HALF(15000), FULL(30000), FAMILY(60000)],
    },
    {
      c: 12,
      n: 'Honey Chilly',
      p: 15000,
      v: false,
      vrs: [HALF(15000), FULL(30000), FAMILY(60000)],
    },
    {
      c: 12,
      n: 'Dragon',
      p: 16000,
      v: false,
      vrs: [HALF(16000), FULL(33000), FAMILY(64000)],
    },
    {
      c: 12,
      n: 'Cheese',
      p: 16000,
      v: false,
      vrs: [HALF(16000), FULL(32000), FAMILY(64000)],
    },
    {
      c: 12,
      n: 'Jeliket',
      p: 16000,
      v: false,
      vrs: [HALF(16000), FULL(32000), FAMILY(65000)],
    },
    { c: 12, n: 'Chicken Chukka', p: 20000, v: false },
    { c: 12, n: 'Chicken Kondattam', p: 20000, v: false },
    { c: 12, n: 'Chicken Dry Fry', p: 15000, v: false },
    { c: 12, n: 'Chicken Porichathu', p: 15000, v: false },
    // "Seasonal" — price varies; set to a sensible default, editable in Menu.
    { c: 12, n: 'Fish Nirvana', p: 20000, v: false },
    { c: 12, n: 'Prawns Nirvana', p: 20000, v: false },
    // Meals
    { c: 13, n: 'Meals', p: 7000 },
  ];

  const catOf = (i: number) =>
    [
      C.bev,
      C.bf,
      C.noodles,
      C.chicken,
      C.breads,
      C.soup,
      C.biryani,
      C.rice,
      C.veg,
      C.fish,
      C.tattukada,
      C.beef,
      C.grill,
      C.meals,
    ][i];

  return raw.map((it, i) => ({
    id: `it-${i + 1}`,
    categoryId: catOf(it.c),
    name: it.n,
    price: it.p,
    veg: it.v ?? true,
    available: true,
    stock: it.s ?? null,
    sort: i,
    photo: '',
    variants: it.vrs ?? [],
  }));
}

export function seedCategories(): Category[] {
  return [
    cat('cat-bev', 'Tea & Coffee', 0),
    cat('cat-bf', 'Breakfast', 1),
    cat('cat-noodles', 'Noodles', 2),
    cat('cat-chicken', 'Chicken', 3),
    cat('cat-breads', 'Bread', 4),
    cat('cat-soup', 'Soup', 5),
    cat('cat-biryani', 'Biriyani', 6),
    cat('cat-rice', 'Rice & Pulao', 7),
    cat('cat-veg', 'Veg', 8),
    cat('cat-fish', 'Fish', 9),
    cat('cat-tattukada', 'Tattukada Special', 10),
    cat('cat-beef', 'Beef', 11),
    cat('cat-grill', 'Grill', 12),
    cat('cat-meals', 'Meals', 13),
  ];
}

export function seedState(): State {
  const today = new Date();
  const ymd = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
  const tableNames = Array.from({ length: 12 }, (_, i) => String(i + 1));
  return {
    version: 1,
    menuVersion: MENU_VERSION,
    profile: {
      name: 'Meadows Park Restaurant',
      address: 'Chemperi',
      phone: '+91 98470 12345',
      fssai: '11523999000123',
      invoicePrefix: 'INV-',
      upiId: '',
      upiName: '',
      footerNote: 'Thank you! Please visit again.',
      tableNames,
      logo: '',
    },
    billing: {
      serviceChargePct: 0,
      roundOff: true,
      kotEnabled: true,
      kotCounter: 0,
      thermalWidth: '80',
      thermalCustomWidth: 80,
      rolloverTime: '00:00',
      billLayout: DEFAULT_BILL_LAYOUT,
    },
    auth: {
      users: [
        { id: 'u-admin', name: 'Manager', pin: '0000', role: 'admin' },
        { id: 'u-waiter', name: 'Waiter', pin: '2222', role: 'waiter' },
        { id: 'u-kitchen', name: 'Kitchen', pin: '1111', role: 'kitchen' },
      ],
      settingsPin: '1234',
    },
    gateway: {
      enabled: false,
      keyId: '',
      serverUrl: 'http://localhost:8787',
    },
    categories: seedCategories(),
    items: seedItems(),
    orders: [],
    kots: [],
    expenses: [],
    invoiceCounter: 0,
    invoiceCounterDate: ymd,
    kotCounter: 0,
    kotCounterDate: ymd,
    autoBackup: 'daily',
    lastRolloverDate: ymd,
    lastSavedAt: Date.now(),
  };
}