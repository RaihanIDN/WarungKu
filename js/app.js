import { initializeApp } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-app.js";
import { getAuth, signInWithEmailAndPassword, signOut, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-auth.js";
import { getFirestore, collection, getDocs, doc, setDoc, updateDoc, deleteDoc, writeBatch, serverTimestamp, query, orderBy, where } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";

/* ================== Util ================== */
const cfg = window.APP_CONFIG || {};
const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

const rupiah = (n) =>
  new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', maximumFractionDigits: 0 }).format(Number(n) || 0);

const esc = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const METHODS = { cash: 'Tunai', qris: 'QRIS', transfer: 'Transfer' };

const fmtDateTime = (val) => {
  if (!val) return '';
  // Handle Firestore Timestamp
  const d = val.toDate ? val.toDate() : new Date(val);
  return d.toLocaleString('id-ID', { dateStyle: 'medium', timeStyle: 'short' });
};

const todayLocal = () => new Date().toLocaleDateString('en-CA');

const hueFrom = (text) => {
  let h = 0;
  for (const ch of String(text)) h = (h * 31 + ch.charCodeAt(0)) % 360;
  return h;
};

function toast(message, type = 'ok') {
  const el = document.createElement('div');
  el.className = `toast ${type}`;
  el.textContent = message;
  $('#toasts').appendChild(el);
  setTimeout(() => el.remove(), type === 'error' ? 6000 : 3200);
}

/* Fungsi Kompresi Gambar ke Base64 agar bisa disimpan langsung di Firestore NoSQL (Tanpa Firebase Storage) */
function compressImageToBase64(file, maxWidth = 400, quality = 0.75) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.readAsDataURL(file);
    reader.onload = (event) => {
      const img = new Image();
      img.src = event.target.result;
      img.onload = () => {
        const canvas = document.createElement('canvas');
        let width = img.width;
        let height = img.height;

        if (width > maxWidth) {
          height = Math.round((height * maxWidth) / width);
          width = maxWidth;
        }

        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, width, height);

        // Hasilkan string data:image/jpeg;base64 yang sangat ringan (< 40KB)
        resolve(canvas.toDataURL('image/jpeg', quality));
      };
      img.onerror = () => reject(new Error('Gagal membaca file gambar.'));
    };
    reader.onerror = () => reject(new Error('Gagal memproses file gambar.'));
  });
}

/* ================== State & Firebase Init ================== */
let app, auth, db;

const state = {
  user: null,
  products: [],
  cart: new Map(), // productId -> qty
  category: 'Semua',
  query: '',
  method: 'cash',
  editingId: null,
  appShown: false,
};

/* ================== Inisialisasi ================== */
async function init() {
  const storeName = cfg.STORE_NAME || 'Kasir';
  document.title = storeName;
  $('#auth-title').textContent = storeName;
  $('#store-name').textContent = storeName;
  $('#brand-mark').textContent = storeName.trim().charAt(0).toUpperCase() || 'K';

  bindEvents();

  if (!cfg.FIREBASE_CONFIG || Object.keys(cfg.FIREBASE_CONFIG).length === 0) {
    $('#boot').classList.add('hidden');
    $('#auth-screen').classList.remove('hidden');
    $('#config-warning').classList.remove('hidden');
    $('#login-btn').disabled = true;
    return;
  }

  // Initialize Firebase
  app = initializeApp(cfg.FIREBASE_CONFIG);
  auth = getAuth(app);
  db = getFirestore(app);

  onAuthStateChanged(auth, (user) => {
    applySession(user);
  });
}

async function applySession(user) {
  $('#boot').classList.add('hidden');

  if (!user) {
    state.user = null;
    state.appShown = false;
    state.cart.clear();
    $('#app').classList.add('hidden');
    $('#auth-screen').classList.remove('hidden');
    return;
  }

  state.user = user;
  if (state.appShown) return;
  state.appShown = true;

  $('#auth-screen').classList.add('hidden');
  $('#app').classList.remove('hidden');
  $('#hist-from').value = $('#hist-to').value = todayLocal();
  setView('pos');
  renderCart();
  await loadProducts();
}

