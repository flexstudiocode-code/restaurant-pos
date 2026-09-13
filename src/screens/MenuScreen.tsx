import { useMemo, useRef, useState } from 'react';
import { useStore } from '../store';
import type { Category, MenuItem } from '../types';
import { GST_RATES, DEFAULT_HSN, uid } from '../types';
import { fmt, rupeesToPaise, fmtQty } from '../money';
import { Modal, EmptyState, Switch, Chips } from '../components/ui';
import { IconPlus, IconEdit, IconTrash } from '../components/icons';
import { fileToPhotoDataUrl } from '../photo';

export function MenuScreen() {
  const { state, saveCategory, deleteCategory, saveItem, deleteItem, toggleItemAvailable, notify, exportMenu, setTab } = useStore();
  const [editingItem, setEditingItem] = useState<MenuItem | null>(null);
  const [creatingItem, setCreatingItem] = useState(false);
  const [editingCat, setEditingCat] = useState<Category | null>(null);
  const [creatingCat, setCreatingCat] = useState(false);
  const [activeCat, setActiveCat] = useState<string>('all');

  const categories = useMemo(
    () => [...state.categories].sort((a, b) => a.sort - b.sort),
    [state.categories]
  );
  const items = useMemo(
    () =>
      [...state.items]
        .sort((a, b) => a.sort - b.sort)
        .filter((i) => (activeCat === 'all' ? true : i.categoryId === activeCat)),
    [state.items, activeCat]
  );

  return (
    <div>
      <div className="section" style={{ paddingBottom: 6 }}>
        <div className="row" style={{ gap: 8, marginBottom: 8 }}>
          <button className="icon-btn" onClick={() => setTab('tables')} title="Back to tables">
            ←
          </button>
          <div className="section-title" style={{ margin: 0 }}>Menu items ({state.items.length})</div>
          {/* Rename/delete the selected category — the pencil only appears for a
              real category (never for "All"). */}
          {activeCat !== 'all' && categories.some((c) => c.id === activeCat) && (
            <button
              className="icon-btn"
              title="Rename or delete this category"
              onClick={() => setEditingCat(categories.find((c) => c.id === activeCat) ?? null)}
            >
              <IconEdit width={17} height={17} />
            </button>
          )}
        </div>
        <div className="row" style={{ gap: 6 }}>
          <button className="btn btn-ghost btn-sm" onClick={exportMenu} title="Backup menu to a file">
            ⬇️ Menu
          </button>
          <button className="btn btn-primary btn-sm" onClick={() => setCreatingItem(true)}>
            <IconPlus width={14} height={14} /> New
          </button>
        </div>
      </div>

      <Chips wrap style={{ padding: '0 14px 8px' }}>
        <button className={`chip ${activeCat === 'all' ? 'active' : ''}`} onClick={() => setActiveCat('all')}>
          All
        </button>
        {categories.map((c) => (
          <button key={c.id} className={`chip ${activeCat === c.id ? 'active' : ''}`} onClick={() => setActiveCat(c.id)}>
            {c.name}
          </button>
        ))}
        <button className="chip" style={{ borderStyle: 'dashed' }} onClick={() => setCreatingCat(true)}>
          + Category
        </button>
      </Chips>

      <div style={{ padding: '0 14px' }}>
        {items.length === 0 && <EmptyState icon="🍽" text="No items. Add your first menu item." />}
        {items.map((it) => (
          <div key={it.id} className="list-row" style={{ border: '1px solid var(--border)', borderRadius: 10, marginBottom: 8, boxShadow: 'var(--shadow)' }}>
            {it.photo ? (
              <img src={it.photo} alt={it.name} className="list-thumb" />
            ) : (
              <span className="list-thumb list-thumb-ph">🍽</span>
            )}
            <span className={`veg-dot ${it.veg ? '' : 'nonveg'}`} style={{ marginLeft: 10 }} />
            <div className="grow" style={{ minWidth: 0 }}>
              <div className="list-title">
                {it.name}
                {!it.available && <span className="badge badge-muted" style={{ marginLeft: 6 }}>Unavailable</span>}
                {it.stock !== null && it.stock <= 5 && it.available && (
                  <span className="badge badge-danger" style={{ marginLeft: 6 }}>Low: {it.stock}</span>
                )}
              </div>
              <div className="list-sub">
                {fmt(it.price)} · {it.gstRate}% GST · HSN {it.hsn}
                {it.stock !== null && ` · Stock ${fmtQty(it.stock)}`}
              </div>
            </div>
            <Switch
              on={it.available}
              onChange={() => toggleItemAvailable(it.id)}
              label=""
            />
            <button className="icon-btn" onClick={() => setEditingItem(it)}>
              <IconEdit width={17} height={17} />
            </button>
            <button
              className="icon-btn"
              onClick={() => {
                if (window.confirm(`Delete "${it.name}"? Existing bills keep their copy.`)) {
                  deleteItem(it.id);
                  notify('Item deleted', 'info');
                }
              }}
            >
              <IconTrash width={17} height={17} />
            </button>
          </div>
        ))}
      </div>

      <div style={{ padding: '0 14px 20px' }}>
        <button className="btn btn-ghost btn-block" onClick={() => setCreatingCat(true)}>
          + Add category
        </button>
      </div>

      {/* Category editor */}
      <Modal
        open={creatingCat || !!editingCat}
        onClose={() => { setCreatingCat(false); setEditingCat(null); }}
        title={editingCat ? 'Edit category' : 'New category'}
      >
        <CategoryForm
          initial={editingCat}
          onSave={(c) => { saveCategory(c); notify('Category saved', 'ok'); setCreatingCat(false); setEditingCat(null); }}
          onDelete={() => {
            if (!editingCat) return;
            if (!deleteCategory(editingCat.id)) {
              notify('Move or delete items in this category first', 'err');
              return;
            }
            notify('Category deleted', 'info');
            setEditingCat(null);
          }}
        />
      </Modal>

      {/* Item editor */}
      <Modal
        open={creatingItem || !!editingItem}
        onClose={() => { setCreatingItem(false); setEditingItem(null); }}
        title={editingItem ? 'Edit item' : 'New menu item'}
      >
        <ItemForm
          initial={editingItem}
          categories={categories}
          defaultCatId={activeCat === 'all' ? categories[0]?.id ?? '' : activeCat}
          onSave={(it) => { saveItem(it); notify('Item saved', 'ok'); setCreatingItem(false); setEditingItem(null); }}
        />
      </Modal>
    </div>
  );
}

