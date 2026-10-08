(() => {
  'use strict';

  /* ================== Util ================== */
  const cfg = window.APP_CONFIG || {};
  const $ = (sel, root = document) => root.querySelector(sel);   const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

  const rupiah = (n) =>
    new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', maximumFractionDigits: 0 }).format(Number(n) || 0);

  const esc = (s) =>
    String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  const METHODS = { cash: 'Tunai', qris: 'QRIS', transfer: 'Transfer' };

  const fmtDateTime = (iso) =>
    new Date(iso).toLocaleString('id-ID', { dateStyle: 'medium', timeStyle: 'short' });

  const todayLocal = () => new Date().toLocaleDateString('en-CA'); // yyyy-mm-dd (zona waktu perangkat)

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

  /* ================== State ================== */
  let sb = null;
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

    const configured =
      cfg.SUPABASE_URL && cfg.SUPABASE_ANON_KEY &&
      !cfg.SUPABASE_URL.includes('GANTI') && !cfg.SUPABASE_ANON_KEY.includes('GANTI');

    if (!configured || !window.supabase) {
      $('#boot').classList.add('hidden');
      $('#auth-screen').classList.remove('hidden');
      $('#config-warning').classList.remove('hidden');
      $('#login-btn').disabled = true;
      return;
    }

    sb = window.supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY);

    const { data } = await sb.auth.getSession();
    await applySession(data.session);

    sb.auth.onAuthStateChange((event, session) => {
      if (event === 'SIGNED_IN' || event === 'SIGNED_OUT') applySession(session);
    });
  }

  async function applySession(session) {
    $('#boot').classList.add('hidden');

    if (!session) {
      state.user = null;
      state.appShown = false;
      state.cart.clear();
      $('#app').classList.add('hidden');
      $('#auth-screen').classList.remove('hidden');
      return;
    }

    state.user = session.user;
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
    const { error } = await sb.auth.signInWithPassword({ email, password });
    btn.disabled = false;
    btn.textContent = 'Masuk';

    if (error) {
      errEl.textContent = /invalid login/i.test(error.message)
        ? 'Email atau password salah.'
        : `Gagal masuk: ${error.message}`;
      errEl.classList.remove('hidden');
    } else {
      $('#login-password').value = '';     }   }    async function onLogout() {     await sb.auth.signOut();   }    /* ================== Navigasi ================== */   function setView(name) {     $$('.view').forEach((v) => v.classList.add('hidden'));$(`#view-${name}`).classList.remove('hidden');
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
    const { data, error } = await sb.from('products').select('*').order('name');
    if (error) {
      toast(`Gagal memuat produk: ${error.message}`, 'error');
      return;
    }
    state.products = data || [];
    for (const [id, qty] of state.cart) {
      const p = state.products.find((x) => x.id === id);
      if (!p || p.stock <= 0) state.cart.delete(id);
      else if (qty > p.stock) state.cart.set(id, p.stock);
    }
    renderCategories();
    renderProducts();
    renderCart();
    if (!$('#view-products').classList.contains('hidden')) renderProductTable();
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
        state.products.length ? 'Produk tidak ditemukan. Coba kata kunci atau kategori lain.' : 'Belum ada produk. Tambahkan lewat menu Produk.'
      }</p>`;
      return;
    }

    grid.innerHTML = list
      .map((p) => {
        const hue = hueFrom(p.category || p.name);
        const low = p.stock > 0 && p.stock <= 5;
        
        // Render gambar jika ada URL-nya, jika tidak pakai inisial huruf (fallback)
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

      // Jika ada file gambar baru yang di-upload
      if (imageFile) {
        const fileExt = imageFile.name.split('.').pop();
        const fileName = `${Date.now()}-${Math.random().toString(36).substring(2, 7)}.${fileExt}`;
        const filePath = `products/${fileName}`;

        const { error: uploadError } = await sb.storage
          .from('product-images')
          .upload(filePath, imageFile);

        if (uploadError) throw uploadError;

        const { data: publicUrlData } = sb.storage
          .from('product-images')
          .getPublicUrl(filePath);

        imageUrl = publicUrlData.publicUrl;
      }

      const payload = { name, category, price, stock, image_url: imageUrl };

      const { error } = state.editingId
        ? await sb.from('products').update(payload).eq('id', state.editingId)
        : await sb.from('products').insert(payload);

      if (error) throw error;

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
    if (!p || !confirm(`Hapus produk “${p.name}”? Riwayat transaksi lama tetap tersimpan.`)) return;
    const { error } = await sb.from('products').delete().eq('id', id);
    if (error) return toast(`Gagal menghapus: ${error.message}`, 'error');
    state.cart.delete(id);
    toast('Produk dihapus.');
    await loadProducts();
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
      ul.innerHTML = '<li class="empty">Belum ada pesanan. Pilih produk di sebelah kiri untuk menambahkannya.</li>';
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
            <button type="button" data-act="dec" data-id="${l.id}" aria-label="Kurangi ${esc(l.name)}">−</button>
            <span aria-live="polite">${l.qty}</span>
            <button type="button" data-act="inc" data-id="${l.id}" aria-label="Tambah ${esc(l.name)}">+</button>
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
    const { lines, total, discount } = totals();
    const paid = Math.floor(Number($('#paid').value) || 0);
    if (!lines.length || paid < total) return;

    const btn = $('#btn-pay');
    btn.disabled = true;
    btn.textContent = 'Memproses…';

    const { data, error } = await sb.rpc('create_transaction', {
      p_items: lines.map((l) => ({ id: l.id, qty: l.qty })),
      p_discount: discount,
      p_paid: paid,
      p_method: state.method,
    });

    btn.textContent = 'Bayar';

    if (error) {
      toast(error.message, 'error');
      await loadProducts();
      renderTotals();
      return;
    }

    const trx = {
      ...data,
      cashier_email: state.user?.email,
      items: lines.map((l) => ({ name: l.name, price: l.price, qty: l.qty, subtotal: l.price * l.qty })),
    };
    resetPayment();
    closeCartSheet();
    toast(`Transaksi ${data.invoice_no} berhasil disimpan.`);
    showReceipt(trx);
    await loadProducts();
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

    const { data, error } = await sb
      .from('transactions')
      .select('*, transaction_items(*)')
      .gte('created_at', start.toISOString())
      .lt('created_at', end.toISOString())
      .order('created_at', { ascending: false })
      .limit(500);

    if (error) return toast(`Gagal memuat riwayat: ${error.message}`, 'error');

    const rows = data || [];
    state.history = rows;

    const revenue = rows.reduce((s, t) => s + Number(t.total), 0);
    const items = rows.reduce((s, t) => s + (t.transaction_items || []).reduce((a, i) => a + i.qty, 0), 0);
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
  }

  function openHistoryReceipt(id) {
    const t = (state.history || []).find((x) => x.id === id);
    if (!t) return;
    showReceipt({
      ...t,
      change: t.change,
      items: (t.transaction_items || []).map((i) => ({
        name: i.product_name,
        price: i.price,
        qty: i.qty,
        subtotal: i.subtotal,
      })),
    });
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
    $('#btn-logout').addEventListener('click', onLogout);      $$('.nav-btn[data-view]').forEach((b) => b.addEventListener('click', () => setView(b.dataset.view)));

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

    $('.seg').addEventListener('click', (e) => {       const btn = e.target.closest('[data-method]');       if (!btn) return;       state.method = btn.dataset.method;       $$('.seg button').forEach((b) => b.setAttribute('aria-pressed', String(b === btn)));
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
})();