/* ================== Auth ================== */
async function onLogin(e) {
  e.preventDefault();
  const email = $('#login-email').value.trim();
  const password = $('#login-password').value;
  const errEl = $('#login-error');
  errEl.classList.add('hidden');

  if (!email || !password) {
    errEl.textContent = 'Isi email dan password terlebih dahulu.';
    errEl.classList.remove('hidden');
    return;
  }

  const btn = $('#login-btn');
  btn.disabled = true;
  btn.textContent = 'Memeriksa…';

  try {
    await signInWithEmailAndPassword(auth, email, password);
    $('#login-password').value = '';
  } catch (error) {
    errEl.textContent = /invalid-credential/i.test(error.code)
      ? 'Email atau password salah.'
      : `Gagal masuk: ${error.message}`;
    errEl.classList.remove('hidden');
  } finally {
    btn.disabled = false;
    btn.textContent = 'Masuk';
  }
}

async function onLogout() {
  await signOut(auth);
}

/* ================== Navigasi ================== */
function setView(name) {
  $$('.view').forEach((v) => v.classList.add('hidden'));
  $(`#view-${name}`).classList.remove('hidden');
  $$('.nav-btn[data-view]').forEach((b) => {
    const active = b.dataset.view === name;
    b.classList.toggle('active', active);
    if (active) b.setAttribute('aria-current', 'page');
    else b.removeAttribute('aria-current');
  });
  closeCartSheet();
  if (name === 'products') renderProductTable();
  if (name === 'history') loadHistory();
}

/* ================== Produk ================== */
async function loadProducts() {
  try {
    const q = query(collection(db, "products"), orderBy("name"));
    const snapshot = await getDocs(q);
    state.products = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
    
    for (const [id, qty] of state.cart) {
      const p = state.products.find((x) => x.id === id);
      if (!p || p.stock <= 0) state.cart.delete(id);
      else if (qty > p.stock) state.cart.set(id, p.stock);
    }
    renderCategories();
    renderProducts();
    renderCart();
    if (!$('#view-products').classList.contains('hidden')) renderProductTable();
  } catch (error) {
    toast(`Gagal memuat produk: ${error.message}`, 'error');
  }
}

function categories() {
  return [...new Set(state.products.map((p) => p.category || 'Umum'))].sort((a, b) => a.localeCompare(b, 'id'));
}

function renderCategories() {
  const cats = ['Semua', ...categories()];
  if (!cats.includes(state.category)) state.category = 'Semua';
  $('#chips').innerHTML = cats
    .map((c) => `<button class="chip" role="tab" type="button" data-cat="${esc(c)}" aria-selected="${c === state.category}">${esc(c)}</button>`)
    .join('');
  $('#category-list').innerHTML = categories().map((c) => `<option value="${esc(c)}">`).join('');
}

function renderProducts() {
  const q = state.query.trim().toLowerCase();
  const list = state.products.filter(
    (p) =>
      (state.category === 'Semua' || (p.category || 'Umum') === state.category) &&
      (!q || p.name.toLowerCase().includes(q))
  );

  const grid = $('#product-grid');
  if (!list.length) {
    grid.innerHTML = `<p class="empty" style="grid-column:1/-1">${
      state.products.length ? 'Produk tidak ditemukan.' : 'Belum ada produk.'
    }</p>`;
    return;
  }

  grid.innerHTML = list
    .map((p) => {
      const hue = hueFrom(p.category || p.name);
      const low = p.stock > 0 && p.stock <= 5;
      const mediaHTML = p.image_url
        ? `<img src="${esc(p.image_url)}" alt="${esc(p.name)}" class="product-img">`
        : `<span class="mono" style="background:linear-gradient(135deg,hsl(${hue} 75% 55%),hsl(${(hue + 40) % 360} 75% 45%))">${esc(p.name.charAt(0).toUpperCase())}</span>`;

      return `
      <button class="card product-card-item" type="button" data-id="${p.id}" ${p.stock <= 0 ? 'disabled' : ''}>
        ${mediaHTML}
        <div class="product-info-wrap">
          <span class="name">${esc(p.name)}</span>
          <span class="price">${rupiah(p.price)}</span>
          <span class="stock ${low || p.stock <= 0 ? 'low' : ''}">${p.stock <= 0 ? 'Stok habis' : `Stok ${p.stock}`}</span>
        </div>
      </button>`;
    })
    .join('');
}

