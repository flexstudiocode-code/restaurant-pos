// ── Core domain types for the restaurant POS ────────────────────────────────
// All money values are stored as integer PAISE (₹1 = 100). Never use floats
// for money. See money.ts for helpers.

export type Role = 'admin' | 'waiter' | 'kitchen';
export type OrderType = 'dine-in' | 'takeaway' | 'delivery';
export type OrderStatus = 'open' | 'paid' | 'void';
export type PaymentMethod = 'cash' | 'upi' | 'card';
export type PricingMode = 'inclusive' | 'exclusive';

/** Optional online payments via Razorpay Checkout (card / UPI / netbanking).
 *  Only the PUBLIC Key ID lives in the app; the secret key stays on the
 *  payment helper server (server/) which creates orders and verifies
 *  signatures — the app never sees card data or the secret. */
export interface PaymentGatewaySettings {
  enabled: boolean;
  /** Razorpay public Key ID, e.g. `rzp_test_…` (test) or `rzp_live_…` (live). */
  keyId: string;
  /** Base URL of the payment helper server, e.g. http://localhost:8787 */
  serverUrl: string;
}

export interface RestaurantProfile {
  name: string;
  address: string;
  phone: string;
  gstin: string;
  fssai: string;
  invoicePrefix: string;
  upiId: string;
  upiName: string;
  footerNote: string;
  tableNames: string[]; // e.g. ['1', '2', ...] — editable labels
  logo: string; // data URL of the restaurant logo, '' = default 🍽 badge
}

export interface BillingSettings {
  pricingMode: PricingMode; // do menu prices include GST? (default exclusive — GST added on top)
  /** One-time migration flag (v1.2.7): true once pricingMode has been set to
   *  'exclusive'. Keeps later manual choices made in Settings intact. */
  pricingMigrated?: boolean;
  serviceChargePct: number; // 0 = disabled
  roundOff: boolean; // round grand total to nearest rupee
  defaultGstRate: number; // % used for new items
  kotEnabled: boolean;
  kotCounter: number; // daily KOT counter (resets each day)
  thermalWidth: '58' | '80' | 'custom'; // thermal printer paper width setting
  thermalCustomWidth: number; // mm for 'custom' width (e.g. a 76mm roll)
  rolloverTime: string; // 'HH:MM' 24h — when the day rolls over automatically (default '00:00')
  /** User-customisable bill design (see BillDesignScreen). */
  billLayout: BillLayout;
}

/** User-editable design of the bill/receipt (screen, print, thermal, WhatsApp).
 *  Header/footer lines support {placeholders} (see applyBillPlaceholders in
 *  billLayout.ts). */
export interface BillLayout {
  version: number;
  /** Custom centred lines shown under the restaurant name header. */
  headerLines: string[];
  /** Custom centred footer lines. Empty = fall back to profile.footerNote. */
  footerLines: string[];
  showRestaurantName: boolean; // script + sans-serif restaurant name block
  showTaxInvoiceLabel: boolean; // the 'TAX INVOICE' line
  showColumnHeaders: boolean; // Dish | Qty | Amnt header row
  showMarkers: boolean; // veg (*) / non-veg (#) markers on item rows
  showInvoiceDetails: boolean; // invoice no / date / type / customer block
  showTaxSummary: boolean; // per-slab GST summary lines
  showPayments: boolean; // payments + change
  showFooter: boolean; // footer lines + thank-you
  /** Printed text scale — bigger for easier reading on the paper roll. */
  printSize: 'small' | 'medium' | 'large';
  /** Fine font-size control: percent of the default bill size (80–150).
   *  Applies on screen, in the system Print dialog and on thermal/USB
   *  printers (where the receipt re-wraps to fewer chars per line so the
   *  larger text still fits the paper). */
  fontSizePct: number;
  /** Body-text thickness of the bill (headers keep their own weights).
   *  Applies on screen, in the Print dialog and on thermal/USB printers. */
  fontWeight: 'regular' | 'bold' | 'extrabold';
}

export const DEFAULT_BILL_LAYOUT: BillLayout = {
  version: 1,
  headerLines: [],
  footerLines: [],
  showRestaurantName: true,
  showTaxInvoiceLabel: true,
  showColumnHeaders: true,
  showMarkers: true,
  showInvoiceDetails: true,
  showTaxSummary: true,
  showPayments: true,
  showFooter: true,
  printSize: 'medium',
  fontSizePct: 100,
  fontWeight: 'regular',
};

/** Effective thermal paper width in millimetres for a stored setting. */
export function thermalWidthMm(
  width: BillingSettings['thermalWidth'],
  customMm: number | undefined
): number {
  if (width === 'custom') {
    const m = Math.round(Number(customMm));
    return Number.isFinite(m) ? Math.min(120, Math.max(30, m)) : 80;
  }
  return width === '80' ? 80 : 58;
}

export const EXPENSE_CATEGORIES = [
  'Ingredients & Raw Materials',
  'Staff Salaries',
  'Rent',
  'Electricity & Utilities',
  'Gas & Fuel',
  'Maintenance',
  'Packaging',
  'Marketing',
  'Miscellaneous',
] as const;

export interface Expense {
  id: string;
  amount: number; // paise
  category: string;
  note: string;
  createdAt: number; // epoch ms (defaults to today)
}