function CategoryForm({
  initial,
  onSave,
  onDelete,
}: {
  initial: Category | null;
  onSave: (c: Category) => void;
  onDelete?: () => void;
}) {
  const [name, setName] = useState(initial?.name ?? '');
  return (
    <div>
      <div className="field">
        <label>Category name</label>
        <input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Biryani" />
      </div>
      <div className="row" style={{ gap: 8 }}>
        <button
          className="btn btn-primary grow"
          disabled={name.trim().length < 2}
          onClick={() => onSave({ id: initial?.id ?? uid(), name: name.trim(), sort: initial?.sort ?? Date.now() })}
        >
          Save
        </button>
        {initial && onDelete && (
          <button className="btn btn-danger" onClick={onDelete}>
            <IconTrash width={16} height={16} /> Delete
          </button>
        )}
      </div>
    </div>
  );
}

function ItemForm({
  initial,
  categories,
  defaultCatId,
  onSave,
}: {
  initial: MenuItem | null;
  categories: Category[];
  defaultCatId: string;
  onSave: (it: MenuItem) => void;
}) {
  const { notify } = useStore();
  const [name, setName] = useState(initial?.name ?? '');
  const [price, setPrice] = useState(initial ? (initial.price / 100).toFixed(2) : '');
  const [categoryId, setCategoryId] = useState(initial?.categoryId ?? defaultCatId);
  const [gstRate, setGstRate] = useState<number>(initial?.gstRate ?? 5);
  const [veg, setVeg] = useState(initial?.veg ?? true);
  const [hsn, setHsn] = useState(initial?.hsn ?? DEFAULT_HSN);
  const [stock, setStock] = useState(initial?.stock !== null && initial !== null ? String(initial.stock) : '');
  const [photo, setPhoto] = useState(initial?.photo ?? '');
  const [photoBusy, setPhotoBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const [variants, setVariants] = useState<{ id: string; label: string; price: string }[]>(
    initial?.variants?.map((v) => ({ id: v.id, label: v.label, price: (v.price / 100).toFixed(2) })) ?? []
  );

  const pricePaise = rupeesToPaise(price);
  const valid = name.trim().length >= 2 && pricePaise !== null && pricePaise > 0 && categoryId !== '';

  const savedVariants = variants.flatMap((v) => {
    const paise = rupeesToPaise(v.price);
    if (!v.label.trim() || paise === null || paise <= 0) return [];
    return [{ id: v.id, label: v.label.trim(), price: paise }];
  });

  const setVariant = (idx: number, patch: { label?: string; price?: string }) => {
    setVariants((vs) => vs.map((v, i) => (i === idx ? { ...v, ...patch } : v)));
  };
  const removeVariant = (idx: number) => setVariants((vs) => vs.filter((_, i) => i !== idx));
  const addVariant = () => setVariants((vs) => [...vs, { id: uid(), label: '', price: '' }]);

  const pickPhoto = (file: File | undefined) => {
    if (!file) return;
    setPhotoBusy(true);
    fileToPhotoDataUrl(file)
      .then(setPhoto)
      .catch((err: unknown) => {
        notify(err instanceof Error ? err.message : 'Could not process image', 'err');
      })
      .finally(() => setPhotoBusy(false));
  };

  return (
    <div>
      <div className="field">
        <label>Item name</label>
        <input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Chicken Biryani" />
      </div>
      <div className="field">
        <label>Photo (optional, shown on the ordering screen)</label>
        <div className="row" style={{ gap: 10, alignItems: 'center' }}>
          <div className="photo-thumb">
            {photo ? <img src={photo} alt={name || 'item'} /> : <span className="photo-thumb-ph">🍽</span>}
          </div>
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            style={{ display: 'none' }}
            onChange={(e) => { pickPhoto(e.target.files?.[0]); e.target.value = ''; }}
          />
          <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
            <button type="button" className="btn btn-ghost btn-sm" disabled={photoBusy} onClick={() => fileRef.current?.click()}>
              {photoBusy ? 'Processing…' : photo ? '🖼 Change' : '🖼 Add photo'}
            </button>
            {photo && (
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => setPhoto('')}>
                ✕ Remove
              </button>
            )}
          </div>
        </div>
      </div>
      <div className="row" style={{ gap: 8 }}>
        <div className="field grow">
          <label>Price (₹)</label>
          <input className="input" inputMode="decimal" value={price} onChange={(e) => setPrice(e.target.value)} placeholder="220.00" />
        </div>
        <div className="field" style={{ width: 110 }}>
          <label>Category</label>
          <select className="select" value={categoryId} onChange={(e) => setCategoryId(e.target.value)}>
            {categories.map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
        </div>
      </div>
      <div className="field">
        <label>Sizes / portions</label>
        <div className="small muted" style={{ marginBottom: 6 }}>
          Optional. When set, the ordering screen asks the customer to pick a size (each with its own price).
        </div>
        <div className="chips" style={{ padding: 0, marginBottom: 8 }}>
          {(['Quarter 1/4KG', 'Half 1/2KG', 'Full 1KG'] as const).map((label) => {
            const exists = variants.some((v) => v.label.trim().toLowerCase() === label.toLowerCase());
            return (
              <button
                key={label}
                type="button"
                className="chip"
                style={{ padding: '7px 12px', fontSize: 12.5 }}
                title={exists ? `${label} already added` : `Add ${label} portion`}
                onClick={() => {
                  setVariants((vs) => {
                    if (vs.some((v) => v.label.trim().toLowerCase() === label.toLowerCase())) return vs;
                    return [...vs, { id: uid(), label, price: '' }];
                  });
                }}
              >
                {exists ? '✓ ' : '+ '}{label}
              </button>
            );
          })}
        </div>
        {variants.length === 0 && (
          <div className="small muted" style={{ marginBottom: 6 }}>No sizes yet.</div>
        )}
        {variants.map((v, idx) => (
          <div className="row" key={v.id} style={{ gap: 8, marginBottom: 6 }}>
            <input
              className="input grow"
              value={v.label}
              onChange={(e) => setVariant(idx, { label: e.target.value })}
              placeholder="e.g. Full 1KG"
            />
            <input
              className="input"
              style={{ width: 110 }}
              inputMode="decimal"
              value={v.price}
              onChange={(e) => setVariant(idx, { price: e.target.value })}
              placeholder="220.00"
            />
            <button
              type="button"
              className="icon-btn"
              onClick={() => removeVariant(idx)}
              title="Remove size"
            >
              <IconTrash width={16} height={16} />
            </button>
          </div>
        ))}
        <button type="button" className="btn btn-ghost btn-sm" onClick={addVariant}>
          + Add size
        </button>
      </div>
      <div className="row" style={{ gap: 8 }}>
        <div className="field" style={{ width: 110 }}>
          <label>GST slab</label>
          <select className="select" value={gstRate} onChange={(e) => setGstRate(Number(e.target.value))}>
            {GST_RATES.map((r) => (
              <option key={r} value={r}>{r}%</option>
            ))}
          </select>
        </div>
        <div className="field grow">
          <label>HSN code</label>
          <input className="input" value={hsn} onChange={(e) => setHsn(e.target.value)} />
        </div>
      </div>
      <div className="field">
        <label>Stock (leave empty for unlimited)</label>
        <input className="input" type="number" min="0" value={stock} onChange={(e) => setStock(e.target.value)} />
      </div>
      <Switch on={veg} onChange={setVeg} label="Vegetarian" sub="Shown as a green dot on the menu" />
      <div style={{ height: 8 }} />
      <button
        className="btn btn-primary btn-block"
        disabled={!valid}
        onClick={() =>
          onSave({
            id: initial?.id ?? uid(),
            categoryId,
            name: name.trim(),
            price: pricePaise!,
            gstRate,
            hsn: hsn.trim() || DEFAULT_HSN,
            veg,
            available: initial?.available ?? true,
            stock: stock.trim() === '' ? null : Math.max(0, Math.floor(Number(stock) || 0)),
            sort: initial?.sort ?? Date.now(),
            photo,
            variants: savedVariants,
          })
        }
      >
        Save item
      </button>
    </div>
  );
}
