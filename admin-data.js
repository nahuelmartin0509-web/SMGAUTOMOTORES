/* =====================================================================
   SMG Automotores · Capa de datos del Panel Admin  —  FIREBASE (Auth + Firestore)
   ---------------------------------------------------------------------
   Misma API que la versión localStorage (window.SMGData), así la UI (admin.js) casi no cambia.
   SDK modular v10 por CDN (import dinámico, funciona en un sitio HTML/JS directo, sin npm).

   Colecciones de Firestore:
     vehiculos/{id}    datos internos del auto (staff)           <- UI: "vehicles"
     operaciones/{id}  señas / permutas / pagos (staff)          <- UI: "reservations"
     deudas/{id}       cuentas corrientes de clientes (staff)    <- UI: "receivables"
     costos/{id}       costo de toma y venta final (SOLO admin)  <- campos costoARS/costoUSD/precioVentaUSD
     catalogo/{id}     espejo PÚBLICO sin datos internos; lo lee index.html en vivo
     config/general    tipo de cambio
   Reglas de seguridad: ver firestore.rules
   ===================================================================== */
(function (global) {
  'use strict';

  const FB_BASE = 'https://www.gstatic.com/firebasejs/10.14.1/';
  const COL = { vehicles: 'vehiculos', reservations: 'operaciones', receivables: 'deudas' };
  const COST_FIELDS = ['costoARS', 'costoUSD', 'precioVentaUSD'];
  const DEFAULT_SETTINGS = { tc: 1400 };
  const PUBLIC_STATES = ['disponible', 'senado']; // lo que se muestra en index.html

  const pad = n => String(n).padStart(2, '0');
  const isoDate = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const addDays = n => { const d = new Date(); d.setDate(d.getDate() + n); return isoDate(d); };
  const uid = p => p + '_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  const clone = o => JSON.parse(JSON.stringify(o));

  /* ---------- modelo ---------- */
  function blankVehicle() {
    return {
      dominio: '', marca: '', modelo: '', version: '', anio: new Date().getFullYear(), km: 0,
      color: '', chasis: '', motor: '', ubicacion: '', segundaLlave: false,
      estado: 'disponible', origen: 'propio', consignante: '', fechaIngreso: isoDate(new Date()), fechaVenta: '',
      listaARS: 0, listaUSD: 0, minARS: 0, minUSD: 0, gastosARS: 0, gastosUSD: 0,
      costoARS: 0, costoUSD: 0, precioVentaUSD: 0,
      categoria: 'sedan', foto: '', etiqueta: '', extra: '', orden: 0,
      docs: { titulo: false, cedula: false, f08: false, f12: false, informe: false, libreDeudaPrenda: false },
      deudaPatentes: { monto: 0, paga: 'agencia' },
      deudaMultas: { monto: 0, paga: 'agencia' }
    };
  }
  function normalizeVehicle(v) {
    const b = blankVehicle();
    return Object.assign(b, v, {
      docs: Object.assign(b.docs, v.docs),
      deudaPatentes: Object.assign(b.deudaPatentes, v.deudaPatentes),
      deudaMultas: Object.assign(b.deudaMultas, v.deudaMultas)
    });
  }
  /** Título público: "TOYOTA COROLLA XEI HV" (respeta 120i y 4x4). */
  function publicTitle(v) {
    return [v.marca, v.modelo, v.version].filter(Boolean).join(' ').toUpperCase()
      .replace(/(\d)I\b/g, '$1i').replace(/(\d)X(\d)/g, '$1x$2');
  }
  /** Espejo público: SOLO datos aptos para la web. null = no se publica. */
  function toPublic(v) {
    if (PUBLIC_STATES.indexOf(v.estado) < 0) return null;
    return {
      marca: v.marca || '', titulo: publicTitle(v), categoria: v.categoria || 'sedan',
      anio: v.anio || '', km: v.km || 0, foto: v.foto || '', etiqueta: v.etiqueta || '', extra: v.extra || '',
      estado: v.estado, orden: v.orden || 0
    };
  }

  /* catálogo actual de index.html (23 unidades) usado como seed inicial */
  const SEED = [
    ['Toyota', 'Corolla', 'XEI HV', 2021, 60000, 'sedan'],
    ['Fiat', 'Cronos', '1.3 Precision CVT', 2023, 52000, 'sedan'],
    ['Fiat', 'Cronos', 'Drive Pack Conectividad', 2021, 63000, 'sedan'],
    ['Volkswagen', 'Amarok', 'V6 Comfortline', 2026, 0, 'pickup', '0km'],
    ['BMW', '120i', '', 2017, 44000, 'hatchback'],
    ['Renault', 'Sandero', 'Stepway Privilege', 2019, 74000, 'hatchback', '', 'GNC de 5ta'],
    ['Renault', 'Megane', 'RS 2.0T', 2016, 55000, 'hatchback'],
    ['Peugeot', '208', 'Allure', 2018, 100000, 'hatchback'],
    ['Volkswagen', 'Taos', 'Comfortline', 2023, 80000, 'suv'],
    ['Toyota', 'Corolla', 'XEI CVT', 2023, 86000, 'sedan', '', 'Service oficial'],
    ['Ford', 'Ranger', '2.0 XLT 4x4 AT', 2024, 45000, 'pickup'],
    ['Peugeot', '208', 'Active Pack', 2023, 38000, 'hatchback'],
    ['Toyota', 'Hilux', 'SRV 4x2 AT', 2022, 90000, 'pickup'],
    ['Toyota', 'Yaris', 'S CVT', 2024, 40000, 'hatchback'],
    ['Citroën', 'C3', 'Feel', 2020, 100000, 'hatchback'],
    ['Chevrolet', 'Cruze', 'LTZ AT', 2017, 136000, 'sedan'],
    ['Ford', 'Ranger', 'V6 Limited+', 2023, 44000, 'pickup'],
    ['Citroën', 'C-Elysée', '', 2017, 90000, 'sedan'],
    ['Toyota', 'Corolla Cross', 'XEI HV', 2021, 45000, 'suv'],
    ['Fiat', 'Palio', 'Fire 1.4', 2015, 135000, 'hatchback'],
    ['Volkswagen', 'Amarok', 'V6 Highline', 2022, 60000, 'pickup'],
    ['Citroën', 'C4', 'Exclusive THP AT', 2016, 108000, 'sedan'],
    ['Volkswagen', 'Vento', 'GLI DSG 2.0T', 2026, 600, 'sedan', 'Casi 0km']
  ];

  /* ---------- Firebase (carga perezosa) ---------- */
  let fbPromise = null;
  function getFb() {
    if (!fbPromise) {
      fbPromise = (async () => {
        if (!global.SMG_FIREBASE_CONFIG) throw new Error('Falta firebase-config.js');
        const [app, auth, fs] = await Promise.all([
          import(FB_BASE + 'firebase-app.js'), import(FB_BASE + 'firebase-auth.js'), import(FB_BASE + 'firebase-firestore.js')]);
        const a = app.initializeApp(global.SMG_FIREBASE_CONFIG);
        return { auth, fs, authI: auth.getAuth(a), db: fs.getFirestore(a) };
      })();
    }
    return fbPromise;
  }

  /* ---------- Auth ---------- */
  function sessionFrom(u) {
    const email = u.email || '';
    const admin = /admin/i.test(email);
    return {
      uid: u.uid, user: email, role: admin ? 'admin' : 'vendedor',
      label: admin ? 'Administrador / Dueño' : 'Vendedor / Gestoría'
    };
  }
  function authMsg(e) {
    const m = {
      'auth/invalid-credential': 'Email o contraseña incorrectos.',
      'auth/wrong-password': 'Email o contraseña incorrectos.',
      'auth/user-not-found': 'Email o contraseña incorrectos.',
      'auth/invalid-email': 'El email no es válido.',
      'auth/user-disabled': 'Este usuario está deshabilitado.',
      'auth/too-many-requests': 'Demasiados intentos. Probá de nuevo en unos minutos.',
      'auth/network-request-failed': 'Sin conexión. Revisá tu internet.'
    };
    return m[e && e.code] || ('No se pudo iniciar sesión (' + ((e && e.code) || (e && e.message) || 'error') + ').');
  }
  const Auth = {
    async login({ user, password }) {
      if (!user || !password) throw new Error('Ingresá email y contraseña.');
      const f = await getFb();
      try { await f.auth.signInWithEmailAndPassword(f.authI, user.trim(), password); }
      catch (e) { throw new Error(authMsg(e)); }
    },
    async logout() { const f = await getFb(); await f.auth.signOut(f.authI); },
    /** cb(session | null) cada vez que cambia la sesión (también al recargar la página). */
    async onChange(cb) {
      const f = await getFb();
      f.auth.onAuthStateChanged(f.authI, u => cb(u ? sessionFrom(u) : null));
    }
  };

  /* ---------- estado local sincronizado en vivo ---------- */
  const st = { role: 'vendedor', raw: { vehicles: [], reservations: [], receivables: [] }, costos: {}, settings: Object.assign({}, DEFAULT_SETTINGS), unsubs: [], ready: false };
  const listeners = {};
  function emit(name) { (listeners[name] || []).forEach(fn => { try { fn(); } catch (e) { console.error(e); } }); }
  function subscribe(name, fn) {
    (listeners[name] = listeners[name] || []).push(fn);
    return () => { listeners[name] = listeners[name].filter(f => f !== fn); };
  }
  function view(col) {
    if (col !== 'vehicles') return st.raw[col];
    return st.raw.vehicles.map(v => {
      const n = normalizeVehicle(v);
      if (st.role === 'admin') return Object.assign(n, st.costos[v.id] || {});
      COST_FIELDS.forEach(k => delete n[k]);
      return n;
    });
  }

  async function seedVehicles(f) {
    const { fs, db } = f, batch = fs.writeBatch(db);
    SEED.forEach((s, i) => {
      const n = i + 1, id = 'cat' + pad(n);
      const v = Object.assign(blankVehicle(), {
        marca: s[0], modelo: s[1], version: s[2], anio: s[3], km: s[4], categoria: s[5], etiqueta: s[6] || '', extra: s[7] || '',
        foto: `CATALOGO/CAT${n}.jpeg`, orden: n, creadoEn: Date.now()
      });
      COST_FIELDS.forEach(k => delete v[k]);
      batch.set(fs.doc(db, 'vehiculos', id), v);
      batch.set(fs.doc(db, 'catalogo', id), toPublic(v));
    });
    await batch.commit();
  }

  /** Inicia las suscripciones en vivo. Resuelve cuando llegaron los primeros datos. Seed automático si no hay vehículos. */
  async function start(session) {
    const f = await getFb(), { fs, db } = f;
    stop();
    st.role = session.role; st.ready = false;
    const watch = (key, ref, onData, extraCheck) => new Promise((resolve, reject) => {
      let first = true, seeding = false;
      const un = fs.onSnapshot(ref, async snap => {
        onData(snap);
        if (extraCheck && snap.empty && !snap.metadata.fromCache && !seeding) {
          seeding = true;
          try { await seedVehicles(f); } catch (e) { first = false; return reject(e); }
          return; // el siguiente snapshot (ya con datos) resuelve
        }
        if (first) { first = false; resolve(); } else if (st.ready) emit(key);
      }, err => { if (first) { first = false; reject(err); } else console.error(err); });
      st.unsubs.push(un);
    });

    const jobs = [
      watch('vehicles', fs.collection(db, COL.vehicles), s => { st.raw.vehicles = s.docs.map(d => ({ id: d.id, ...d.data() })); }, true),
      watch('reservations', fs.collection(db, COL.reservations), s => { st.raw.reservations = s.docs.map(d => ({ id: d.id, ...d.data() })); }),
      watch('receivables', fs.collection(db, COL.receivables), s => { st.raw.receivables = s.docs.map(d => ({ id: d.id, ...d.data() })); }),
      watch('settings', fs.doc(db, 'config', 'general'), s => { st.settings = Object.assign({}, DEFAULT_SETTINGS, s.exists() ? s.data() : {}); })
    ];
    if (session.role === 'admin') {
      jobs.push(watch('vehicles', fs.collection(db, 'costos'), s => { st.costos = {}; s.docs.forEach(d => { st.costos[d.id] = d.data(); }); }));
    }
    try { await Promise.all(jobs); } catch (e) { stop(); throw e; }
    st.ready = true;
  }
  function stop() {
    st.unsubs.forEach(u => { try { u(); } catch (e) { /* noop */ } });
    st.unsubs = []; st.ready = false; st.costos = {};
    st.raw = { vehicles: [], reservations: [], receivables: [] };
  }

  /* ---------- Db ---------- */
  const Db = {
    start, stop, subscribe,
    list(col) { return Promise.resolve(clone(view(col))); },
    get(col, id) { return Promise.resolve(clone(view(col).find(x => x.id === id) || null)); },

    /** Inserta (sin id) o actualiza. Para vehículos mantiene sincronizados costos (admin) y el espejo público. */
    async save(col, obj) {
      const { fs, db } = await getFb();
      const rec = clone(obj), isNew = !rec.id;
      const ref = isNew ? fs.doc(fs.collection(db, COL[col])) : fs.doc(db, COL[col], rec.id);
      rec.id = ref.id;
      if (col !== 'vehicles') { const { id, ...data } = rec; await fs.setDoc(ref, data); return rec; }

      if (isNew) { rec.orden = -Math.floor(Date.now() / 1000); rec.creadoEn = Date.now(); } // nuevos primero en la web
      const costs = {};
      COST_FIELDS.forEach(k => { if (k in rec) { costs[k] = rec[k]; delete rec[k]; } });
      const { id, ...data } = rec; data.actualizado = Date.now();
      const batch = fs.writeBatch(db);
      batch.set(ref, data);
      if (st.role === 'admin' && Object.keys(costs).length) batch.set(fs.doc(db, 'costos', ref.id), costs);
      const pub = toPublic(rec), cref = fs.doc(db, 'catalogo', ref.id);
      if (pub) batch.set(cref, pub); else batch.delete(cref);
      await batch.commit();
      return Object.assign({}, rec, costs);
    },
    async remove(col, id) {
      const { fs, db } = await getFb();
      if (col !== 'vehicles') return fs.deleteDoc(fs.doc(db, COL[col], id));
      const batch = fs.writeBatch(db);
      batch.delete(fs.doc(db, 'vehiculos', id));
      batch.delete(fs.doc(db, 'catalogo', id));
      if (st.role === 'admin') batch.delete(fs.doc(db, 'costos', id));
      await batch.commit();
    },

    getSettings() { return Promise.resolve(Object.assign({}, st.settings)); },
    async saveSettings(patch) {
      const { fs, db } = await getFb();
      await fs.setDoc(fs.doc(db, 'config', 'general'), patch, { merge: true });
      return Object.assign({}, st.settings, patch);
    },

    exportAll() {
      return Promise.resolve({
        exportedAt: new Date().toISOString(), settings: st.settings,
        vehicles: clone(view('vehicles')), reservations: clone(st.raw.reservations), receivables: clone(st.raw.receivables)
      });
    },
    /** Reconstruye el catálogo público desde `vehiculos` (y borra huérfanos). */
    async resyncCatalog() {
      const { fs, db } = await getFb();
      const batch = fs.writeBatch(db), keep = {};
      st.raw.vehicles.forEach(v => {
        const pub = toPublic(normalizeVehicle(v)), cref = fs.doc(db, 'catalogo', v.id);
        if (pub) { batch.set(cref, pub); keep[v.id] = 1; } else batch.delete(cref);
      });
      const snap = await fs.getDocs(fs.collection(db, 'catalogo'));
      snap.docs.forEach(d => { if (!keep[d.id]) batch.delete(d.ref); });
      await batch.commit();
    },
    newVehicle() { return blankVehicle(); },
    get backend() { return 'Firebase Firestore'; },
    get projectId() { return global.SMG_FIREBASE_CONFIG ? global.SMG_FIREBASE_CONFIG.projectId : '—'; }
  };

  global.SMGData = { Auth, Db, addDays, isoDate, uid };
})(window);