function renderProductTable() {
  const body = $('#product-rows');
  $('#product-empty').classList.toggle('hidden', state.products.length > 0);
  body.innerHTML = state.products
    .map(
      (p) => `
    <tr>
      <td>
        <div style="display: flex; align-items: center; gap: 10px;">
          ${p.image_url ? `<img src="${esc(p.image_url)}" style="width: 36px; height: 36px; object-fit: cover; border-radius: 4px;">` : ''}
          <span>${esc(p.name)}</span>
        </div>
      </td>
      <td>${esc(p.category)}</td>
      <td class="num">${rupiah(p.price)}</td>
      <td class="num"><span class="badge ${p.stock <= 5 ? 'low' : ''}">${p.stock}</span></td>
      <td class="num">
        <button class="btn" type="button" data-act="edit" data-id="${p.id}">Ubah</button>
        <button class="btn danger" type="button" data-act="delete" data-id="${p.id}">Hapus</button>
      </td>
    </tr>`
    )
    .join('');
}

function openProductDialog(id = null) {
  state.editingId = id;
  const p = id ? state.products.find((x) => x.id === id) : null;
  
  $('#product-dialog-title').textContent = p ? 'Ubah produk' : 'Tambah produk';
  $('#p-name').value = p ? p.name : '';
  $('#p-category').value = p ? p.category : '';
  $('#p-price').value = p ? p.price : '';
  $('#p-stock').value = p ? p.stock : '';
  
  const imageInput = $('#p-image');
  if (imageInput) imageInput.value = '';
  
  const imagePreview = $('#p-image-preview');
  if (imagePreview) {
    if (p && p.image_url) {
      imagePreview.src = p.image_url;
      imagePreview.classList.remove('hidden');
    } else {
      imagePreview.src = '';
      imagePreview.classList.add('hidden');
    }
  }

  $('#product-error').classList.add('hidden');
  $('#product-dialog').showModal();
  $('#p-name').focus();
}

async function saveProduct(e) {
  e.preventDefault();
  const errEl = $('#product-error');
  errEl.classList.add('hidden');

  const name = $('#p-name').value.trim();
  const category = $('#p-category').value.trim() || 'Umum';
  const price = Number($('#p-price').value);
  const stock = Number($('#p-stock').value);
  const imageFile = $('#p-image')?.files[0];

  let problem = '';
  if (!name) problem = 'Nama produk wajib diisi.';
  else if (!Number.isFinite(price) || price < 0 || $('#p-price').value === '') problem = 'Harga harus berupa angka 0 atau lebih.';
  else if (!Number.isInteger(stock) || stock < 0) problem = 'Stok harus berupa bilangan bulat 0 atau lebih.';
  
  if (problem) {
    errEl.textContent = problem;
    errEl.classList.remove('hidden');
    return;
  }

  const btn = $('#product-save');
  btn.disabled = true;
  btn.textContent = 'Menyimpan...';

  try {
    let imageUrl = state.editingId ? (state.products.find((x) => x.id === state.editingId)?.image_url || '') : '';

    // Konversi file gambar ke Base64 ringan dan simpan langsung ke dokumen Firestore
    if (imageFile) {
      imageUrl = await compressImageToBase64(imageFile);
    }

    const payload = { name, category, price, stock, image_url: imageUrl };

    if (state.editingId) {
      await updateDoc(doc(db, "products", state.editingId), payload);
    } else {
      const newRef = doc(collection(db, "products"));
      await setDoc(newRef, { ...payload, id: newRef.id });
    }

    $('#product-dialog').close();
    toast(state.editingId ? 'Produk diperbarui.' : 'Produk ditambahkan.');
    await loadProducts();
  } catch (err) {
    errEl.textContent = `Gagal menyimpan: ${err.message}`;
    errEl.classList.remove('hidden');
  } finally {
    btn.disabled = false;
    btn.textContent = 'Simpan produk';
  }
}

async function deleteProduct(id) {
  const p = state.products.find((x) => x.id === id);
  if (!p || !confirm(`Hapus produk “${p.name}”?`)) return;
  try {
    await deleteDoc(doc(db, "products", id));
    state.cart.delete(id);
    toast('Produk dihapus.');
    await loadProducts();
  } catch (error) {
    toast(`Gagal menghapus: ${error.message}`, 'error');
  }
}

