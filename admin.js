/* SMG Automotores · Panel Staff (UI). Los datos se leen/escriben SOLO vía window.SMGData (admin-data.js). */
(function () {
  'use strict';
  const { Auth, Db, isoDate, addDays } = window.SMGData;
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const clone = o => JSON.parse(JSON.stringify(o));

  /* ---------- catálogos ---------- */
  const ESTADOS = { disponible: 'Disponible', senado: 'Señado / Reservado', taller: 'En Taller', vendido: 'Vendido / Entregado' };
  const ORIGEN = { propio: 'Propio / Agencia', consignacion: 'Consignación' };
  const RES_ESTADOS = { esperando_credito: 'Esperando crédito', esperando_transferencia: 'Esperando transferencia', listo_entrega: 'Listo para entregar' };
  const DOCS = [
    ['titulo', 'Título'], ['cedula', 'Cédula'], ['f08', 'Formulario 08 firmado / certificado'],
    ['f12', 'Verificación Policial F12'], ['informe', 'Informe de dominio'], ['libreDeudaPrenda', 'Libre deuda de prenda']
  ];
  const PAGAN = { agencia: 'Agencia', cliente: 'Cliente', titular: 'Titular (consignante)' };
  const CATEGORIAS = { sedan: 'Sedán', hatchback: 'Hatchback', suv: 'SUV', pickup: 'Pick-up / 4x4', utilitario: 'Utilitarios' };
  const VIEW_TITLES = { inventory: 'Inventario y Ficha 360°', ops: 'Operaciones, Señas y Permutas', debts: 'Deudas y Cuentas Corrientes', data: 'Datos / Firebase' };

  const S = { user: null, vehicles: [], reservations: [], receivables: [], settings: { tc: 1400 }, view: 'inventory', debtTab: 'cobrar', drawer: null, modalSubmit: null };
  const isAdmin = () => !!S.user && S.user.role === 'admin';

  /* ---------- formato ---------- */
  const nf = new Intl.NumberFormat('es-AR');
  const num = v => { const n = parseFloat(v); return isNaN(n) ? 0 : n; };
  const ars = n => '$ ' + nf.format(Math.round(n || 0));
  const usd = n => 'US$ ' + nf.format(Math.round(n || 0));
  const cash = (n, mon) => (mon === 'USD' ? usd(n) : ars(n));
  const tc = () => S.settings.tc || 1;
  const toUSD = (a, u) => num(u) + num(a) / tc();
  const fmtDate = iso => { if (!iso) return '—'; const [y, m, d] = iso.split('-'); return `${d}/${m}/${y}`; };
  const today0 = () => { const d = new Date(); d.setHours(0, 0, 0, 0); return d; };
  const daysTo = iso => Math.round((new Date(iso + 'T00:00:00') - today0()) / 864e5);
  const addMonth = iso => { const d = new Date((iso || isoDate(new Date())) + 'T00:00:00'); d.setMonth(d.getMonth() + 1); return isoDate(d); };
  const moneyPair = (a, u) => {
    const hasU = num(u) > 0, hasA = num(a) > 0;
    if (hasU && hasA) return `${usd(u)}<span class="t2">${ars(a)}</span>`;
    if (hasU) return usd(u);
    if (hasA) return ars(a);
    return '—';
  };
  const dueBadge = (iso, active = true) => {
    if (!iso) return '<span class="b">Sin fecha</span>';
    if (!active) return fmtDate(iso);
    const d = daysTo(iso);
    if (d < 0) return `<span class="b b--red">Vencida hace ${-d} d</span><span class="t2">${fmtDate(iso)}</span>`;
    if (d === 0) return `<span class="b b--amber">Vence hoy</span><span class="t2">${fmtDate(iso)}</span>`;
    if (d <= 7) return `<span class="b b--amber">Vence en ${d} d</span><span class="t2">${fmtDate(iso)}</span>`;
    return `<span class="b b--ok">En ${d} d</span><span class="t2">${fmtDate(iso)}</span>`;
  };
  const label = v => [v.marca, v.modelo, v.version].filter(Boolean).join(' ');
  const vById = id => S.vehicles.find(v => v.id === id);
  const docsDone = v => DOCS.filter(([k]) => v.docs && v.docs[k]).length;
  const docsMissing = v => DOCS.filter(([k]) => !(v.docs && v.docs[k])).map(([, l]) => l);
  const debtOf = v => num(v.deudaPatentes && v.deudaPatentes.monto) + num(v.deudaMultas && v.deudaMultas.monto);
  const saldo = c => {
    const cuota = num(c.montoCuota) || (c.cuotasTotal ? num(c.total) / c.cuotasTotal : 0);
    return Math.max(0, num(c.total) - num(c.cuotasPagadas) * cuota);
  };

  function toast(msg, ok) {
    const t = $('#toast'); t.textContent = msg; t.classList.toggle('ok', !!ok); t.classList.add('show');
    clearTimeout(toast.t); toast.t = setTimeout(() => t.classList.remove('show'), 2600);
  }

  /* ---------- helpers de formulario ---------- */
  const fld = (lab, name, val, type = 'text', extra = '') =>
    `<label class="f"><span>${lab}</span><input type="${type}" name="${name}" value="${esc(val)}" ${type === 'number' ? 'step="any" min="0"' : ''} ${extra}></label>`;
  const opts = (map, val) => Object.entries(map).map(([k, l]) => `<option value="${k}" ${k === val ? 'selected' : ''}>${l}</option>`).join('');
  const sel = (lab, name, map, val, extra = '') => `<label class="f"><span>${lab}</span><select name="${name}" ${extra}>${opts(map, val)}</select></label>`;
  const chk = (lab, name, on) => `<label class="f f--chk"><input type="checkbox" name="${name}" ${on ? 'checked' : ''}><span>${lab}</span></label>`;
  const monSel = (name, val) => `<select name="${name}"><option value="ARS" ${val === 'ARS' ? 'selected' : ''}>ARS</option><option value="USD" ${val === 'USD' ? 'selected' : ''}>USD</option></select>`;

  function setPath(obj, path, val) {
    const ks = path.split('.'); let o = obj;
    ks.slice(0, -1).forEach(k => { if (typeof o[k] !== 'object' || o[k] === null) o[k] = {}; o = o[k]; });
    o[ks[ks.length - 1]] = val;
  }
  function collect(form, base) {
    const out = clone(base);
    [...form.elements].forEach(el => {
      if (!el.name || el.disabled) return;
      let val;
      if (el.type === 'checkbox') val = el.checked;
      else if (el.type === 'number') val = num(el.value);
      else val = el.value.trim ? el.value.trim() : el.value;
      setPath(out, el.name, val);
    });
    return out;
  }

  /* ---------- carga y render ---------- */
  async function load() {
    const [v, r, c, s] = await Promise.all([Db.list('vehicles'), Db.list('reservations'), Db.list('receivables'), Db.getSettings()]);
    Object.assign(S, { vehicles: v, reservations: r, receivables: c, settings: s });
    if (S.user) renderAll();
  }
  function renderAll() {
    $('#tcInput').value = S.settings.tc;
    renderInventory(); renderOps(); renderDebts(); renderData();
  }

  /* ===== VISTA 1: INVENTARIO ===== */
  function renderInventory() {
    const now = new Date();
    const stock = S.vehicles.filter(v => v.estado !== 'vendido').length;
    const taller = S.vehicles.filter(v => v.estado === 'taller').length;
    const sen = S.vehicles.filter(v => v.estado === 'senado').length;
    const vend = S.vehicles.filter(v => {
      if (v.estado !== 'vendido' || !v.fechaVenta) return false;
      const d = new Date(v.fechaVenta + 'T00:00:00');
      return d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear();
    }).length;
    $('#kpis').innerHTML =
      `<div class="kpi kpi--g"><small>Total en stock</small><strong>${stock}</strong><em>disponibles + señados + taller</em></div>
       <div class="kpi kpi--k"><small>En preparación / taller</small><strong>${taller}</strong><em>en alistamiento</em></div>
       <div class="kpi kpi--y"><small>Señados</small><strong>${sen}</strong><em>reservas activas</em></div>
       <div class="kpi"><small>Vendidos en el mes</small><strong>${vend}</strong><em>${now.toLocaleString('es-AR', { month: 'long', year: 'numeric' })}</em></div>`;

    const q = $('#invSearch').value.trim().toLowerCase(), e = $('#invEstado').value, o = $('#invOrigen').value;
    const list = S.vehicles.filter(v =>
      (!e || v.estado === e) && (!o || v.origen === o) &&
      (!q || [v.dominio, v.marca, v.modelo, v.version, v.anio, v.color].join(' ').toLowerCase().includes(q)));
    $('#invBody').innerHTML = list.map(v => {
      const dn = docsDone(v), pct = Math.round(dn / DOCS.length * 100), debt = debtOf(v);
      return `<tr class="click" data-id="${v.id}">
        <td><span class="t1">${esc(label(v))}</span><span class="t2">${esc(v.dominio)}${v.color ? ' · ' + esc(v.color) : ''}</span></td>
        <td>${esc(v.anio)}</td><td class="num">${nf.format(v.km || 0)} km</td>
        <td>${ORIGEN[v.origen] || '—'}${v.origen === 'consignacion' && v.consignante ? `<span class="t2">${esc(v.consignante)}</span>` : ''}</td>
        <td><span class="b b--${v.estado}">${ESTADOS[v.estado] || v.estado}</span></td>
        <td class="num">${moneyPair(v.listaARS, v.listaUSD)}</td>
        <td><div class="prog ${pct < 60 ? 'low' : ''}" style="--p:${pct}%"><i></i>${dn}/${DOCS.length}</div></td>
        <td>${debt ? `<span class="b b--red">${ars(debt)}</span>` : '<span class="b b--ok">Sin deudas</span>'}</td>
      </tr>`;
    }).join('');
    $('#invEmpty').hidden = list.length > 0;
  }

  /* ----- Ficha 360° ----- */
  function openDrawer(id) {
    const isNew = !id;
    const v = isNew ? Db.newVehicle() : clone(vById(id));
    if (!v) return;
    S.drawer = { isNew, base: v };
    $('#drEyebrow').textContent = isNew ? 'Nuevo ingreso' : 'Ficha 360°';
    $('#drTitle').textContent = isNew ? 'Alta de vehículo' : `${label(v)} · ${v.dominio || 'sin dominio'}`;
    $('#drDelete').hidden = isNew || !isAdmin();
    $('#drBody').innerHTML = drawerHTML(v, isNew);
    $$('#drTabs .tab').forEach(t => t.classList.toggle('is-active', t.dataset.pane === 'tec'));
    $$('#drBody .pane').forEach(p => p.classList.toggle('is-active', p.dataset.pane === 'tec'));
    $('#scrim').hidden = false;
    $('#drawer').classList.add('open'); $('#drawer').setAttribute('aria-hidden', 'false');
    updateProfit(); toggleConsig();
  }
  function closeDrawer() {
    $('#drawer').classList.remove('open'); $('#drawer').setAttribute('aria-hidden', 'true');
    if ($('#modal').hidden) $('#scrim').hidden = true;
    S.drawer = null;
  }
  function drawerHTML(v, isNew) {
    const adm = isAdmin();
    const activeRes = S.reservations.find(r => r.vehicleId === v.id && r.estado !== 'entregado');
    const pat = v.deudaPatentes || { monto: 0, paga: 'agencia' }, mul = v.deudaMultas || { monto: 0, paga: 'agencia' };
    return `
    <div class="pane is-active" data-pane="tec">
      ${activeRes ? `<div class="alert-res">Reservado por <b>${esc(activeRes.cliente)}</b> · vence ${fmtDate(activeRes.vencimiento)}.</div>` : ''}
      <div class="sub">Identificación</div>
      <div class="row2">${fld('Dominio (Patente)', 'dominio', v.dominio, 'text', 'style="text-transform:uppercase" placeholder="AB 123 CD"')}${fld('Marca', 'marca', v.marca, 'text', 'required')}</div>
      <div class="row2">${fld('Modelo', 'modelo', v.modelo, 'text', 'required')}${fld('Versión', 'version', v.version)}</div>
      <div class="row3">${fld('Año', 'anio', v.anio, 'number')}${fld('Kilometraje', 'km', v.km, 'number')}${fld('Color', 'color', v.color)}</div>
      <div class="row2">${fld('Chasis', 'chasis', v.chasis)}${fld('Motor', 'motor', v.motor)}</div>
      <div class="sub">Estado y ubicación</div>
      <div class="row2">${sel('Estado', 'estado', ESTADOS, v.estado)}${sel('Origen', 'origen', ORIGEN, v.origen)}</div>
      <div id="consigBox">${fld('Titular / Consignante', 'consignante', v.consignante)}</div>
      <div class="row2">${fld('Ubicación física', 'ubicacion', v.ubicacion, 'text', 'placeholder="Salón, playa, taller…"')}${fld('Fecha de ingreso', 'fechaIngreso', v.fechaIngreso, 'date')}</div>
      ${chk('Cuenta con 2da llave', 'segundaLlave', v.segundaLlave)}
      <div class="sub" style="margin-top:1.2rem">Publicación en el sitio web</div>
      <p class="note" style="margin:-.4rem 0 .8rem">index.html muestra los autos <b>Disponibles</b> y los <b>Señados</b> (con cartel "Reservado"). En Taller y Vendidos se ocultan.</p>
      <div class="row3">${sel('Categoría', 'categoria', CATEGORIAS, v.categoria || 'sedan')}${fld('Etiqueta en la foto', 'etiqueta', v.etiqueta, 'text', 'placeholder="Ej: 0km, Destacado"')}${fld('Detalle destacado', 'extra', v.extra, 'text', 'placeholder="Ej: GNC de 5ta"')}</div>
      <div class="photo">
        <img id="fotoPrev" alt="Foto del vehículo" src="${esc(v.foto || '')}" ${v.foto ? '' : 'hidden'}>
        <div class="photo__ctl">
          <input type="hidden" name="foto" value="${esc(v.foto || '')}">
          <input type="file" id="fotoFile" accept="image/*" hidden>
          <button type="button" class="btn btn--outline btn--sm" id="fotoPick">Subir foto</button>
          <button type="button" class="link link--mut" id="fotoDel">Quitar</button>
          <span class="note" id="fotoNote">${v.foto ? '' : 'Sin foto: en la web se mostrará el logo.'}</span>
        </div>
      </div>
    </div>

    <div class="pane" data-pane="pre">
      <div class="sub">Precio de lista público</div>
      <div class="row2">${fld('Lista · USD', 'listaUSD', v.listaUSD, 'number')}${fld('Lista · ARS', 'listaARS', v.listaARS, 'number')}</div>
      <div class="sub">Precio mínimo de contado</div>
      <div class="row2">${fld('Mínimo · USD', 'minUSD', v.minUSD, 'number')}${fld('Mínimo · ARS', 'minARS', v.minARS, 'number')}</div>
      <div class="sub">Gastos de alistamiento / taller</div>
      <div class="row2">${fld('Gastos · USD', 'gastosUSD', v.gastosUSD, 'number')}${fld('Gastos · ARS', 'gastosARS', v.gastosARS, 'number')}</div>
      ${adm ? `
      <div class="sub">Costo de toma (solo Administrador)</div>
      <div class="row3">${fld('Costo · USD', 'costoUSD', v.costoUSD, 'number')}${fld('Costo · ARS', 'costoARS', v.costoARS, 'number')}${fld('Venta final · USD', 'precioVentaUSD', v.precioVentaUSD, 'number')}</div>
      <div class="profit" id="profitBox"></div>` : `<p class="note">Costo de toma y ganancia neta: solo visibles para Administrador.</p>`}
      <p class="note">Tipo de cambio de referencia: 1 USD = ${ars(tc())}.</p>
    </div>

    <div class="pane" data-pane="doc">
      <div class="sub">Checklist de documentación</div>
      ${DOCS.map(([k, l]) => chk(l, 'docs.' + k, v.docs && v.docs[k])).join('')}
      <div class="sub" style="margin-top:1.2rem">Deudas</div>
      <div class="debt-box">
        <div class="row2">${fld('Deuda de patentes (Rentas) · ARS', 'deudaPatentes.monto', pat.monto, 'number')}${sel('¿Quién abona?', 'deudaPatentes.paga', PAGAN, pat.paga)}</div>
      </div>
      <div class="debt-box">
        <div class="row2">${fld('Deuda de multas · ARS', 'deudaMultas.monto', mul.monto, 'number')}${sel('¿Quién abona?', 'deudaMultas.paga', PAGAN, mul.paga)}</div>
      </div>
    </div>`;
  }
  function toggleConsig() {
    const f = $('#vForm'); if (!f.elements.origen) return;
    $('#consigBox').hidden = f.elements.origen.value !== 'consignacion';
  }
  function updateProfit() {
    const box = $('#profitBox'); if (!box) return;
    const els = $('#vForm').elements, g = n => num(els[n] && els[n].value);
    const lista = g('listaUSD') + g('listaARS') / tc(), min = g('minUSD') + g('minARS') / tc();
    const gastos = g('gastosUSD') + g('gastosARS') / tc(), costo = g('costoUSD') + g('costoARS') / tc(), venta = g('precioVentaUSD');
    const cl = n => n >= 0 ? 'pos' : 'neg';
    const gl = lista - costo - gastos, gm = min - costo - gastos, gr = venta - costo - gastos;
    const cons = els.origen && els.origen.value === 'consignacion';
    box.innerHTML = `<h4>Rentabilidad (USD · TC ${nf.format(tc())})</h4>
      <div><span>Costo de toma + gastos</span><span>${usd(costo + gastos)}</span></div>
      <div><span>Ganancia sobre precio de lista</span><span class="${cl(gl)}">${usd(gl)}</span></div>
      <div><span>Ganancia sobre precio mínimo</span><span class="${cl(gm)}">${usd(gm)}</span></div>
      <div class="big"><span>${venta ? 'Ganancia neta real' : 'Ganancia neta real (sin venta aún)'}</span><span class="${venta ? cl(gr) : ''}">${venta ? usd(gr) : '—'}</span></div>
      ${cons ? '<div><span style="color:#9a9aa2;font-size:.8rem">Consignación: cargá costo 0 y el resultado equivale a la comisión.</span></div>' : ''}`;
  }
  function setFoto(val) {
    const f = $('#vForm').elements.foto, img = $('#fotoPrev');
    f.value = val; img.src = val; img.hidden = !val;
    $('#fotoNote').textContent = val ? 'Se guarda al presionar "Guardar cambios".' : 'Sin foto: en la web se mostrará el logo.';
  }
  function resizeImage(file, maxW = 900) {
    return new Promise((resolve, reject) => {
      const img = new Image(), url = URL.createObjectURL(file);
      img.onload = () => {
        const k = Math.min(1, maxW / img.width), c = document.createElement('canvas');
        c.width = Math.round(img.width * k); c.height = Math.round(img.height * k);
        c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
        URL.revokeObjectURL(url);
        let q = 0.78, out = c.toDataURL('image/jpeg', q);
        while (out.length > 700000 && q > 0.35) { q -= 0.1; out = c.toDataURL('image/jpeg', q); } // Firestore: máx 1 MB por documento
        resolve(out);
      };
      img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('img')); };
      img.src = url;
    });
  }
  async function saveVehicle(e) {
    e.preventDefault();
    if (!S.drawer) return;
    const f = $('#vForm');
    const out = collect(f, S.drawer.base);
    out.dominio = (out.dominio || '').toUpperCase();
    if (!out.marca || !out.modelo) { toast('Completá Marca y Modelo.'); return; }
    if (out.dominio && S.vehicles.some(v => v.id !== out.id && (v.dominio || '').replace(/\s/g, '') === out.dominio.replace(/\s/g, ''))) { toast('Ya existe un vehículo con ese dominio.'); return; }
    if (out.estado === 'vendido' && !out.fechaVenta) out.fechaVenta = isoDate(new Date());
    if (out.estado !== 'vendido') out.fechaVenta = '';
    const wasNew = S.drawer.isNew;
    await Db.save('vehicles', out);
    closeDrawer();
    toast(wasNew ? 'Vehículo ingresado al stock.' : 'Ficha actualizada.', true);
  }
  async function deleteVehicle() {
    if (!S.drawer || S.drawer.isNew || !isAdmin()) return;
    const v = S.drawer.base;
    if (!confirm(`¿Eliminar ${label(v)} (${v.dominio}) del sistema? Esta acción no se puede deshacer.`)) return;
    await Db.remove('vehicles', v.id);
    closeDrawer(); toast('Vehículo eliminado.');
  }

  /* ===== VISTA 2: OPERACIONES ===== */
  function payResume(r) {
    const p = r.pago || {}, out = [];
    if (p.efectivo && num(p.efectivo.monto)) out.push('Efvo ' + cash(p.efectivo.monto, p.efectivo.mon));
    if (p.transferencia && num(p.transferencia.monto)) out.push('Transf ' + cash(p.transferencia.monto, p.transferencia.mon));
    if (p.financiacion && num(p.financiacion.monto)) out.push('Financ ' + cash(p.financiacion.monto, p.financiacion.mon));
    return out.length ? out.map(x => `<span class="t2" style="color:var(--ink)">${x}</span>`).join('') : '—';
  }
  function renderOps() {
    const f = $('#opsFilter').value;
    const list = S.reservations.filter(r => f === 'todas' || (f === 'entregadas' ? r.estado === 'entregado' : r.estado !== 'entregado'))
      .sort((a, b) => (a.vencimiento || '').localeCompare(b.vencimiento || ''));
    $('#opsBody').innerHTML = list.map(r => {
      const v = vById(r.vehicleId), done = r.estado === 'entregado';
      return `<tr class="${done ? 'muted' : ''}" data-id="${r.id}">
        <td>${v ? `<a class="t1 link" data-open="${v.id}">${esc(label(v))}</a><span class="t2">${esc(v.dominio)}</span>` : '<span class="t2">Vehículo eliminado</span>'}</td>
        <td><span class="t1">${esc(r.cliente)}</span><span class="t2">${esc(r.telefono)}</span></td>
        <td>${esc(r.vendedor)}</td>
        <td class="num">${moneyPair(r.montoARS, r.montoUSD)}</td>
        <td>${dueBadge(r.vencimiento, !done)}</td>
        <td>${done ? '<span class="b b--vendido">Entregado</span>' :
          `<select class="inl" data-act="estado">${opts(RES_ESTADOS, r.estado)}</select>`}</td>
        <td>${r.permuta && r.permuta.activa ? `<span class="b b--amber">${r.permuta.llaveXLlave ? 'Llave x llave' : 'Permuta'}</span><span class="t2">${esc(r.permuta.descripcion)}${num(r.permuta.valorUSD) ? ' · ' + usd(r.permuta.valorUSD) : ''}</span>` : '<span class="t2">—</span>'}</td>
        <td>${payResume(r)}</td>
        <td><div class="acts">
          ${done ? '' : `<button class="link" data-act="edit">Editar</button><button class="link" data-act="deliver">Entregar</button><button class="link link--mut" data-act="cancel">Cancelar</button>`}
          ${done ? `<button class="link" data-act="edit">Ver</button>` : ''}
        </div></td>
      </tr>`;
    }).join('');
    $('#opsEmpty').hidden = list.length > 0;
  }

  function blankRes() {
    return {
      vehicleId: '', cliente: '', telefono: '', vendedor: S.user ? S.user.user : '', montoARS: 0, montoUSD: 0, vencimiento: addDays(7), estado: 'esperando_credito',
      permuta: { activa: false, llaveXLlave: false, descripcion: '', dominio: '', valorUSD: 0 },
      pago: { efectivo: { monto: 0, mon: 'USD' }, transferencia: { monto: 0, mon: 'USD' }, financiacion: { monto: 0, mon: 'USD', cuotas: 0, montoCuota: 0, primerVenc: '' } }
    };
  }
  function openResModal(id) {
    const base = id ? clone(S.reservations.find(r => r.id === id)) : blankRes();
    const locked = base.estado === 'entregado';
    const vopts = S.vehicles.filter(v => v.id === base.vehicleId || v.estado === 'disponible' || v.estado === 'taller')
      .map(v => `<option value="${v.id}" ${v.id === base.vehicleId ? 'selected' : ''}>${esc(label(v))} · ${esc(v.dominio)} (${ESTADOS[v.estado]})</option>`).join('');
    const p = base.pago, pm = base.permuta;
    const body = `
      <div class="sub">Seña / reserva</div>
      <label class="f"><span>Vehículo señado</span><select name="vehicleId" required><option value="">Seleccionar…</option>${vopts}</select></label>
      <div class="row2">${fld('Cliente', 'cliente', base.cliente, 'text', 'required')}${fld('Teléfono', 'telefono', base.telefono, 'tel')}</div>
      <div class="row3">${fld('Vendedor asignado', 'vendedor', base.vendedor)}${fld('Seña · USD', 'montoUSD', base.montoUSD, 'number')}${fld('Seña · ARS', 'montoARS', base.montoARS, 'number')}</div>
      <div class="row2">${fld('Vencimiento de la reserva', 'vencimiento', base.vencimiento, 'date')}${sel('Estado', 'estado', RES_ESTADOS, base.estado === 'entregado' ? 'listo_entrega' : base.estado)}</div>

      <div class="sub" style="margin-top:.6rem">Permuta</div>
      ${chk('Entra un auto en permuta', 'permuta.activa', pm.activa)}
      <div id="permBox" ${pm.activa ? '' : 'hidden'}>
        ${chk('Operación llave por llave', 'permuta.llaveXLlave', pm.llaveXLlave)}
        <div class="row3">${fld('Vehículo recibido', 'permuta.descripcion', pm.descripcion, 'text', 'placeholder="Marca, modelo, año"')}${fld('Dominio', 'permuta.dominio', pm.dominio)}${fld('Valor tomado · USD', 'permuta.valorUSD', pm.valorUSD, 'number')}</div>
      </div>

      <div class="sub" style="margin-top:.6rem">Desglose de pago</div>
      <div class="row3">
        <div class="f"><span>Efectivo</span><div class="cur"><input type="number" step="any" min="0" name="pago.efectivo.monto" value="${p.efectivo.monto}">${monSel('pago.efectivo.mon', p.efectivo.mon)}</div></div>
        <div class="f"><span>Transferencia</span><div class="cur"><input type="number" step="any" min="0" name="pago.transferencia.monto" value="${p.transferencia.monto}">${monSel('pago.transferencia.mon', p.transferencia.mon)}</div></div>
        <div class="f"><span>Financiación / Pagarés</span><div class="cur"><input type="number" step="any" min="0" name="pago.financiacion.monto" value="${p.financiacion.monto}">${monSel('pago.financiacion.mon', p.financiacion.mon)}</div></div>
      </div>
      <div class="row3">${fld('Cantidad de cuotas', 'pago.financiacion.cuotas', p.financiacion.cuotas, 'number')}${fld('Monto de cuota', 'pago.financiacion.montoCuota', p.financiacion.montoCuota, 'number')}${fld('1er vencimiento', 'pago.financiacion.primerVenc', p.financiacion.primerVenc, 'date')}</div>
      <p class="note">Al marcar la operación como <b>Entregada</b>, si hay financiación se crea automáticamente la cuenta corriente en Deudas por Cobrar.</p>`;
    openModal(id ? (locked ? 'Operación entregada' : 'Editar seña') : 'Registrar seña', body, async form => {
      const out = collect(form, base);
      if (locked) out.estado = 'entregado';
      if (!out.vehicleId) { toast('Seleccioná un vehículo.'); return false; }
      const veh = vById(out.vehicleId);
      const saved = await Db.save('reservations', out);
      // Libera el auto anterior si cambió
      if (base.vehicleId && base.vehicleId !== out.vehicleId) {
        const old = vById(base.vehicleId);
        if (old && old.estado === 'senado') { old.estado = 'disponible'; await Db.save('vehicles', old); }
      }
      // Seña => el auto pasa automáticamente a "Señado"
      if (veh && !locked && veh.estado !== 'senado') { veh.estado = 'senado'; await Db.save('vehicles', veh); }
      toast(id ? 'Operación actualizada.' : 'Seña registrada. El auto quedó como Señado.', true);
      return saved;
    }, locked ? 'Guardar' : 'Guardar');
  }
  async function deliverRes(id) {
    const r = S.reservations.find(x => x.id === id); if (!r) return;
    const v = vById(r.vehicleId);
    if (!confirm(`¿Marcar como entregado${v ? ' el ' + label(v) : ''} a ${r.cliente}?`)) return;
    r.estado = 'entregado';
    await Db.save('reservations', r);
    if (v) { v.estado = 'vendido'; v.fechaVenta = isoDate(new Date()); await Db.save('vehicles', v); }
    const fin = r.pago && r.pago.financiacion;
    if (fin && num(fin.monto) > 0 && !S.receivables.some(c => c.reservaId === r.id)) {
      const n = num(fin.cuotas) || 1;
      await Db.save('receivables', {
        reservaId: r.id, cliente: r.cliente, telefono: r.telefono,
        vehiculo: v ? `${label(v)} ${v.anio} (${v.dominio})` : '', moneda: fin.mon, total: num(fin.monto),
        cuotasTotal: n, cuotasPagadas: 0, montoCuota: num(fin.montoCuota) || Math.round(num(fin.monto) / n),
        proxVenc: fin.primerVenc || addDays(30), notas: 'Generada automáticamente desde la operación.'
      });
      toast('Entregado. Se creó la cuenta corriente del cliente.', true);
    } else toast('Vehículo entregado.', true);
  }
  async function cancelRes(id) {
    const r = S.reservations.find(x => x.id === id); if (!r) return;
    if (!confirm(`¿Cancelar la seña de ${r.cliente}? El auto vuelve a Disponible.`)) return;
    await Db.remove('reservations', id);
    const v = vById(r.vehicleId);
    if (v && v.estado === 'senado') { v.estado = 'disponible'; await Db.save('vehicles', v); }
    toast('Reserva cancelada.');
  }

  /* ===== VISTA 3: DEUDAS ===== */
  function renderDebts() {
    // --- por cobrar ---
    const rec = S.receivables.slice().sort((a, b) => (a.proxVenc || '9').localeCompare(b.proxVenc || '9'));
    const sUSD = rec.filter(c => c.moneda === 'USD').reduce((s, c) => s + saldo(c), 0);
    const sARS = rec.filter(c => c.moneda === 'ARS').reduce((s, c) => s + saldo(c), 0);
    const venc = rec.filter(c => saldo(c) > 0 && c.proxVenc && daysTo(c.proxVenc) < 0).length;
    $('#recKpis').innerHTML =
      `<div class="kpi kpi--g"><small>Saldo a cobrar · USD</small><strong>${usd(sUSD)}</strong></div>
       <div class="kpi kpi--k"><small>Saldo a cobrar · ARS</small><strong>${ars(sARS)}</strong></div>
       <div class="kpi ${venc ? '' : 'kpi--g'}"><small>Cuotas vencidas</small><strong>${venc}</strong><em>cuentas con atraso</em></div>`;
    $('#recBody').innerHTML = rec.map(c => {
      const s = saldo(c), paid = s <= 0;
      return `<tr data-id="${c.id}" class="${paid ? 'muted' : ''}">
        <td><span class="t1">${esc(c.cliente)}</span><span class="t2">${esc(c.telefono)}</span></td>
        <td>${esc(c.vehiculo)}${c.notas ? `<span class="t2">${esc(c.notas)}</span>` : ''}</td>
        <td class="num">${cash(c.total, c.moneda)}</td>
        <td class="num">${c.cuotasPagadas}/${c.cuotasTotal}<span class="t2">${cash(num(c.montoCuota), c.moneda)} c/u</span></td>
        <td class="num"><b>${cash(s, c.moneda)}</b></td>
        <td>${paid ? '<span class="b b--ok">Cancelada</span>' : dueBadge(c.proxVenc)}</td>
        <td><div class="acts">${paid ? '' : '<button class="link" data-act="pay">Registrar cuota</button>'}<button class="link" data-act="edit">Editar</button><button class="link link--mut" data-act="del">Eliminar</button></div></td>
      </tr>`;
    }).join('');
    $('#recEmpty').hidden = rec.length > 0;

    // --- stock ---
    const stock = S.vehicles.filter(v => v.estado !== 'vendido');
    const trabados = stock.filter(v => debtOf(v) > 0 || docsMissing(v).length);
    const tPat = stock.reduce((s, v) => s + num(v.deudaPatentes && v.deudaPatentes.monto), 0);
    const tMul = stock.reduce((s, v) => s + num(v.deudaMultas && v.deudaMultas.monto), 0);
    $('#stKpis').innerHTML =
      `<div class="kpi"><small>Patentes adeudadas</small><strong>${ars(tPat)}</strong></div>
       <div class="kpi kpi--y"><small>Multas adeudadas</small><strong>${ars(tMul)}</strong></div>
       <div class="kpi kpi--k"><small>Autos con trabas</small><strong>${trabados.length}<span style="font-size:1rem;color:var(--muted)"> / ${stock.length}</span></strong><em>para poder transferir</em></div>`;
    $('#stBody').innerHTML = trabados.map(v => {
      const miss = docsMissing(v), pat = v.deudaPatentes || {}, mul = v.deudaMultas || {};
      const ok = !debtOf(v) && !miss.length;
      return `<tr class="click" data-id="${v.id}">
        <td><span class="t1">${esc(label(v))}</span><span class="t2">${esc(v.dominio)} · ${esc(v.anio)}</span></td>
        <td><span class="b b--${v.estado}">${ESTADOS[v.estado]}</span></td>
        <td>${num(pat.monto) ? `<b>${ars(pat.monto)}</b><span class="t2">Abona: ${PAGAN[pat.paga] || '—'}</span>` : '<span class="t2">—</span>'}</td>
        <td>${num(mul.monto) ? `<b>${ars(mul.monto)}</b><span class="t2">Abona: ${PAGAN[mul.paga] || '—'}</span>` : '<span class="t2">—</span>'}</td>
        <td>${miss.length ? miss.map(m => `<span class="chip-miss">${m}</span>`).join('') : '<span class="b b--ok">Completa</span>'}</td>
        <td>${ok ? '<span class="b b--ok">Lista</span>' : '<span class="b b--red">Bloqueada</span>'}</td>
      </tr>`;
    }).join('');
    $('#stEmpty').hidden = trabados.length > 0;
  }

  function openRecModal(id) {
    const base = id ? clone(S.receivables.find(c => c.id === id)) :
      { reservaId: '', cliente: '', telefono: '', vehiculo: '', moneda: 'USD', total: 0, cuotasTotal: 12, cuotasPagadas: 0, montoCuota: 0, proxVenc: addDays(30), notas: '' };
    const body = `
      <div class="row2">${fld('Cliente', 'cliente', base.cliente, 'text', 'required')}${fld('Teléfono', 'telefono', base.telefono, 'tel')}</div>
      ${fld('Vehículo retirado', 'vehiculo', base.vehiculo, 'text', 'required placeholder="Marca modelo año (dominio)"')}
      <div class="row3">${sel('Moneda', 'moneda', { USD: 'USD', ARS: 'ARS' }, base.moneda)}${fld('Monto total financiado', 'total', base.total, 'number', 'required')}${fld('Próx. vencimiento', 'proxVenc', base.proxVenc, 'date')}</div>
      <div class="row3">${fld('Cuotas totales', 'cuotasTotal', base.cuotasTotal, 'number')}${fld('Cuotas pagadas', 'cuotasPagadas', base.cuotasPagadas, 'number')}${fld('Monto de cuota', 'montoCuota', base.montoCuota, 'number')}</div>
      <label class="f"><span>Notas</span><textarea name="notas">${esc(base.notas)}</textarea></label>`;
    openModal(id ? 'Editar cuenta corriente' : 'Nueva cuenta corriente', body, async form => {
      const out = collect(form, base);
      if (!out.cuotasTotal || out.cuotasTotal < 1) out.cuotasTotal = 1;
      if (!num(out.montoCuota)) out.montoCuota = Math.round(num(out.total) / out.cuotasTotal);
      await Db.save('receivables', out);
      toast('Cuenta corriente guardada.', true);
    });
  }
  async function payInstallment(id) {
    const c = S.receivables.find(x => x.id === id); if (!c) return;
    c.cuotasPagadas = Math.min(c.cuotasTotal, num(c.cuotasPagadas) + 1);
    c.proxVenc = saldo(c) <= 0 ? '' : addMonth(c.proxVenc);
    await Db.save('receivables', c);
    toast(saldo(c) <= 0 ? 'Cuenta cancelada por completo.' : 'Cuota registrada.', true);
  }

  /* ===== VISTA 4: DATOS ===== */
  function renderData() {
    if (!isAdmin()) return;
    $('#dataInfo').innerHTML =
      `<dt>Backend</dt><dd>${Db.backend} · ${esc(Db.projectId)}</dd>
       <dt>Vehículos</dt><dd>${S.vehicles.length}</dd>
       <dt>Reservas / operaciones</dt><dd>${S.reservations.length}</dd>
       <dt>Cuentas corrientes</dt><dd>${S.receivables.length}</dd>
       <dt>Tipo de cambio</dt><dd>1 USD = ${ars(tc())}</dd>
       <dt>Sesión</dt><dd>${esc(S.user.user)} · ${esc(S.user.label)}</dd>`;
    $('#schemaBox').textContent =
`vehicles/{id}        dominio, marca, modelo, version, anio, km, color, chasis, motor, ubicacion, segundaLlave,
                     estado (disponible|senado|taller|vendido), origen (propio|consignacion), consignante,
                     fechaIngreso, fechaVenta, listaARS/USD, minARS/USD, gastosARS/USD, costoARS/USD*, precioVentaUSD*,
                     docs{titulo,cedula,f08,f12,informe,libreDeudaPrenda}, deudaPatentes{monto,paga}, deudaMultas{monto,paga}
reservations/{id}    vehicleId, cliente, telefono, vendedor, montoARS, montoUSD, vencimiento,
                     estado (esperando_credito|esperando_transferencia|listo_entrega|entregado),
                     permuta{activa,llaveXLlave,descripcion,dominio,valorUSD}, pago{efectivo,transferencia,financiacion}
receivables/{id}     reservaId, cliente, telefono, vehiculo, moneda, total, cuotasTotal, cuotasPagadas, montoCuota, proxVenc, notas
settings             tc (tipo de cambio ARS/USD)
* campos solo para rol admin (aplicar en Firestore Security Rules)`;
  }

  /* ---------- modal genérico ---------- */
  function openModal(title, bodyHTML, onSubmit) {
    $('#mdTitle').textContent = title;
    $('#mdBody').innerHTML = bodyHTML;
    S.modalSubmit = onSubmit;
    $('#modal').hidden = false; $('#scrim').hidden = true;
  }
  function closeModal() {
    $('#modal').hidden = true; S.modalSubmit = null;
    if (!$('#drawer').classList.contains('open')) $('#scrim').hidden = true;
  }

  /* ---------- navegación ---------- */
  function setView(v) {
    if (v === 'data' && !isAdmin()) v = 'inventory';
    S.view = v;
    $$('.nav-i').forEach(b => b.classList.toggle('is-active', b.dataset.view === v));
    $$('.view').forEach(s => s.classList.toggle('is-active', s.id === 'view-' + v));
    $('#viewTitle').textContent = VIEW_TITLES[v];
    $('#side').classList.remove('open');
    window.scrollTo(0, 0);
  }
  function setDebtTab(t) {
    S.debtTab = t;
    $$('#debtTabs .tab').forEach(b => b.classList.toggle('is-active', b.dataset.tab === t));
    $('#debt-cobrar').hidden = t !== 'cobrar'; $('#debt-stock').hidden = t !== 'stock';
  }

  /* ---------- sesión ---------- */
  const dbMsg = err => (err && err.code === 'permission-denied')
    ? 'Sin permisos en Firestore. Publicá las reglas de firestore.rules en la consola de Firebase.'
    : 'No se pudo conectar con la base de datos (' + ((err && (err.code || err.message)) || 'error') + ').';

  /** Se dispara con cada cambio de sesión de Firebase Auth (login, logout y recarga de página). */
  async function onAuth(session) {
    if (!session) {
      if (S.user) { Db.stop(); resetUI(); }
      return;
    }
    if (S.user && S.user.uid === session.uid) return;
    const btn = $('#lgBtn'); btn.disabled = true; btn.textContent = 'Conectando…';
    try { await Db.start(session); enter(session); }
    catch (err) { console.error(err); $('#lgErr').textContent = dbMsg(err); await Auth.logout(); }
    finally { btn.disabled = false; btn.textContent = 'Ingresar'; }
  }

  function enter(session) {
    S.user = session;
    document.body.classList.remove('is-login', 'role-admin', 'role-vendedor');
    document.body.classList.add('role-' + session.role);
    $('#app').hidden = false;
    $('#whoName').textContent = session.user;
    $('#whoRole').textContent = session.label;
    $('#rolePill').textContent = session.role === 'admin' ? 'Administrador' : 'Vendedor / Gestoría';
    $('#tcInput').readOnly = session.role !== 'admin';
    setView('inventory');
    load();
  }
  function resetUI() {
    S.user = null; S.vehicles = []; S.reservations = []; S.receivables = [];
    closeDrawer(); closeModal();
    $('#app').hidden = true;
    document.body.className = 'is-login';
    $('#loginForm').reset();
  }
  const leave = () => Auth.logout();

  /* ---------- eventos ---------- */
  function bind() {
    $('#loginForm').addEventListener('submit', async e => {
      e.preventDefault();
      $('#lgErr').textContent = '';
      const btn = $('#lgBtn'); btn.disabled = true;
      try { await Auth.login({ user: $('#lgUser').value, password: $('#lgPass').value }); } // onAuth() hace el resto
      catch (err) { $('#lgErr').textContent = err.message; btn.disabled = false; }
    });
    $('#logoutBtn').addEventListener('click', leave);
    $('#sideToggle').addEventListener('click', () => $('#side').classList.toggle('open'));
    $$('.nav-i').forEach(b => b.addEventListener('click', () => setView(b.dataset.view)));
    $$('#debtTabs .tab').forEach(b => b.addEventListener('click', () => setDebtTab(b.dataset.tab)));

    $('#tcInput').addEventListener('change', async e => {
      const v = num(e.target.value); if (v > 0 && isAdmin()) { await Db.saveSettings({ tc: v }); toast('Tipo de cambio actualizado.', true); }
      else e.target.value = S.settings.tc;
    });

    // inventario
    ['invSearch', 'invEstado', 'invOrigen'].forEach(id => $('#' + id).addEventListener('input', renderInventory));
    $('#newVehicleBtn').addEventListener('click', () => openDrawer(null));
    $('#invBody').addEventListener('click', e => { const tr = e.target.closest('tr[data-id]'); if (tr) openDrawer(tr.dataset.id); });
    $('#stBody').addEventListener('click', e => { const tr = e.target.closest('tr[data-id]'); if (tr) openDrawer(tr.dataset.id); });

    // drawer
    $('#drClose').addEventListener('click', closeDrawer);
    $('#drCancel').addEventListener('click', closeDrawer);
    $('#scrim').addEventListener('click', () => { if (!$('#modal').hidden) closeModal(); else closeDrawer(); });
    $('#drTabs').addEventListener('click', e => {
      const t = e.target.closest('.tab'); if (!t) return;
      $$('#drTabs .tab').forEach(b => b.classList.toggle('is-active', b === t));
      $$('#drBody .pane').forEach(p => p.classList.toggle('is-active', p.dataset.pane === t.dataset.pane));
    });
    $('#vForm').addEventListener('input', updateProfit);
    $('#vForm').addEventListener('change', e => { if (e.target.name === 'origen') { toggleConsig(); updateProfit(); } });
    $('#vForm').addEventListener('submit', saveVehicle);
    $('#drDelete').addEventListener('click', deleteVehicle);

    // foto del vehículo: se redimensiona en el navegador y se guarda como dataURL en Firestore (sin Storage)
    $('#drBody').addEventListener('click', e => {
      if (e.target.id === 'fotoPick') $('#fotoFile').click();
      if (e.target.id === 'fotoDel') setFoto('');
    });
    $('#drBody').addEventListener('change', async e => {
      if (e.target.id !== 'fotoFile' || !e.target.files[0]) return;
      try { setFoto(await resizeImage(e.target.files[0])); }
      catch (err) { toast('No se pudo procesar la imagen.'); }
      e.target.value = '';
    });

    // operaciones
    $('#opsFilter').addEventListener('change', renderOps);
    $('#newResBtn').addEventListener('click', () => openResModal(null));
    $('#opsBody').addEventListener('click', e => {
      const open = e.target.closest('[data-open]'); if (open) { openDrawer(open.dataset.open); return; }
      const b = e.target.closest('[data-act]'); if (!b || b.tagName === 'SELECT') return;
      const id = b.closest('tr').dataset.id;
      ({ edit: openResModal, deliver: deliverRes, cancel: cancelRes }[b.dataset.act] || (() => { }))(id);
    });
    $('#opsBody').addEventListener('change', async e => {
      if (e.target.dataset.act !== 'estado') return;
      const r = S.reservations.find(x => x.id === e.target.closest('tr').dataset.id); if (!r) return;
      r.estado = e.target.value; await Db.save('reservations', r); toast('Estado de la operación actualizado.', true);
    });

    // deudas
    $('#newRecBtn').addEventListener('click', () => openRecModal(null));
    $('#recBody').addEventListener('click', async e => {
      const b = e.target.closest('[data-act]'); if (!b) return;
      const id = b.closest('tr').dataset.id;
      if (b.dataset.act === 'pay') payInstallment(id);
      else if (b.dataset.act === 'edit') openRecModal(id);
      else if (b.dataset.act === 'del' && confirm('¿Eliminar esta cuenta corriente?')) { await Db.remove('receivables', id); toast('Cuenta eliminada.'); }
    });

    // modal
    $('#mdClose').addEventListener('click', closeModal);
    $('#mdCancel').addEventListener('click', closeModal);
    $('#mdBody').addEventListener('change', e => {
      if (e.target.name === 'permuta.activa') $('#permBox').hidden = !e.target.checked;
    });
    $('#mdForm').addEventListener('submit', async e => {
      e.preventDefault();
      if (!S.modalSubmit) return;
      const r = await S.modalSubmit(e.target);
      if (r !== false) closeModal();
    });

    // datos
    $('#exportBtn').addEventListener('click', async () => {
      const data = await Db.exportAll();
      const a = document.createElement('a');
      a.href = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }));
      a.download = 'smg-backup-' + isoDate(new Date()) + '.json'; a.click(); URL.revokeObjectURL(a.href);
    });
    $('#syncBtn').addEventListener('click', async () => {
      try { await Db.resyncCatalog(); toast('Catálogo público re-sincronizado.', true); }
      catch (err) { console.error(err); toast('No se pudo sincronizar el catálogo.'); }
    });

    document.addEventListener('keydown', e => {
      if (e.key !== 'Escape') return;
      if (!$('#modal').hidden) closeModal(); else if (S.drawer) closeDrawer();
    });
    ['vehicles', 'reservations', 'receivables', 'settings'].forEach(c => Db.subscribe(c, load));
  }

  bind();
  Auth.onChange(onAuth).catch(err => { console.error(err); $('#lgErr').textContent = 'No se pudo cargar Firebase. Revisá tu conexión.'; });
})();
