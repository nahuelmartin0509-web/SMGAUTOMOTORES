/* SMG Automotores · Exportación de "Ficha de stock" a PDF (jsPDF + autoTable por CDN, se cargan solo al usar el botón). */
(function (global) {
  'use strict';
  const LIBS = [
    'https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js',
    'https://cdnjs.cloudflare.com/ajax/libs/jspdf-autotable/3.8.2/jspdf.plugin.autotable.min.js'
  ];
  const AGENCIA = {
    nombre: 'SMG AUTOMOTORES',
    direccion: 'Lavalle 2219 · San Miguel de Tucumán',
    contacto: 'WhatsApp: +54 9 381 584-7982',
    web: 'Instagram: @smg.automotores'
  };
  const RED = [222, 3, 13], BLACK = [13, 13, 15], GREY = [241, 241, 243];
  const nf = new Intl.NumberFormat('es-AR');

  function loadScript(src) {
    return new Promise((res, rej) => {
      const s = document.createElement('script');
      s.src = src; s.onload = res; s.onerror = () => rej(new Error('No se pudo cargar ' + src));
      document.head.appendChild(s);
    });
  }
  let libsP = null;
  function ensureLibs() {
    if (!libsP) {
      libsP = (async () => {
        if (!global.jspdf) await loadScript(LIBS[0]);
        if (!(global.jspdf.jsPDF.API && global.jspdf.jsPDF.API.autoTable)) await loadScript(LIBS[1]);
      })().catch(e => { libsP = null; throw e; });
    }
    return libsP;
  }
  /** Logo reducido a PNG (el original pesa ~500 KB). Si falla, el encabezado usa el nombre en texto. */
  function loadLogo() {
    return new Promise(resolve => {
      const img = new Image();
      img.onload = () => {
        try {
          const k = Math.min(1, 420 / img.naturalWidth), c = document.createElement('canvas');
          c.width = Math.round(img.naturalWidth * k); c.height = Math.round(img.naturalHeight * k);
          c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
          resolve({ data: c.toDataURL('image/png'), w: c.width, h: c.height });
        } catch (e) { resolve(null); }
      };
      img.onerror = () => resolve(null);
      img.src = 'LOGO.png';
    });
  }
  const titulo = v => [v.marca, v.modelo, v.version].filter(Boolean).join(' ').toUpperCase()
    .replace(/(\d)I\b/g, '$1i').replace(/(\d)X(\d)/g, '$1x$2');
  const precio = v => {
    const p = [];
    if (+v.listaUSD > 0) p.push('US$ ' + nf.format(Math.round(v.listaUSD)));
    if (+v.listaARS > 0) p.push('$ ' + nf.format(Math.round(v.listaARS)));
    return p.length ? p.join('\n') : 'Consultar';
  };
  const fechaHoy = () => { const d = new Date(); return [d.getDate(), d.getMonth() + 1, d.getFullYear()].map((n, i) => i < 2 ? String(n).padStart(2, '0') : n).join('/'); };

  async function stock(vehicles) {
    await ensureLibs();
    const logo = await loadLogo();
    const { jsPDF } = global.jspdf;
    const doc = new jsPDF({ unit: 'mm', format: 'a4' });
    const W = doc.internal.pageSize.getWidth(), H = doc.internal.pageSize.getHeight(), M = 14;

    const list = vehicles.slice().sort((a, b) => titulo(a).localeCompare(titulo(b), 'es'));
    const body = list.map((v, i) => [
      i + 1, titulo(v), String(v.anio || ''), (Number(v.km) > 0 ? nf.format(v.km) : '0') + ' km',
      v.color || '—', [v.etiqueta, v.extra].filter(Boolean).join(' · ') || '—', precio(v)
    ]);

    function header() {
      doc.setFillColor(...BLACK); doc.rect(0, 0, W, 34, 'F');
      doc.setFillColor(...RED); doc.rect(0, 34, W, 2, 'F');
      let textX = M;
      if (logo) {
        const h = 26, w = h * logo.w / logo.h;
        doc.addImage(logo.data, 'PNG', M, 4, w, h); textX = M + w + 6;
      } else {
        doc.setTextColor(255, 255, 255); doc.setFont('helvetica', 'bold'); doc.setFontSize(16);
        doc.text(AGENCIA.nombre, M, 20);
      }
      doc.setTextColor(255, 255, 255);
      doc.setFont('helvetica', 'bold'); doc.setFontSize(13); doc.text(AGENCIA.nombre, W - M, 12, { align: 'right' });
      doc.setFont('helvetica', 'normal'); doc.setFontSize(9);
      doc.text(AGENCIA.direccion, W - M, 18.5, { align: 'right' });
      doc.text(AGENCIA.contacto, W - M, 24, { align: 'right' });
      doc.text(AGENCIA.web, W - M, 29.5, { align: 'right' });
    }

    doc.autoTable({
      head: [['N°', 'Vehículo', 'Año', 'Kilometraje', 'Color', 'Detalle', 'Precio de lista']],
      body,
      startY: 66,
      margin: { top: 44, left: M, right: M, bottom: 18 },
      theme: 'grid',
      styles: { font: 'helvetica', fontSize: 9, cellPadding: 3, lineColor: [205, 205, 210], lineWidth: 0.2, textColor: [26, 26, 29], valign: 'middle' },
      headStyles: { fillColor: BLACK, textColor: 255, fontStyle: 'bold', halign: 'center' },
      alternateRowStyles: { fillColor: GREY },
      columnStyles: {
        0: { halign: 'center', cellWidth: 11 }, 1: { fontStyle: 'bold' },
        2: { halign: 'center', cellWidth: 14 }, 3: { halign: 'right', cellWidth: 26 },
        6: { halign: 'right', fontStyle: 'bold', cellWidth: 30 }
      },
      didDrawPage: data => {
        header();
        if (data.pageNumber === 1) {
          doc.setTextColor(...BLACK); doc.setFont('helvetica', 'bold'); doc.setFontSize(22);
          doc.text('STOCK DISPONIBLE', M, 50);
          doc.setFillColor(...RED); doc.rect(M, 52.5, 30, 1.2, 'F');
          doc.setFont('helvetica', 'normal'); doc.setFontSize(9.5); doc.setTextColor(107, 107, 114);
          doc.text(`Actualizado al ${fechaHoy()}  ·  ${list.length} ${list.length === 1 ? 'unidad' : 'unidades'}`, M, 59.5);
        }
      }
    });

    const pages = doc.getNumberOfPages();
    for (let p = 1; p <= pages; p++) {
      doc.setPage(p);
      doc.setDrawColor(205, 205, 210); doc.setLineWidth(0.2); doc.line(M, H - 13, W - M, H - 13);
      doc.setFont('helvetica', 'normal'); doc.setFontSize(8); doc.setTextColor(107, 107, 114);
      doc.text('Precios y disponibilidad sujetos a cambios sin previo aviso.', M, H - 8);
      doc.text(`Página ${p} de ${pages}`, W - M, H - 8, { align: 'right' });
    }
    const d = new Date(), iso = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
    doc.save(`SMG-Stock-Disponible-${iso}.pdf`);
  }

  global.SMGPdf = { stock };
})(window);