/* ================== Keranjang ================== */
function addToCart(id) {
  const p = state.products.find((x) => x.id === id);
  if (!p || p.stock <= 0) return;
  const qty = state.cart.get(id) || 0;
  if (qty >= p.stock) return toast(`Stok “${p.name}” hanya ${p.stock}.`, 'warn');
  state.cart.set(id, qty + 1);
  renderCart();
}

function changeQty(id, delta) {
  const p = state.products.find((x) => x.id === id);
  const next = (state.cart.get(id) || 0) + delta;
  if (next <= 0) state.cart.delete(id);
  else if (p && next > p.stock) return toast(`Stok “${p.name}” hanya ${p.stock}.`, 'warn');
  else state.cart.set(id, next);
  renderCart();
}

function cartLines() {
  return [...state.cart]
    .map(([id, qty]) => {
      const p = state.products.find((x) => x.id === id);
      return p ? { id, name: p.name, price: Number(p.price), qty } : null;
    })
    .filter(Boolean);
}

function totals() {
  const lines = cartLines();
  const subtotal = lines.reduce((s, l) => s + l.price * l.qty, 0);
  const rawDiscount = Math.max(0, Math.floor(Number($('#discount').value) || 0));
  const discount = Math.min(rawDiscount, subtotal);
  const total = subtotal - discount;
  const count = lines.reduce((s, l) => s + l.qty, 0);
  return { lines, subtotal, discount, total, count };
}

function renderCart() {
  const { lines } = totals();
  const ul = $('#cart-items');
  if (!lines.length) {
    ul.innerHTML = '<li class="empty">Belum ada pesanan. Pilih produk di sebelah kiri.</li>';
  } else {
    ul.innerHTML = lines
      .map(
        (l) => `
      <li class="line">
        <div>
          <div class="ln-name">${esc(l.name)}</div>
          <div class="ln-unit">${rupiah(l.price)}</div>
        </div>
        <div class="ln-sub">${rupiah(l.price * l.qty)}</div>
        <div></div>
        <div class="qty">
          <button type="button" data-act="dec" data-id="${l.id}">−</button>
          <span aria-live="polite">${l.qty}</span>
          <button type="button" data-act="inc" data-id="${l.id}">+</button>
        </div>
      </li>`
      )
      .join('');
  }
  renderTotals();
}

function renderTotals() {
  const { subtotal, total, count } = totals();
  const isCash = state.method === 'cash';

  if (!isCash) $('#paid').value = total || '';
  $('#paid').disabled = !isCash;

  const paid = Math.floor(Number($('#paid').value) || 0);
  const change = Math.max(0, paid - total);

  $('#sum-subtotal').textContent = rupiah(subtotal);
  $('#sum-total').textContent = rupiah(total);
  $('#sum-change').textContent = rupiah(change);
  $('#btn-pay').disabled = count === 0 || paid < total;
  $('#fab-label').textContent = count ? `Lihat pesanan · ${count} item · ${rupiah(total)}` : 'Lihat pesanan';

  const quick = $('#quick-pay');
  if (!isCash || total <= 0) {
    quick.innerHTML = '';
  } else {
    const options = new Set([total]);
    for (const step of [5000, 10000, 20000, 50000, 100000]) {
      const v = Math.ceil(total / step) * step;
      if (v > total) options.add(v);
      if (options.size >= 4) break;
    }
    quick.innerHTML = [...options]
      .map((v) => `<button type="button" data-amount="${v}">${v === total ? 'Uang pas' : rupiah(v)}</button>`)
      .join('');
  }
}

function resetPayment() {
  state.cart.clear();
  $('#discount').value = '';
  $('#paid').value = '';
  renderCart();
}