/** A staff member who can sign in with a 4-digit PIN. */
export interface StaffUser {
  id: string;
  name: string;
  pin: string; // 4-digit PIN used to sign in
  role: Role;
}

export interface AuthSettings {
  users: StaffUser[];
  settingsPin: string; // 4-digit PIN to open the Settings tab (default 1234)
}

export type AutoBackupFreq = 'off' | 'daily' | 'weekly' | 'monthly';

export interface Category {
  id: string;
  name: string;
  sort: number;
}

export interface MenuItemVariant {
  id: string;
  label: string; // e.g. 'Half 1/2KG' or 'Full 1KG'
  price: number; // paise, snapshot at order time
}

export interface MenuItem {
  id: string;
  categoryId: string;
  name: string;
  price: number; // paise, per unit (exclusive or inclusive per billing mode)
  gstRate: number; // 0 | 5 | 12 | 18 | 28
  hsn: string;
  veg: boolean; // true = veg, false = non-veg
  available: boolean;
  stock: number | null; // null = unlimited
  sort: number;
  photo: string; // data URL of a small thumbnail, '' = no photo
  variants: MenuItemVariant[]; // optional size/portion variants; [] = no variants
}

export interface OrderLine {
  id: string; // unique within the order
  itemId: string;
  name: string; // snapshot of item name at order time
  unitPrice: number; // paise (snapshot)
  qty: number; // integer > 0
  gstRate: number; // snapshot
  hsn: string; // snapshot
  veg: boolean; // snapshot
  note: string; // item note (e.g. "less spicy")
  kotPrinted: boolean; // has this line already been sent to the kitchen
  variantId?: string; // which size/portion variant this line was ordered as
}

export interface Payment {
  id: string;
  method: PaymentMethod;
  amount: number; // paise
  receivedAt: number; // epoch ms
  /** Gateway reference (e.g. Razorpay payment id) for verified online payments. */
  ref?: string;
  /** Which gateway collected this payment, when it was an online payment. */
  gateway?: 'razorpay';
}

export interface Order {
  id: string;
  invoiceNo: string; // e.g. INV-000123 (assigned at payment time; '' while open)
  kotNos: string[]; // KOT numbers generated for this order
  gstEnabled: boolean; // charge/issue GST on this bill (toggle at checkout)
  type: OrderType;
  tableIndex: number | null; // index into settings.tableNames (dine-in only)
  customerName: string; // optional, for delivery/takeaway
  customerPhone: string; // optional
  customerAddress: string; // optional, mainly for delivery
  orderNote: string; // note for the kitchen / rider (shown on KOT)
  lines: OrderLine[];
  discount: number; // paise, entered at checkout
  serviceCharge: number; // paise, computed at checkout
  deliveryCharge: number; // paise, flat delivery fee (delivery orders); added after tax, not discounted
  status: OrderStatus;
  payments: Payment[];
  createdAt: number; // epoch ms
  paidAt: number | null;
  voidReason: string;
  staffName: string; // who created/owns the order
  closedBy: string | null;
  updatedAt: number; // epoch ms — last change; used for LAN sync (last-write-wins)
}

export interface KOT {
  id: string;
  orderId: string;
  kotNo: number;
  tableLabel: string;
  orderType: OrderType;
  items: { name: string; qty: number; note: string }[];
  orderNote: string;
  status: 'pending' | 'ready' | 'served';
  createdAt: number;
  readyAt: number | null;
  servedAt: number | null;
  updatedAt: number; // epoch ms — last change; used for LAN sync (last-write-wins)
}

export interface State {
  version: number;
  /** Bumped whenever the bundled seed menu changes; saved states with an
   *  older menuVersion get their categories/items replaced by the new seed
   *  menu on load (see seed.ts MENU_VERSION / store.normalizeState). */
  menuVersion: number;
  profile: RestaurantProfile;
  billing: BillingSettings;
  /** Optional online payment gateway (Razorpay). Off when disabled; the
   *  manual cash / UPI-QR / card flow always remains available. */
  gateway: PaymentGatewaySettings;
  auth: AuthSettings;
  categories: Category[];
  items: MenuItem[];
  orders: Order[];
  kots: KOT[];
  expenses: Expense[];
  invoiceCounter: number;
  invoiceCounterDate: string; // business-day key — invoice numbers reset at each rollover
  kotCounter: number;
  kotCounterDate: string;
  autoBackup: AutoBackupFreq; // automatic snapshot frequency
  lastRolloverDate: string; // business-day key the automatic end-of-day rollover last ran for
  lastSavedAt: number;
}

// ── UI navigation ───────────────────────────────────────────────────────────
export type Tab = 'tables' | 'kitchen' | 'orders' | 'reports' | 'menu' | 'settings' | 'expenses';

export type Screen =
  | { name: 'tab' }
  | { name: 'order'; orderId: string }
  | { name: 'receipt'; orderId: string }
  | { name: 'menuEdit'; itemId: string | null }
  | { name: 'billDesign' };

export const GST_RATES = [0, 5, 12, 18, 28] as const;
export const DEFAULT_HSN = '9963'; // restaurant services / food served

export function uid(): string {
  return (
    Date.now().toString(36) + Math.random().toString(36).slice(2, 10)
  );
}
