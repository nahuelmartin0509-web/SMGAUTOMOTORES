/* SMG Automotores · Catálogo público en vivo.
   Lee la colección pública `catalogo` de Firestore (espejo de `vehiculos` sin datos internos) con onSnapshot.
   Si Firebase no responde o la colección está vacía, queda el catálogo estático del HTML como respaldo. */
(function () {
  'use strict';
  const cfg = window.SMG_FIREBASE_CONFIG, wrap = document.getElementById('cars');
  if (!cfg || !wrap) return;
  const BASE = 'https://www.gstatic.com/firebasejs/10.14.1/';
  const CAT = { sedan: 'Sedán', hatchback: 'Hatchback', suv: 'SUV', pickup: 'Pick-up / 4x4', utilitario: 'Utilitario' };
  const nf = new Intl.NumberFormat('es-AR');
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const ICO_CAL = '<svg viewBox="0 0 24 24"><rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/></svg>';
  const ICO_KM = '<svg viewBox="0 0 24 24"><path d="M4 18a8 8 0 1116 0"/><path d="M12 18l4-6"/></svg>';
  const ICO_GNC = '<svg viewBox="0 0 24 24"><path d="M12 3c3 4 6 6.5 6 11a6 6 0 01-12 0c0-2 1-3.5 2-5 .5 1.5 1.5 2 2 2 0-3 0-5 2-8z"/></svg>';
  const ICO_OK = '<svg viewBox="0 0 24 24"><path d="M5 13l4 4L19 7"/></svg>';

  function card(c) {
    const reservado = c.estado === 'senado';
    const titulo = esc(c.titulo || '');
    const tag = reservado ? '<span class="tag tag--res">Reservado / Señado</span>'
      : (c.etiqueta ? `<span class="tag">${esc(c.etiqueta)}</span>` : '');
    const km = Number(c.km) > 0 ? nf.format(c.km) + ' km' : '0 km';
    const extra = c.extra ? `<li>${/gnc/i.test(c.extra) ? ICO_GNC : ICO_OK}${esc(c.extra)}</li>` : '';
    const msg = encodeURIComponent('Hola SMG Automotores, quiero consultar por el ' + (c.titulo || ''));
    const imgs = (Array.isArray(c.imagenes) && c.imagenes.length ? c.imagenes : [c.foto || 'LOGO.png']).slice(0, 8);
    const multi = imgs.length > 1;
    const slides = imgs.map((s, i) => `<img src="${esc(s)}" alt="${titulo}${multi ? ' - foto ' + (i + 1) : ''}" ${i ? 'loading="lazy"' : ''} draggable="false">`).join('');
    const nav = multi
      ? `<button type="button" class="car__nav car__nav--prev" aria-label="Foto anterior">&#10094;</button><button type="button" class="car__nav car__nav--next" aria-label="Foto siguiente">&#10095;</button>
          <div class="car__dots">${imgs.map((_, i) => `<i${i ? '' : ' class="on"'}></i>`).join('')}</div>` : '';
    return `<article class="car reveal${reservado ? ' car--res' : ''}" data-cat="${esc(c.categoria || 'sedan')}">
        <div class="car__img${multi ? ' has-gallery' : ''}">
          ${multi ? `<div class="car__track">${slides}</div>` : slides}
          ${nav}
          ${tag}
          <span class="year">${esc(c.anio)}</span>
        </div>
        <div class="car__body">
          <small class="car__type">${esc(c.marca)} · ${CAT[c.categoria] || 'Sedán'}</small>
          <h3>${titulo}</h3>
          <ul class="chips"><li>${ICO_CAL}${esc(c.anio)}</li><li>${ICO_KM}${km}</li>${extra}</ul>
          <a class="btn btn--red btn--block btn--wa" target="_blank" rel="noopener" href="https://wa.me/5493815847982?text=${msg}">Consultar</a>
        </div>
      </article>`;
  }

  /* ---------- Carrusel de fotos (delegado: funciona aunque las tarjetas se re-rendericen) ---------- */
  function go(box, to) {
    const n = box.querySelectorAll('.car__track img').length; if (n < 2) return;
    const i = (to + n) % n; box.dataset.i = i;
    box.querySelector('.car__track').style.transform = 'translateX(-' + (i * 100) + '%)';
    box.querySelectorAll('.car__dots i').forEach((d, k) => d.classList.toggle('on', k === i));
  }
  wrap.addEventListener('click', e => {
    const b = e.target.closest('.car__nav'); if (!b) return;
    e.preventDefault(); e.stopPropagation();
    const box = b.closest('.car__img');
    go(box, (+box.dataset.i || 0) + (b.classList.contains('car__nav--next') ? 1 : -1));
  });
  let tx = 0, ty = 0, tb = null, moved = false;
  wrap.addEventListener('touchstart', e => {
    tb = e.target.closest('.has-gallery'); if (!tb) return;
    tx = e.touches[0].clientX; ty = e.touches[0].clientY; moved = false;
  }, { passive: true });
  wrap.addEventListener('touchmove', e => {
    if (!tb) return;
    if (Math.abs(e.touches[0].clientX - tx) > 10) moved = true;
  }, { passive: true });
  wrap.addEventListener('touchend', e => {
    if (!tb) return;
    const t = e.changedTouches[0], dx = t.clientX - tx, dy = t.clientY - ty;
    if (Math.abs(dx) > 40 && Math.abs(dx) > Math.abs(dy) * 1.2) {
      e.stopPropagation();
      go(tb, (+tb.dataset.i || 0) + (dx < 0 ? 1 : -1));
    }
    tb = null;
  });
  // un deslizamiento no debe disparar un clic en la tarjeta
  wrap.addEventListener('click', e => { if (moved && e.target.closest('.has-gallery')) { e.stopPropagation(); e.preventDefault(); } moved = false; }, true);

  (async function () {
    try {
      const [{ initializeApp }, { getFirestore, collection, onSnapshot }] =
        await Promise.all([import(BASE + 'firebase-app.js'), import(BASE + 'firebase-firestore.js')]);
      const db = getFirestore(initializeApp(cfg));
      onSnapshot(collection(db, 'catalogo'), snap => {
        if (snap.empty) return; // sin datos todavía: se mantiene el catálogo estático
        const list = snap.docs.map(d => d.data()).sort((a, b) => (a.orden || 0) - (b.orden || 0));
        wrap.innerHTML = list.map(card).join('');
        if (window.SMGCatalog) window.SMGCatalog.refresh();
      }, err => console.warn('Catálogo en vivo no disponible, se usa el catálogo estático.', err));
    } catch (e) { console.warn('Firebase no pudo cargarse; se usa el catálogo estático.', e); }
  })();
})();