async function checkout() {
  const { lines, subtotal, total, discount } = totals();
  const paid = Math.floor(Number($('#paid').value) || 0);
  if (!lines.length || paid < total) return;

  const btn = $('#btn-pay');
  btn.disabled = true;
  btn.textContent = 'Memproses…';

  try {
    const batch = writeBatch(db);
    
    // 1. Buat Dokumen Transaksi
    const txRef = doc(collection(db, "transactions"));
    const invoiceNo = `TRX-${Date.now()}`;
    const trxData = {
      id: txRef.id,
      invoice_no: invoiceNo,
      created_at: serverTimestamp(),
      subtotal: subtotal,
      discount: discount,
      total: total,
      paid: paid,
      change: (paid - total),
      payment_method: state.method,
      cashier_email: state.user?.email,
      items: lines.map(l => ({ name: l.name, price: l.price, qty: l.qty, subtotal: l.price * l.qty }))
    };
    batch.set(txRef, trxData);

    // 2. Update Stok Barang
    for (const line of lines) {
      const pRef = doc(db, "products", line.id);
      const currentProduct = state.products.find(x => x.id === line.id);
      const newStock = Math.max(0, currentProduct.stock - line.qty);
      batch.update(pRef, { stock: newStock });
    }

    // 3. Commit transaksi ke database
    await batch.commit();

    // Data lokal untuk ditampilkan di struk karena serverTimestamp butuh waktu
    const displayTrx = { ...trxData, created_at: new Date() };

    resetPayment();
    closeCartSheet();
    toast(`Transaksi ${invoiceNo} berhasil disimpan.`);
    showReceipt(displayTrx);
    await loadProducts();

  } catch (error) {
    toast(`Gagal memproses transaksi: ${error.message}`, 'error');
  } finally {
    btn.textContent = 'Bayar';
  }
}

/* ================== Struk ================== */
function receiptHTML(t) {
  const items = (t.items || [])
    .map(
      (i) => `
    <div class="it">
      <div>${esc(i.name)}</div>
      <div class="rw"><span>${i.qty} × ${rupiah(i.price)}</span><span>${rupiah(i.subtotal ?? i.price * i.qty)}</span></div>
    </div>`
    )
    .join('');

  return `
  <div class="receipt">
    <div class="c store">${esc(cfg.STORE_NAME || 'Kasir')}</div>
    ${cfg.STORE_ADDRESS ? `<div class="c">${esc(cfg.STORE_ADDRESS)}</div>` : ''}
    <hr>
    <div>${esc(t.invoice_no)}</div>
    <div>${esc(fmtDateTime(t.created_at))}</div>
    ${t.cashier_email ? `<div>Kasir: ${esc(t.cashier_email)}</div>` : ''}
    <hr>
    ${items}
    <hr>
    <div class="rw"><span>Subtotal</span><span>${rupiah(t.subtotal)}</span></div>
    ${Number(t.discount) > 0 ? `<div class="rw"><span>Diskon</span><span>-${rupiah(t.discount)}</span></div>` : ''}
    <div class="rw b"><span>Total</span><span>${rupiah(t.total)}</span></div>
    <div class="rw"><span>Bayar (${esc(METHODS[t.payment_method] || t.payment_method)})</span><span>${rupiah(t.paid)}</span></div>
    <div class="rw"><span>Kembalian</span><span>${rupiah(t.change)}</span></div>
    <hr>
    <div class="c">Terima kasih sudah berbelanja</div>
  </div>`;
}

function showReceipt(t) {
  const html = receiptHTML(t);
  $('#receipt-view').innerHTML = html;
  $('#print-area').innerHTML = html;
  $('#receipt-dialog').showModal();
}

/* ================== Riwayat ================== */
async function loadHistory() {
  const from = $('#hist-from').value || todayLocal();
  const to = $('#hist-to').value || from;
  const start = new Date(`${from}T00:00:00`);
  const end = new Date(`${to}T00:00:00`);
  end.setDate(end.getDate() + 1);

  if (end <= start) return toast('Tanggal akhir tidak boleh sebelum tanggal awal.', 'warn');

  try {
    const q = query(
      collection(db, "transactions"),
      where("created_at", ">=", start),
      where("created_at", "<", end),
      orderBy("created_at", "desc")
    );
    
    const snapshot = await getDocs(q);
    const rows = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
    state.history = rows;

    const revenue = rows.reduce((s, t) => s + Number(t.total), 0);
    const items = rows.reduce((s, t) => s + (t.items || []).reduce((a, i) => a + i.qty, 0), 0);
    
    $('#stat-revenue').textContent = rupiah(revenue);
    $('#stat-count').textContent = rows.length;
    $('#stat-items').textContent = items;

    $('#history-empty').classList.toggle('hidden', rows.length > 0);
    $('#history-rows').innerHTML = rows
      .map(
        (t) => `
      <tr>
        <td>${esc(fmtDateTime(t.created_at))}</td>
        <td>${esc(t.invoice_no)}</td>
        <td>${esc(METHODS[t.payment_method] || t.payment_method)}</td>
        <td class="num">${rupiah(t.total)}</td>
        <td class="num"><button class="btn" type="button" data-id="${t.id}">Lihat struk</button></td>
      </tr>`
      )
      .join('');
  } catch (error) {
    toast(`Gagal memuat riwayat: ${error.message}`, 'error');
  }
}

function openHistoryReceipt(id) {
  const t = (state.history || []).find((x) => x.id === id);
  if (!t) return;
  showReceipt(t);
}

/* ================== Keranjang di layar kecil ================== */
function openCartSheet() {
  $('#cart-panel').classList.add('open');
  document.body.classList.add('cart-open');
  $('#cart-fab').setAttribute('aria-expanded', 'true');
}
function closeCartSheet() {
  $('#cart-panel').classList.remove('open');
  document.body.classList.remove('cart-open');
  $('#cart-fab').setAttribute('aria-expanded', 'false');
}

/* ================== Event ================== */
function bindEvents() {
  $('#login-form').addEventListener('submit', onLogin);
  $('#btn-logout').addEventListener('click', onLogout);
  $$('.nav-btn[data-view]').forEach((b) => b.addEventListener('click', () => setView(b.dataset.view)));

  $('#search').addEventListener('input', (e) => {
    state.query = e.target.value;
    renderProducts();
  });

  $('#chips').addEventListener('click', (e) => {
    const chip = e.target.closest('[data-cat]');
    if (!chip) return;
    state.category = chip.dataset.cat;
    renderCategories();
    renderProducts();
  });

  $('#product-grid').addEventListener('click', (e) => {
    const card = e.target.closest('.card');
    if (card) addToCart(card.dataset.id);
  });

  $('#cart-items').addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-act]');
    if (!btn) return;
    changeQty(btn.dataset.id, btn.dataset.act === 'inc' ? 1 : -1);
  });

  $('#cart-clear').addEventListener('click', () => {
    if (!state.cart.size) return;
    state.cart.clear();
    renderCart();
  });

  $('#discount').addEventListener('input', renderTotals);
  $('#paid').addEventListener('input', renderTotals);

  $('.seg').addEventListener('click', (e) => {
    const btn = e.target.closest('[data-method]');
    if (!btn) return;
    state.method = btn.dataset.method;
    $$('.seg button').forEach((b) => b.setAttribute('aria-pressed', String(b === btn)));
    if (state.method === 'cash') $('#paid').value = '';
    renderTotals();
  });

  $('#quick-pay').addEventListener('click', (e) => {
    const btn = e.target.closest('[data-amount]');
    if (!btn) return;
    $('#paid').value = btn.dataset.amount;
    renderTotals();
  });

  $('#btn-pay').addEventListener('click', checkout);
  $('#cart-fab').addEventListener('click', openCartSheet);

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closeCartSheet();
  });

  $('#btn-add-product').addEventListener('click', () => openProductDialog());
  $('#product-cancel').addEventListener('click', () => $('#product-dialog').close());
  $('#product-form').addEventListener('submit', saveProduct);

  // Tampilkan preview otomatis saat user memilih file gambar
  const imgInput = $('#p-image');
  if (imgInput) {
    imgInput.addEventListener('change', async (e) => {
      const file = e.target.files[0];
      const preview = $('#p-image-preview');
      if (file && preview) {
        preview.src = await compressImageToBase64(file);
        preview.classList.remove('hidden');
      }
    });
  }

  $('#product-rows').addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-act]');
    if (!btn) return;
    if (btn.dataset.act === 'edit') openProductDialog(btn.dataset.id);
    else deleteProduct(btn.dataset.id);
  });

  $('#hist-load').addEventListener('click', loadHistory);
  $('#history-rows').addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-id]');
    if (btn) openHistoryReceipt(btn.dataset.id);
  });

  $('#receipt-close').addEventListener('click', () => $('#receipt-dialog').close());
  $('#receipt-print').addEventListener('click', () => window.print());
}

init();
