/* ============================================================
   Rúbrica EA · núcleo de cálculo (sin dependencias)
   Se usa igual en el servidor (Apps Script) y en el navegador.
   ============================================================ */
var RubricaCore = (function () {
  var NIVELES = ['Tradicional', 'En transición', 'Integrado', 'Transformador'];
  // Puntaje máximo de cada categoría cuando se aplica un tope.
  var TOPE = { 1: 37.4, 2: 62.4, 3: 87.4, 4: 100 };

  function r1(x) { return Math.round(x * 10) / 10; }
  function suma(a) { var s = 0; for (var i = 0; i < a.length; i++) s += Number(a[i]); return s; }
  function promedio(a) { return a.length ? suma(a) / a.length : 0; }

  // Mediana; con un número par de valores toma el inferior ("ante la duda, el inferior").
  function mediana(vals) {
    var s = vals.map(Number).sort(function (x, y) { return x - y; });
    return s[Math.floor((s.length - 1) / 2)];
  }

  // Categoría 1–4 a partir de un puntaje ya redondeado a un decimal.
  function categoria(p) { return p < 37.5 ? 1 : p < 62.5 ? 2 : p < 87.5 ? 3 : 4; }
  function nombreNivel(n) { return NIVELES[n - 1] || ''; }

  // listas: niveles iniciales de cada evaluador. Marca los criterios con dispersión >= 2.
  function analizar(listas, n) {
    var disp = [], marcados = [];
    for (var k = 0; k < n; k++) {
      var col = listas.map(function (l) { return Number(l[k]); });
      var d = Math.max.apply(null, col) - Math.min.apply(null, col);
      disp.push(d);
      if (d >= 2) marcados.push(k);
    }
    return { disp: disp, marcados: marcados };
  }

  function medianas(listas, n) {
    var m = [];
    for (var k = 0; k < n; k++) m.push(mediana(listas.map(function (l) { return l[k]; })));
    return m;
  }

  // Visita: medianas C1–C6 -> puntaje sobre 100, con tope llave (C2).
  function puntajeVisita(med) {
    var s = suma(med);
    var sin = r1(s / 24 * 100);
    var tope = TOPE[Number(med[1])];
    var p = Math.min(sin, tope);
    return { suma: s, sinTope: sin, tope: p < sin ? 'llave' : '', puntaje: p, categoria: categoria(p) };
  }

  // Trimestre: visitas oficiales (medianas C1–C6) + experiencias que cuentan (medianas B1–B3).
  function puntajeTrimestre(o) {
    var vis = o.visitas || [], exps = o.experiencias || [];
    if (!vis.length) return null;
    var pa = promedio(vis.map(suma));
    var c2 = Math.floor(promedio(vis.map(function (m) { return Number(m[1]); })) + 1e-9);
    var nexp = exps.length;
    var pb = nexp ? promedio(exps.map(suma)) : 0;
    var sin = r1(pa / 24 * 70 + pb / 12 * 30);
    var cap = 100, topes = [];
    if (TOPE[c2] < 100) {
      topes.push({ tipo: 'llave', efecto: TOPE[c2] < sin });
      cap = TOPE[c2];
    }
    var exigible = Number(o.trimestre) >= 2 && Number(o.expectativa) > 0;
    if (exigible && nexp < Number(o.expectativa)) {
      topes.push({ tipo: 'expectativa', efecto: 62.4 < Math.min(sin, cap) });
      cap = Math.min(cap, 62.4);
    }
    var p = Math.min(sin, cap);
    var dims = {
      I: r1(promedio(vis.map(function (m) { return promedio([m[0], m[1], m[2]]); }))),
      II: r1(promedio(vis.map(function (m) { return Number(m[3]); }))),
      III: r1(promedio(vis.map(function (m) { return promedio([m[4], m[5]]); }))),
      IV: nexp ? r1(promedio(exps.map(function (m) { return promedio(m); }))) : null
    };
    return {
      parteA: r1(pa), parteB: r1(pb), experiencias: nexp, c2: c2,
      sinTope: sin, puntaje: r1(p), categoria: categoria(r1(p)), topes: topes,
      expectativaExigible: exigible, dims: dims
    };
  }

  return {
    NIVELES: NIVELES, TOPE: TOPE, r1: r1, suma: suma, promedio: promedio, mediana: mediana,
    categoria: categoria, nombreNivel: nombreNivel, analizar: analizar, medianas: medianas,
    puntajeVisita: puntajeVisita, puntajeTrimestre: puntajeTrimestre
  };
})();
if (typeof module !== 'undefined') module.exports = RubricaCore;

var REA_LOGO = "assets/logo.png";
var REA_LOGO_SYM = "assets/logo-simbolo.png";
/* ============================================================
   EA Conecta · Huella de clases · reglas (independientes del almacenamiento)
   Se usan igual en el servidor (Apps Script), en la demostración y, para los formatos, en el navegador.
   db: { config(), catalogo(), usuarios(), guardarUsuario(o, nuevo),
         huellas() [filas ligeras], huellaCompleta(h), huellasCompletas(), insertarHuella(o), actualizarHuella(o),
         archivoPropio(id, email) -> { n, s } | null, aPapelera(id), ahora(), hoy(), uuid() }
   ctx: { email, nombre, global, coord: ['Primaria' | 'Secundaria'] }
   ============================================================ */
var HU_SEDES = ['Primaria', 'Secundaria'];
var HU_ESTADOS = { completo: 'Desarrollado completamente', parcial: 'Desarrollado parcialmente', pendiente: 'Pendiente de continuación' };
var HU_MAX_ENLACES = 5;
// Formatos de evidencia aceptados (extensión -> tipo MIME con el que se guarda en Drive).
var HU_TIPOS = {
  pdf: 'application/pdf',
  doc: 'application/msword', docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xls: 'application/vnd.ms-excel', xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  ppt: 'application/vnd.ms-powerpoint', pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  odt: 'application/vnd.oasis.opendocument.text', ods: 'application/vnd.oasis.opendocument.spreadsheet', odp: 'application/vnd.oasis.opendocument.presentation',
  pages: 'application/vnd.apple.pages', numbers: 'application/vnd.apple.numbers', key: 'application/vnd.apple.keynote',
  txt: 'text/plain', rtf: 'application/rtf', csv: 'text/csv',
  jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', heic: 'image/heic', heif: 'image/heif', gif: 'image/gif', webp: 'image/webp',
  mov: 'video/quicktime', mp4: 'video/mp4', m4v: 'video/x-m4v',
  m4a: 'audio/mp4', mp3: 'audio/mpeg', wav: 'audio/wav', aac: 'audio/aac',
  usdz: 'model/vnd.usdz+zip', reality: 'application/octet-stream', glb: 'model/gltf-binary',
  html: 'text/html', htm: 'text/html', epub: 'application/epub+zip', zip: 'application/zip'
};
// Catálogo con el que se instala la hoja. Se edita en la pestaña Catálogo, sin tocar código.
var HU_CATALOGO_INICIAL = [
  ['curso', 'Primaria', '3.º EGB'], ['curso', 'Primaria', '4.º EGB'], ['curso', 'Primaria', '5.º EGB'], ['curso', 'Primaria', '6.º EGB'], ['curso', 'Primaria', '7.º EGB'],
  ['curso', 'Secundaria', '8.º EGB'], ['curso', 'Secundaria', '9.º EGB'], ['curso', 'Secundaria', '10.º EGB'],
  ['curso', 'Secundaria', '1.º BGU'], ['curso', 'Secundaria', '2.º BGU'], ['curso', 'Secundaria', '3.º BGU'],
  ['paralelo', 'Ambas', 'A'], ['paralelo', 'Ambas', 'B'], ['paralelo', 'Ambas', 'C'],
  ['asignatura', 'Ambas', 'Lengua y Literatura'], ['asignatura', 'Ambas', 'Matemática'], ['asignatura', 'Ambas', 'Ciencias Naturales'],
  ['asignatura', 'Ambas', 'Estudios Sociales'], ['asignatura', 'Ambas', 'Inglés'], ['asignatura', 'Ambas', 'Educación Cultural y Artística'],
  ['asignatura', 'Ambas', 'Educación Física'],
  ['asignatura', 'Secundaria', 'Física'], ['asignatura', 'Secundaria', 'Química'], ['asignatura', 'Secundaria', 'Biología'],
  ['asignatura', 'Secundaria', 'Historia'], ['asignatura', 'Secundaria', 'Filosofía'], ['asignatura', 'Secundaria', 'Educación para la Ciudadanía'],
  ['asignatura', 'Secundaria', 'Emprendimiento y Gestión'],
  ['recurso', 'Ambas', 'iPad'], ['recurso', 'Ambas', 'Aula inmersiva'], ['recurso', 'Ambas', 'Metaverso'], ['recurso', 'Ambas', 'Podcast'],
  ['recurso', 'Ambas', 'MAXHUB'], ['recurso', 'Ambas', 'Meta Quest'], ['recurso', 'Ambas', 'Laboratorio'], ['recurso', 'Ambas', 'Canva'],
  ['recurso', 'Ambas', 'Keynote']
];

function huExtension(nombre) { var m = String(nombre || '').toLowerCase().match(/\.([a-z0-9]{1,14})$/); return m ? m[1] : ''; }

// Filas de la pestaña Catálogo -> listas por sede. "Ambas" (o vacío) vale para las dos sedes.
function huParsearCatalogo(filas) {
  var c = { sedes: HU_SEDES.slice(), cursos: {}, paralelos: {}, asignaturas: {}, recursos: [] };
  HU_SEDES.forEach(function (s) { c.cursos[s] = []; c.paralelos[s] = []; c.asignaturas[s] = []; });
  var destino = { curso: 'cursos', paralelo: 'paralelos', asignatura: 'asignaturas' };
  (filas || []).forEach(function (f) {
    if (String(f.activo == null ? '' : f.activo).trim().toLowerCase() === 'no') return;
    var lista = String(f.lista || '').trim().toLowerCase(), valor = String(f.valor == null ? '' : f.valor).trim();
    if (!valor) return;
    if (lista === 'recurso') { if (c.recursos.indexOf(valor) < 0) c.recursos.push(valor); return; }
    if (!destino[lista]) return;
    var sede = String(f.sede || '').trim();
    (HU_SEDES.indexOf(sede) >= 0 ? [sede] : HU_SEDES).forEach(function (s) {
      if (c[destino[lista]][s].indexOf(valor) < 0) c[destino[lista]][s].push(valor);
    });
  });
  return c;
}

function crearServicioHuella(db) {
  function err(m) { throw new Error(m); }
  function txt(v, max) { v = v == null ? '' : String(v).replace(/\r\n?/g, '\n').trim(); return v.length > max ? v.slice(0, max) : v; }
  function low(v) { return String(v == null ? '' : v).trim().toLowerCase(); }
  function partes(s) { return String(s == null ? '' : s).split(',').map(function (x) { return x.trim(); }).filter(Boolean); }
  function json(s, d) { try { return s ? JSON.parse(s) : d; } catch (e) { return d; } }
  function unicos(a) { var o = []; a.forEach(function (x) { if (o.indexOf(x) < 0) o.push(x); }); return o; }
  function vivas() { return db.huellas().filter(function (h) { return h.id !== '' && h.id != null && !h.eliminado; }); }
  function orden(a, b) { var x = String(b.fecha) + String(b.creado), y = String(a.fecha) + String(a.creado); return x < y ? -1 : x > y ? 1 : 0; }
  function ligera(h) {
    return {
      id: String(h.id), fecha: String(h.fecha).slice(0, 10), sede: String(h.sede || ''), curso: String(h.curso || ''), paralelos: partes(h.paralelos),
      asignatura: String(h.asignatura || ''), tema: String(h.tema || ''), estado: String(h.estado || ''), pendiente: String(h.pendiente || ''),
      recursos: partes(h.recursos), nEvid: Number(h.n_evidencias) || 0, docente: String(h.docente || ''), email: String(h.email || ''),
      creado: String(h.creado || ''), editado: String(h.actualizado || '')
    };
  }
  function claves(h) { return partes(h.paralelos).map(function (p) { return h.curso + '|' + p; }); }
  function paresDe(lista) { var m = {}; lista.forEach(function (h) { claves(h).forEach(function (k) { m[k] = 1; }); }); return m; }
  function comparte(h, pares) { return claves(h).some(function (k) { return pares[k] === 1; }); }
  function propias(email) { return vivas().filter(function (h) { return low(h.email) === email; }); }
  // Quién ve una huella: quien la registró, Departamento y Dirección, coordinación de su sede
  // y los docentes que también registran en ese curso y paralelo.
  function puedeVer(ctx, h) {
    if (low(h.email) === ctx.email) return true;
    if (ctx.global) return true;
    if ((ctx.coord || []).indexOf(String(h.sede)) >= 0) return true;
    return comparte(h, paresDe(propias(ctx.email)));
  }
  function puedeRegistros(ctx) { return !!(ctx.global || (ctx.coord && ctx.coord.length)); }
  function porId(id) { id = String(id || ''); var r = vivas().filter(function (h) { return String(h.id) === id; }); return r[0] || null; }
  function sedeDeCurso(c, curso) { for (var i = 0; i < HU_SEDES.length; i++) if ((c.cursos[HU_SEDES[i]] || []).indexOf(curso) >= 0) return HU_SEDES[i]; return ''; }
  function usuario(email) { return db.usuarios().filter(function (u) { return low(u.email) === email; })[0] || null; }
  function completaDe(h) {
    var full = db.huellaCompleta(h);
    if (!full || String(full.id) !== String(h.id)) err('La huella cambió mientras se abría. Intenta de nuevo.');
    return full;
  }
  function publica(full, ctx) {
    var o = ligera(full);
    o.contenidos = String(full.contenidos || ''); o.actividades = String(full.actividades || '');
    o.recursoOtro = String(full.recurso_otro || ''); o.metodologia = String(full.metodologia || '');
    o.evidencias = json(full.evidencias, []);
    o.propia = low(full.email) === ctx.email;
    return o;
  }

  /* ---------------- evidencias ---------------- */
  function evidencias(ctx, lista, previas) {
    var cf = db.config(), arch = [], enl = [];
    (Array.isArray(lista) ? lista : []).forEach(function (e) {
      if (!e || typeof e !== 'object') return;
      if (e.t === 'e') {
        var u = txt(e.u, 1000);
        if (!/^https:\/\/[^\s<>"']+$/i.test(u)) err('Cada enlace debe empezar con https://');
        if (enl.some(function (x) { return x.u === u; })) return;
        var dom = (u.match(/^https:\/\/([^\/?#]+)/i) || [])[1] || 'Enlace';
        enl.push({ t: 'e', u: u, n: txt(e.n, 120) || dom.replace(/^www\./, '') });
      } else if (e.t === 'a') {
        var id = txt(e.id, 120);
        if (!/^[\w-]{6,}$/.test(id)) err('Uno de los archivos no es válido. Vuelve a adjuntarlo.');
        if (arch.some(function (x) { return x.id === id; })) return;
        var previo = previas.filter(function (x) { return x.t === 'a' && x.id === id; })[0];
        if (previo) { arch.push(previo); return; }
        var meta = db.archivoPropio(id, ctx.email);
        if (!meta) err('Uno de los archivos no se subió desde tu cuenta o ya no existe. Vuelve a adjuntarlo.');
        arch.push({ t: 'a', id: id, n: txt(meta.n || e.n, 200), s: Number(meta.s) || 0, x: huExtension(meta.n || e.n) });
      }
    });
    if (arch.length > cf.evidMaxArchivos) err('Puedes adjuntar hasta ' + cf.evidMaxArchivos + ' archivos por huella.');
    if (enl.length > HU_MAX_ENLACES) err('Puedes agregar hasta ' + HU_MAX_ENLACES + ' enlaces por huella.');
    return arch.concat(enl);
  }

  var S = {};

  S.inicio = function (ctx) {
    var cf = db.config(), u = usuario(ctx.email), todas = vivas();
    var mias = todas.filter(function (h) { return low(h.email) === ctx.email; }).sort(orden);
    var pares = paresDe(mias);
    var otras = todas.filter(function (h) { return low(h.email) !== ctx.email && comparte(h, pares); }).sort(orden).slice(0, 300);
    return {
      usuario: { email: ctx.email, nombre: ctx.nombre || (u && String(u.nombre)) || '', sede: u && HU_SEDES.indexOf(String(u.sede)) >= 0 ? String(u.sede) : '' },
      permisos: { global: !!ctx.global, coord: (ctx.coord || []).slice(), registros: puedeRegistros(ctx) },
      anio: cf.anio, hoy: db.hoy(), catalogo: db.catalogo(), estados: HU_ESTADOS,
      limites: { maxMb: cf.evidMaxMb, maxArchivos: cf.evidMaxArchivos, maxEnlaces: HU_MAX_ENLACES },
      mias: mias.map(ligera), pares: otras.map(ligera)
    };
  };

  S.sede = function (ctx, p) {
    var sede = String(p && p.sede || '');
    if (HU_SEDES.indexOf(sede) < 0) err('Elige Primaria o Secundaria.');
    var u = usuario(ctx.email);
    if (u) { u.sede = sede; if (ctx.nombre) u.nombre = ctx.nombre; u.actualizado = db.ahora(); db.guardarUsuario(u, false); }
    else db.guardarUsuario({ email: ctx.email, nombre: ctx.nombre || '', sede: sede, actualizado: db.ahora() }, true);
    return { sede: sede };
  };

  S.guardar = function (ctx, p) {
    p = p || {};
    var c = db.catalogo(), previa = null, fullPrevia = null;
    if (p.id) {
      previa = porId(p.id);
      if (!previa) err('No encontramos esa huella. Quizá fue eliminada.');
      if (low(previa.email) !== ctx.email) err('Solo quien registró la huella puede editarla.');
      fullPrevia = completaDe(previa);
    }
    var fecha = txt(p.fecha, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(fecha)) err('Elige la fecha de la clase.');
    if (fecha > db.hoy()) err('La fecha de la clase no puede ser futura.');
    if (fecha < '2020-01-01') err('La fecha de la clase no es válida.');
    var curso = txt(p.curso, 40);
    if (!curso) err('Elige el curso.');
    var sede = sedeDeCurso(c, curso);
    if (!sede) { if (previa && previa.curso === curso) sede = String(previa.sede); else err('Elige el curso de la lista.'); }
    var permitidos = c.paralelos[sede] || [], antes = previa ? partes(previa.paralelos) : [];
    var pars = unicos((Array.isArray(p.paralelos) ? p.paralelos : []).map(function (x) { return txt(x, 12); }).filter(Boolean));
    if (!pars.length) err('Marca al menos un paralelo.');
    pars.forEach(function (x) { if (permitidos.indexOf(x) < 0 && antes.indexOf(x) < 0) err('El paralelo ' + x + ' no está en la lista de ' + sede + '.'); });
    pars.sort(function (a, b) { var i = permitidos.indexOf(a), j = permitidos.indexOf(b); return (i < 0 ? 99 : i) - (j < 0 ? 99 : j); });
    var asignatura = txt(p.asignatura, 80);
    if (asignatura.length < 2) err('Elige la asignatura.');
    if ((c.asignaturas[sede] || []).indexOf(asignatura) < 0 && !(previa && previa.asignatura === asignatura) && !p.asignaturaOtra) err('Elige la asignatura de la lista o escribe la tuya en «Otra».');
    var tema = txt(p.tema, 160);
    if (tema.length < 3) err('Escribe el tema de la clase.');
    var contenidos = txt(p.contenidos, 3000);
    if (contenidos.length < 3) err('Escribe los contenidos desarrollados.');
    var actividades = txt(p.actividades, 3000);
    if (actividades.length < 3) err('Escribe qué actividades desarrollaron los estudiantes.');
    var recAntes = previa ? partes(previa.recursos) : [];
    var recursos = unicos((Array.isArray(p.recursos) ? p.recursos : []).map(function (x) { return txt(x, 60); }).filter(Boolean));
    recursos.forEach(function (r) { if (c.recursos.indexOf(r) < 0 && recAntes.indexOf(r) < 0) err('El recurso «' + r + '» no está en la lista. Escríbelo en «Otro».'); });
    var recursoOtro = txt(p.recursoOtro, 120).replace(/,/g, ' ');
    var metodologia = txt(p.metodologia, 1000);
    var estado = String(p.estado || '');
    if (!HU_ESTADOS[estado]) err('Elige el estado del contenido.');
    var pendiente = estado === 'completo' ? '' : txt(p.pendiente, 600);
    if (estado !== 'completo' && pendiente.length < 3) err('Escribe qué quedó pendiente para la próxima clase.');
    var previasEv = fullPrevia ? json(fullPrevia.evidencias, []) : [];
    var ev = evidencias(ctx, p.evidencias, previasEv);

    var obj = fullPrevia || { id: db.uuid(), creado: db.ahora(), email: ctx.email, actualizado: '', eliminado: '' };
    obj.docente = ctx.nombre || obj.docente || ctx.email;
    obj.sede = sede; obj.fecha = fecha; obj.curso = curso; obj.paralelos = pars.join(', '); obj.asignatura = asignatura;
    obj.tema = tema; obj.recursos = recursos.join(', '); obj.estado = estado; obj.pendiente = pendiente; obj.n_evidencias = ev.length;
    obj.contenidos = contenidos; obj.actividades = actividades; obj.recurso_otro = recursoOtro; obj.metodologia = metodologia;
    obj.evidencias = JSON.stringify(ev);
    if (fullPrevia) { obj.actualizado = db.ahora(); db.actualizarHuella(obj); } else db.insertarHuella(obj);
    // Al editar, los archivos que se quitaron van a la papelera de Drive.
    previasEv.forEach(function (e) {
      if (e.t === 'a' && !ev.some(function (x) { return x.t === 'a' && x.id === e.id; })) db.aPapelera(e.id);
    });
    var guardada = porId(obj.id);
    return { huella: ligera(guardada), detalle: publica(completaDe(guardada), ctx) };
  };

  S.eliminar = function (ctx, p) {
    var h = porId(p && p.id);
    if (!h) err('No encontramos esa huella. Quizá ya fue eliminada.');
    if (low(h.email) !== ctx.email) err('Solo quien registró la huella puede eliminarla.');
    var full = completaDe(h);
    full.eliminado = db.ahora();
    db.actualizarHuella(full);
    json(full.evidencias, []).forEach(function (e) { if (e.t === 'a') db.aPapelera(e.id); });
    return { ok: true, id: String(h.id) };
  };

  S.detalle = function (ctx, p) {
    var h = porId(p && p.id);
    if (!h) err('No encontramos esa huella. Quizá fue eliminada.');
    if (!puedeVer(ctx, h)) err('No tienes acceso a esta huella.');
    return publica(completaDe(h), ctx);
  };

  // Un archivo de evidencia se abre solo si quien lo pide puede ver la huella.
  S.evidencia = function (ctx, p) {
    var d = S.detalle(ctx, { id: p && p.huella });
    var e = d.evidencias.filter(function (x) { return x.t === 'a' && x.id === String(p.archivo || ''); })[0];
    if (!e) err('Ese archivo ya no está en la huella.');
    return { id: e.id, n: e.n };
  };

  /* ---------------- registros (coordinación, Departamento y Dirección) ---------------- */
  function filtrar(ctx, p) {
    if (!puedeRegistros(ctx)) err('Los registros de huellas son para coordinación, el Departamento y Dirección.');
    p = p || {};
    var sedes = ctx.global ? HU_SEDES.slice() : ctx.coord.slice();
    if (p.sede) { if (sedes.indexOf(p.sede) < 0) err('No tienes acceso a las huellas de esa sede.'); sedes = [p.sede]; }
    var q = low(txt(p.q, 80));
    var desde = /^\d{4}-\d{2}-\d{2}$/.test(p.desde || '') ? p.desde : '', hasta = /^\d{4}-\d{2}-\d{2}$/.test(p.hasta || '') ? p.hasta : '';
    return vivas().filter(function (h) {
      if (sedes.indexOf(String(h.sede)) < 0) return false;
      if (p.curso && h.curso !== p.curso) return false;
      if (p.asignatura && h.asignatura !== p.asignatura) return false;
      if (p.estado && h.estado !== p.estado) return false;
      var f = String(h.fecha).slice(0, 10);
      if (desde && f < desde) return false;
      if (hasta && f > hasta) return false;
      if (q && [h.docente, h.email, h.tema, h.curso, h.asignatura, h.paralelos].join(' ').toLowerCase().indexOf(q) < 0) return false;
      return true;
    }).sort(orden);
  }
  S.lista = function (ctx, p) {
    var l = filtrar(ctx, p), docentes = {}, pend = 0, conEv = 0;
    l.forEach(function (h) { docentes[low(h.email)] = 1; if (h.estado !== 'completo') pend++; if (Number(h.n_evidencias) > 0) conEv++; });
    return { total: l.length, docentes: Object.keys(docentes).length, pendientes: pend, conEvidencia: conEv, limite: 500, filas: l.slice(0, 500).map(ligera) };
  };
  S.exportar = function (ctx, p) {
    var l = filtrar(ctx, p).slice(0, 5000), ids = {};
    l.forEach(function (h) { ids[String(h.id)] = 1; });
    var filas = db.huellasCompletas().filter(function (h) { return ids[String(h.id)] && !h.eliminado; }).sort(orden).map(function (f) {
      var o = publica(f, ctx); delete o.propia; return o;
    });
    return { total: l.length, filas: filas };
  };

  return S;
}
if (typeof module !== 'undefined') module.exports = { crearServicioHuella: crearServicioHuella, huParsearCatalogo: huParsearCatalogo, huExtension: huExtension, HU_TIPOS: HU_TIPOS, HU_CATALOGO_INICIAL: HU_CATALOGO_INICIAL, HU_SEDES: HU_SEDES };

/* EA Conecta · Huella de clases (cliente). El portal lo conecta con window.HU_MODULO(EA). */
window.HU_MODULO = function (EA) {
  'use strict';
  var S = EA.S, esc = EA.esc, $ = EA.$;
  var ESTADO_CORTO = { completo: 'Completo', parcial: 'Parcial', pendiente: 'Por continuar' };
  var ACCEPT = Object.keys(HU_TIPOS).map(function (x) { return '.' + x; }).join(',') + ',image/*,video/*,audio/*';
  var svg = function (d) { return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + d + '</svg>'; };
  var ICO = {
    huella: svg('<rect x="5" y="4" width="14" height="17" rx="2"/><path d="M9 3h6v3H9z"/><path d="m9 13 2 2 4-4"/>'),
    recurso: svg('<path d="M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9z"/><path d="M19 17v4M17 19h4"/>'),
    trabajos: svg('<rect x="3" y="5" width="18" height="14" rx="2"/><circle cx="9" cy="10" r="2"/><path d="m21 16-5-5-9 8"/>'),
    evaluacion: svg('<path d="M5 20V11M12 20V4M19 20v-7"/>'),
    registros: svg('<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M3 10h18M9 10v10"/>'),
    sede: svg('<path d="M3 21h18M5 21V9l7-5 7 5v12"/><path d="M10 21v-5h4v5"/>'),
    subir: svg('<path d="M12 16V4m0 0-4 4m4-4 4 4"/><path d="M4 15v4a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-4"/>'),
    enlace: svg('<path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1"/><path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"/>'),
    clip: svg('<path d="m21 11-8.5 8.5a5 5 0 0 1-7-7L14 4a3.5 3.5 0 0 1 5 5l-8.5 8.5a2 2 0 0 1-3-3L15 7"/>')
  };
  var H;
  function reiniciar() {
    H = { lista: { q: '', curso: '', est: '' }, cursosQ: '', form: null, formKey: '', recuperado: false, subidas: [], seq: 0, cola: Promise.resolve(),
      det: {}, origen: 'huMias', confirmar: false, guardando: false, errores: [], recien: '',
      reg: { per: '30', sede: '', curso: '', asig: '', est: '', q: '' }, regRes: null, regPide: 0, regErr: '' };
  }
  reiniciar();

  /* ---------------- utilidades ---------------- */
  function U() { return S.hu.usuario; }
  function cat() { return S.hu.catalogo; }
  function primerNombre() { var n = String(U().nombre || '').trim(); return n ? n.split(/\s+/)[0] : String(U().email).split('@')[0]; }
  function fTam(b) { b = Number(b) || 0; if (b >= 1048576) return String(Math.round(b / 1048576 * 10) / 10).replace('.', ',') + ' MB'; return Math.max(1, Math.round(b / 1024)) + ' KB'; }
  function iso(d) { return d.getFullYear() + '-' + ('0' + (d.getMonth() + 1)).slice(-2) + '-' + ('0' + d.getDate()).slice(-2); }
  function lunes() { var d = new Date(); d.setDate(d.getDate() - (d.getDay() + 6) % 7); return iso(d); }
  function chipEstado(e) { return '<span class="chip hu-' + esc(e) + '"><span class="dot"></span>' + esc(ESTADO_CORTO[e] || e) + '</span>'; }
  function solapan(a, b) { return (a.paralelos || []).some(function (p) { return (b.paralelos || []).indexOf(p) >= 0; }); }
  function sedeDe(curso) { var c = cat(); for (var i = 0; i < HU_SEDES.length; i++) if ((c.cursos[HU_SEDES[i]] || []).indexOf(curso) >= 0) return HU_SEDES[i]; return ''; }
  function cursoTxt(h) { return h.curso + (h.paralelos && h.paralelos.length ? ' ' + h.paralelos.join(', ') : ''); }
  // Lo que quedó pendiente y no se retomó en una huella posterior del mismo curso y asignatura.
  function porContinuar() {
    var mias = S.hu.mias;
    return mias.filter(function (h) {
      if (h.estado === 'completo') return false;
      return !mias.some(function (k) { return k !== h && k.curso === h.curso && k.asignatura === h.asignatura && solapan(k, h) && (k.fecha + k.creado) > (h.fecha + h.creado); });
    });
  }
  function opcion(v, t, sel) { return '<option value="' + esc(v) + '"' + (String(sel) === String(v) ? ' selected' : '') + '>' + esc(t) + '</option>'; }
  function tabs(actual) {
    var items = [['huella', 'Nuevo registro', null, 'Nuevo'], ['huMias', 'Mis huellas', S.hu.mias.length, 'Mías'], ['huCursos', 'Huellas de mis cursos', S.hu.pares.length, 'Mis cursos']];
    return '<nav class="tabs" aria-label="Huella de clases">' + items.map(function (t) {
      return '<button type="button" data-go="' + t[0] + '"' + (t[0] === actual ? ' aria-current="page"' : '') + ' aria-label="' + t[1] + '"><span class="largo">' + t[1] + '</span><span class="corto" aria-hidden="true">' + t[3] + '</span>' +
        (t[2] != null ? ' <span class="n">' + t[2] + '</span>' : '') + '</button>';
    }).join('') + '</nav>';
  }
  function itemHuella(h, conDocente) {
    return '<button class="hitem" type="button" data-go="huellaVer" data-id="' + esc(h.id) + '">' +
      '<div class="when">' + EA.fFecha(h.fecha) + '<span>' + esc(String(h.fecha).slice(0, 4)) + '</span></div>' +
      '<div class="main"><b>' + esc(h.tema) + '</b><span>' + esc(cursoTxt(h) + ' · ' + h.asignatura + (conDocente ? ' · ' + h.docente : '')) + '</span></div>' +
      '<div class="side">' + chipEstado(h.estado) + (h.nEvid ? '<span class="evn">' + ICO.clip + h.nEvid + '</span>' : '') + '</div></button>';
  }

  /* ---------------- sede ---------------- */
  function vSede() {
    var actual = U().sede, c = cat();
    var h = EA.tb('Paso 2 de 3', 'Elige tu sede', actual ? '<button class="btn ghost" data-go="inicio">Volver</button>' : '',
      'Así te mostramos tus cursos y asignaturas. Puedes cambiarla cuando quieras desde la barra superior.');
    h += '<div class="sedes">' + HU_SEDES.map(function (s, i) {
      var cs = c.cursos[s] || [];
      return '<button class="sede-op" type="button" data-hu="sede" data-v="' + s + '" aria-pressed="' + (actual === s) + '">' +
        '<span class="ico ' + (i ? 'c2' : 'c1') + '">' + ICO.sede + '</span><b>' + s + '</b>' +
        '<span>' + (cs.length ? esc(cs[0]) + ' a ' + esc(cs[cs.length - 1]) : '') + '</span></button>';
    }).join('') + '</div>';
    $('#view').innerHTML = h;
  }

  /* ---------------- inicio ---------------- */
  function tarjeta(color, ico, titulo, texto, extra, acciones) {
    return '<section class="op"><span class="ico ' + color + '">' + ico + '</span><h2>' + titulo + '</h2><p>' + texto + '</p>' + (extra || '') + '<div class="acts">' + acciones + '</div></section>';
  }
  function pronto(color, ico, titulo, texto) {
    return '<section class="op pronto" aria-disabled="true"><span class="ico ' + color + '">' + ico + '</span><h2>' + titulo + '</h2><p>' + texto + '</p><div class="acts"><span class="chip">Próximamente</span></div></section>';
  }
  function vInicio() {
    var semana = S.hu.mias.filter(function (h) { return h.fecha >= lunes(); }).length, pend = porContinuar().length;
    var h = EA.tb('Portal de Recursos Institucionales · ' + esc(U().sede), 'Hola, ' + esc(primerNombre()), '', '¿Qué vas a hacer hoy?');
    h += '<div class="opciones">' +
      tarjeta('c1', ICO.huella, 'Huella de clases', 'Registra los contenidos que impartiste, lo que hicieron tus estudiantes y la evidencia de la clase.',
        '<p class="stat"><b>' + semana + '</b> ' + (semana === 1 ? 'registro' : 'registros') + ' esta semana' + (pend ? ' · <b>' + pend + '</b> por continuar' : '') + '</p>',
        '<button class="btn" type="button" data-go="huella">Registrar huella</button><button class="btn ghost" type="button" data-go="huMias">Mis huellas</button>') +
      pronto('c2', ICO.recurso, 'Pedir un recurso', 'Plantillas para podcast, aula inmersiva y metaverso, o recursos digitales para tu clase.') +
      pronto('c3', ICO.trabajos, 'Trabajos de mis estudiantes', 'Sube los trabajos que crearon tus estudiantes.') +
      '</div>';
    var extra = [], p = S.hu.permisos;
    if (p.registros) {
      var alcance = p.global ? 'Primaria y Secundaria' : p.coord.join(' y ');
      extra.push(tarjeta('c4', ICO.registros, 'Registros de huellas', 'Consulta las huellas de clase de ' + esc(alcance) + ', con filtros y exportación a Excel.', '',
        '<button class="btn ghost" type="button" data-go="huRegistros">Abrir registros</button>'));
    }
    if (S.boot) {
      extra.push(tarjeta('c5', ICO.evaluacion, 'Evaluación de clases', 'Visitas, registros de evaluación y resultados de la rúbrica.', '',
        '<button class="btn ghost" type="button" data-go="' + (S.boot.usuario.role === 'evaluador' ? 'visitas' : 'registros') + '">Abrir evaluación</button>'));
    }
    if (extra.length) h += '<div class="opciones dos">' + extra.join('') + '</div>';
    $('#view').innerHTML = h;
  }

  /* ---------------- formulario ---------------- */
  function claveBorrador(id) { return 'hu_borrador:' + U().email + (id ? ':' + id : ''); }
  function nuevoForm() {
    return { id: '', fecha: EA.hoy(), curso: '', paralelos: [], asignatura: '', otraAsig: false, asigTexto: '', tema: '', contenidos: '', actividades: '',
      recursos: [], otroOn: false, recursoOtro: '', metodologia: '', estado: '', pendiente: '', evidencias: [], guardadas: [] };
  }
  function conContenido(f) { return !!(f && (f.curso || f.tema || f.contenidos || f.actividades || (f.evidencias || []).length)); }
  function desdeDetalle(d) {
    var f = nuevoForm(), sede = sedeDe(d.curso), lista = (cat().asignaturas[sede || U().sede] || []);
    f.id = d.id; f.fecha = d.fecha; f.curso = d.curso; f.paralelos = d.paralelos.slice();
    if (lista.indexOf(d.asignatura) >= 0) f.asignatura = d.asignatura; else { f.otraAsig = true; f.asigTexto = d.asignatura; }
    f.tema = d.tema; f.contenidos = d.contenidos; f.actividades = d.actividades; f.recursos = d.recursos.slice();
    f.otroOn = !!d.recursoOtro; f.recursoOtro = d.recursoOtro; f.metodologia = d.metodologia; f.estado = d.estado; f.pendiente = d.pendiente;
    f.evidencias = d.evidencias.slice(); f.guardadas = d.evidencias.filter(function (e) { return e.t === 'a'; }).map(function (e) { return e.id; });
    return f;
  }
  var borradorT;
  // Después de un intento fallido, la lista de lo que falta se actualiza mientras la persona corrige.
  function actualizarErrores() {
    if (!H.errores.length || !H.form) return;
    H.errores = validar(H.form);
    var box = $('#huErr');
    if (!box) return;
    if (!H.errores.length) { box.remove(); return; }
    box.querySelector('ul').innerHTML = H.errores.map(function (e) { return '<li>' + esc(e) + '</li>'; }).join('');
  }
  function guardarBorrador(f) {
    f = f || H.form; if (!f) return;
    if (f === H.form) actualizarErrores();
    clearTimeout(borradorT);
    borradorT = setTimeout(function () { EA.store(claveBorrador(f.id), f); }, 300);
  }
  function prepararForm() {
    var clave = S.view + ':' + (S.id || '');
    if (H.formKey === clave && H.form) return true;
    H.errores = []; H.recuperado = false; H.guardando = false;
    if (S.view === 'huEditar') {
      var d = H.det[S.id];
      if (!d) {
        EA.loading('Abriendo la huella…');
        var id = S.id;
        EA.api('huDetalle', { id: id }).then(function (x) { H.det[id] = x; if (S.view === 'huEditar' && S.id === id) vForm(); })
          .catch(function (e) { if (S.view === 'huEditar') $('#view').innerHTML = '<div class="err">' + esc(e.message) + '</div>'; });
        return false;
      }
      if (!d.propia) { EA.go('huellaVer', S.id); return false; }
      var b = EA.load(claveBorrador(d.id));
      H.form = b && b.id === d.id ? b : desdeDetalle(d);
      H.recuperado = !!(b && b.id === d.id);
    } else {
      var g = EA.load(claveBorrador(''));
      H.form = conContenido(g) ? g : nuevoForm();
      H.recuperado = conContenido(g);
    }
    H.formKey = clave;
    return true;
  }
  function opcionesCurso(sel) {
    var c = cat(), mia = U().sede, otra = HU_SEDES.filter(function (s) { return s !== mia; })[0];
    var h = '<option value="">Elige el curso</option>';
    h += '<optgroup label="' + esc(mia) + '">' + (c.cursos[mia] || []).map(function (x) { return opcion(x, x, sel); }).join('') + '</optgroup>';
    if (otra && (c.cursos[otra] || []).length) h += '<optgroup label="' + esc(otra) + ' (otra sede)">' + c.cursos[otra].map(function (x) { return opcion(x, x, sel); }).join('') + '</optgroup>';
    if (sel && !sedeDe(sel)) h += opcion(sel, sel, sel);
    return h;
  }
  function pendienteAnterior() {
    var f = H.form, asig = f.otraAsig ? f.asigTexto : f.asignatura;
    if (!f.curso || !asig) return '';
    var prev = S.hu.mias.filter(function (h) { return h.id !== f.id && h.curso === f.curso && h.asignatura === asig && (!f.paralelos.length || solapan(h, f)); })[0];
    if (!prev || prev.estado === 'completo') return '';
    return '<div class="callout"><span class="strip amber">Quedó pendiente</span><p><b>' + esc(EA.fFechaLarga(prev.fecha)) + ' · ' + esc(prev.tema) + '.</b> ' + esc(prev.pendiente) + '</p></div>';
  }
  function listaEvidencias() {
    var f = H.form, out = '';
    f.evidencias.forEach(function (e, i) {
      out += '<div class="ev-item"><span class="tipo">' + (e.t === 'e' ? ICO.enlace : esc(String(e.x || huExtension(e.n) || 'arch').slice(0, 4))) + '</span>' +
        '<div class="mid"><span class="nom">' + esc(e.n) + '</span><span class="ev-sub">' + (e.t === 'e' ? esc(e.u) : fTam(e.s) + ' · listo') + '</span></div>' +
        '<button type="button" class="x" data-hu="quitarEv" data-i="' + i + '" aria-label="Quitar ' + esc(e.n) + '">×</button></div>';
    });
    H.subidas.filter(function (s) { return s.form === f; }).forEach(function (s) {
      var mal = s.estado === 'error';
      out += '<div class="ev-item' + (mal ? ' mal' : '') + '" data-sub="' + s.k + '"><span class="tipo">' + esc(s.x.slice(0, 4)) + '</span>' +
        '<div class="mid"><span class="nom">' + esc(s.n) + '</span><span class="ev-sub">' + (mal ? esc(s.msg) : 'Subiendo… <b class="pct">' + s.pct + '%</b> de ' + fTam(s.s)) + '</span>' +
        (mal ? '' : '<div class="bar"><i style="width:' + s.pct + '%"></i></div>') + '</div>' +
        '<div class="row" style="gap:4px;flex-wrap:nowrap">' + (mal ? '<button type="button" class="btn ghost sm" data-hu="reintentar" data-k="' + s.k + '">Reintentar</button>' : '') +
        '<button type="button" class="x" data-hu="quitarSubida" data-k="' + s.k + '" aria-label="Cancelar ' + esc(s.n) + '">×</button></div></div>';
    });
    return out;
  }
  function subiendo(f) { return H.subidas.filter(function (s) { return s.form === (f || H.form) && s.estado === 'subiendo'; }).length; }
  function textoEstado() {
    var n = subiendo();
    if (n) return 'Subiendo ' + n + (n === 1 ? ' archivo' : ' archivos') + '… Puedes seguir escribiendo.';
    return 'Mientras escribes, se guarda un borrador en este dispositivo.';
  }
  function pintarEvs() { var el = $('#huEvs'); if (el) el.innerHTML = listaEvidencias(); var t = $('#huEstadoForm'); if (t) t.textContent = textoEstado(); }
  function vForm() {
    if (!prepararForm()) return;
    var f = H.form, c = cat(), editar = !!f.id, sede = sedeDe(f.curso) || U().sede, lim = S.hu.limites;
    var asigs = c.asignaturas[sede] || [], ultima = S.hu.mias[0];
    if (f.asignatura && asigs.indexOf(f.asignatura) < 0 && !f.otraAsig) { f.otraAsig = true; f.asigTexto = f.asignatura; f.asignatura = ''; }
    var h = EA.tb('Huella de clases', editar ? 'Editar registro' : 'Registro de contenidos impartidos',
      editar ? '<button class="btn ghost" type="button" data-go="huellaVer" data-id="' + esc(f.id) + '">Cancelar</button>' : '',
      editar ? 'Los cambios quedan registrados con la fecha de edición.' : 'Llénalo al terminar la clase: toma unos dos minutos.');
    if (!editar) h += tabs('huella');
    if (H.recuperado) h += '<div class="card cream row" style="justify-content:space-between"><span><b>Recuperamos lo que estabas escribiendo</b> en este dispositivo.</span><button class="btn ghost sm" type="button" data-hu="descartarBorrador">' + (editar ? 'Descartar cambios' : 'Empezar de cero') + '</button></div>';
    h += '<form id="huForm" class="stack" novalidate>';
    if (H.errores.length) h += '<div class="err" id="huErr" tabindex="-1" role="alert"><b>Revisa esto antes de guardar:</b><ul>' + H.errores.map(function (e) { return '<li>' + esc(e) + '</li>'; }).join('') + '</ul></div>';
    // 1. Identificación de la clase
    h += '<section class="card stack sec"><div class="sec-h"><h2><span class="num n1">1</span>Identificación de la clase</h2>' +
      (ultima && !editar ? '<button class="btn ghost sm" type="button" data-hu="repetir">Repetir el último</button>' : '') + '</div>' +
      '<div class="form"><label class="f full"><span>Docente</span><input type="text" value="' + esc((U().nombre ? U().nombre + ' · ' : '') + U().email) + '" readonly tabindex="-1"></label>' +
      '<label class="f"><span>Fecha</span><input type="date" id="huFecha" max="' + EA.hoy() + '" value="' + esc(f.fecha) + '"></label>' +
      '<label class="f"><span>Curso</span><select id="huCurso">' + opcionesCurso(f.curso) + '</select></label></div>' +
      '<div class="fg" role="group" aria-labelledby="huParL"><span class="lbl" id="huParL">Paralelo <em>· puedes marcar varios</em></span><div class="seg">' +
      (f.curso ? (c.paralelos[sede] || []).concat(f.paralelos.filter(function (p) { return (c.paralelos[sede] || []).indexOf(p) < 0; })).map(function (p) {
        return '<button type="button" data-hu="par" data-v="' + esc(p) + '" aria-pressed="' + (f.paralelos.indexOf(p) >= 0) + '">' + esc(p) + '</button>';
      }).join('') : '<span class="hint">Primero elige el curso.</span>') + '</div></div>' +
      '<div class="form"><label class="f"><span>Asignatura</span><select id="huAsig"><option value="">Elige la asignatura</option>' +
      asigs.map(function (a) { return opcion(a, a, f.otraAsig ? '' : f.asignatura); }).join('') + '<option value="__otra"' + (f.otraAsig ? ' selected' : '') + '>Otra (escríbela)</option></select></label>' +
      (f.otraAsig ? '<label class="f"><span>¿Cuál asignatura?</span><input type="text" id="huAsigOtra" maxlength="80" value="' + esc(f.asigTexto) + '"></label>' : '') + '</div></section>';
    // 2. Contenidos impartidos
    h += '<section class="card stack sec"><div class="sec-h"><h2><span class="num n2">2</span>Contenidos impartidos</h2></div>' + pendienteAnterior() +
      '<label class="f"><span>Tema de la clase</span><input type="text" id="huTema" maxlength="160" value="' + esc(f.tema) + '" placeholder="Ej.: Sistema digestivo"></label>' +
      '<label class="f"><span>Contenidos desarrollados</span><textarea id="huCont" maxlength="3000" placeholder="Ej.: Órganos del sistema digestivo y sus funciones.">' + esc(f.contenidos) + '</textarea></label>' +
      '<label class="f"><span>¿Qué actividades desarrollaron los estudiantes?</span><textarea id="huAct" maxlength="3000" placeholder="Ej.: Identificaron los órganos, exploraron un modelo interactivo y elaboraron un esquema del proceso digestivo.">' + esc(f.actividades) + '</textarea></label></section>';
    // 3. Recursos y resultados
    h += '<section class="card stack sec"><div class="sec-h"><h2><span class="num n3">3</span>Recursos y resultados</h2></div>' +
      '<div class="fg" role="group" aria-labelledby="huRecL"><span class="lbl" id="huRecL">Recursos utilizados <em>· opcional</em></span><div class="seg">' +
      c.recursos.concat(f.recursos.filter(function (r) { return c.recursos.indexOf(r) < 0; })).map(function (r) {
        return '<button type="button" data-hu="rec" data-v="' + esc(r) + '" aria-pressed="' + (f.recursos.indexOf(r) >= 0) + '">' + esc(r) + '</button>';
      }).join('') + '<button type="button" data-hu="otro" aria-pressed="' + f.otroOn + '">Otro</button></div>' +
      (f.otroOn ? '<label class="f"><span>¿Qué otro recurso?</span><input type="text" id="huRecOtro" maxlength="120" value="' + esc(f.recursoOtro) + '" placeholder="Ej.: material concreto"></label>' : '') + '</div>' +
      '<label class="f"><span>Metodología <em>· opcional</em></span><input type="text" id="huMet" maxlength="1000" value="' + esc(f.metodologia) + '" placeholder="Ej.: aprendizaje basado en proyectos, trabajo cooperativo"></label>' +
      '<div class="fg" role="radiogroup" aria-labelledby="huEstL"><span class="lbl" id="huEstL">Estado del contenido</span><div class="estados">' +
      Object.keys(S.hu.estados).map(function (k) {
        return '<button type="button" role="radio" data-hu="estado" data-v="' + k + '" aria-checked="' + (f.estado === k) + '"><i aria-hidden="true"></i>' + esc(S.hu.estados[k]) + '</button>';
      }).join('') + '</div></div>' +
      (f.estado && f.estado !== 'completo' ? '<label class="f"><span>¿Qué quedó pendiente para la próxima clase?</span><textarea id="huPend" maxlength="600" placeholder="Ej.: Faltó elaborar el esquema del proceso digestivo.">' + esc(f.pendiente) + '</textarea></label>' : '') +
      '<div class="fg"><span class="lbl">Evidencia de la clase <em>· opcional</em></span>' +
      '<label class="drop" id="huDrop"><input type="file" id="huArchivos" multiple accept="' + ACCEPT + '">' + ICO.subir +
      '<b>Adjuntar evidencia</b><span>Fotografía, documento, video, audio, modelo 3D o página web</span>' +
      '<span class="hint">Hasta ' + lim.maxArchivos + ' archivos de ' + lim.maxMb + ' MB cada uno. Lo más pesado, compártelo como enlace.</span></label>' +
      '<div class="enlace-row"><label class="f"><span>O agrega un enlace</span><input type="url" id="huUrl" inputmode="url" placeholder="https://…" autocomplete="off"></label><button class="btn ghost" type="button" data-hu="agregarEnlace">Agregar</button></div>' +
      '<div class="evs" id="huEvs">' + listaEvidencias() + '</div></div></section>';
    h += '<div class="dock"><div class="card"><span class="hint" id="huEstadoForm" aria-live="polite">' + esc(textoEstado()) + '</span>' +
      '<button class="btn" type="submit" id="huGuardar"' + (H.guardando ? ' disabled' : '') + '>' + (H.guardando ? 'Guardando…' : editar ? 'Guardar cambios' : 'Guardar huella') + '</button></div></div></form>';
    $('#view').innerHTML = h;
  }
  function validar(f) {
    var e = [];
    if (!f.fecha) e.push('Elige la fecha de la clase.'); else if (f.fecha > EA.hoy()) e.push('La fecha de la clase no puede ser futura.');
    if (!f.curso) e.push('Elige el curso.');
    if (f.curso && !f.paralelos.length) e.push('Marca al menos un paralelo.');
    if (f.otraAsig ? f.asigTexto.trim().length < 2 : !f.asignatura) e.push('Elige la asignatura' + (f.otraAsig ? ' o escribe cuál es.' : '.'));
    if (f.tema.trim().length < 3) e.push('Escribe el tema de la clase.');
    if (f.contenidos.trim().length < 3) e.push('Escribe los contenidos desarrollados.');
    if (f.actividades.trim().length < 3) e.push('Escribe qué actividades desarrollaron los estudiantes.');
    if (f.otroOn && !f.recursoOtro.trim()) e.push('Escribe qué otro recurso usaste o desmarca «Otro».');
    if (!f.estado) e.push('Elige el estado del contenido.');
    if (f.estado && f.estado !== 'completo' && f.pendiente.trim().length < 3) e.push('Escribe qué quedó pendiente para la próxima clase.');
    return e;
  }
  function guardar() {
    var f = H.form;
    if (!f || H.guardando) return;
    if (subiendo(f)) { EA.toast('Espera a que terminen de subir los archivos.', true); return; }
    if (H.subidas.some(function (s) { return s.form === f && s.estado === 'error'; })) { EA.toast('Un archivo no se subió: reintenta o quítalo antes de guardar.', true); return; }
    H.errores = validar(f);
    if (H.errores.length) { vForm(); var box = $('#huErr'); if (box) { box.scrollIntoView({ block: 'center' }); box.focus({ preventScroll: true }); } return; }
    H.guardando = true;
    var b = $('#huGuardar'); if (b) { b.disabled = true; b.textContent = 'Guardando…'; }
    var datos = { id: f.id, fecha: f.fecha, curso: f.curso, paralelos: f.paralelos, asignatura: f.otraAsig ? f.asigTexto.trim() : f.asignatura, asignaturaOtra: !!f.otraAsig,
      tema: f.tema, contenidos: f.contenidos, actividades: f.actividades, recursos: f.recursos, recursoOtro: f.otroOn ? f.recursoOtro : '',
      metodologia: f.metodologia, estado: f.estado, pendiente: f.estado === 'completo' ? '' : f.pendiente, evidencias: f.evidencias };
    EA.api('huGuardar', datos).then(function (r) {
      H.guardando = false;
      clearTimeout(borradorT); EA.store(claveBorrador(f.id));
      var i = S.hu.mias.map(function (x) { return x.id; }).indexOf(r.huella.id);
      if (i >= 0) S.hu.mias[i] = r.huella; else S.hu.mias.unshift(r.huella);
      S.hu.mias.sort(function (a, b) { var x = b.fecha + b.creado, y = a.fecha + a.creado; return x < y ? -1 : x > y ? 1 : 0; });
      H.det[r.huella.id] = r.detalle; H.form = null; H.formKey = ''; H.recien = r.huella.id; H.origen = 'huMias';
      EA.go('huellaVer', r.huella.id);
      EA.toast(f.id ? 'Cambios guardados.' : 'Huella guardada.');
    }).catch(function (e) {
      H.guardando = false; H.errores = [e.message];
      if (S.view === 'huella' || S.view === 'huEditar') { vForm(); var box = $('#huErr'); if (box) box.scrollIntoView({ block: 'center' }); }
      else EA.toast(e.message, true);
    });
  }

  /* ---------------- subida de evidencias (por partes, una a la vez) ---------------- */
  function leerB64(blob) {
    return new Promise(function (res, rej) {
      var fr = new FileReader();
      fr.onload = function () { res(String(fr.result).split(',')[1] || ''); };
      fr.onerror = function () { rej(new Error('No se pudo leer el archivo. Vuelve a elegirlo.')); };
      fr.readAsDataURL(blob);
    });
  }
  function conReintentos(fn, n) {
    var esperas = [1500, 4000, 9000];
    return fn().catch(function (e) {
      if (e.codigo !== 'RED' || n >= esperas.length) throw e;
      return new Promise(function (r) { setTimeout(r, esperas[n]); }).then(function () { return conReintentos(fn, n + 1); });
    });
  }
  function barra(s) {
    var el = document.querySelector('[data-sub="' + s.k + '"]');
    if (!el) return;
    var i = el.querySelector('.bar i'), p = el.querySelector('.pct');
    if (i) i.style.width = s.pct + '%';
    if (p) p.textContent = s.pct + '%';
  }
  function adjuntar(files) {
    var f = H.form, lim = S.hu.limites;
    Array.prototype.forEach.call(files || [], function (file) {
      var x = huExtension(file.name);
      if (!HU_TIPOS[x]) { EA.toast('No se aceptan archivos .' + (x || 'sin extensión') + '. Expórtalo a PDF, video, audio o imagen, o comprímelo en .zip.', true); return; }
      if (!file.size) { EA.toast('«' + file.name + '» está vacío.', true); return; }
      if (file.size > lim.maxMb * 1048576) { EA.toast('«' + file.name + '» pesa ' + fTam(file.size) + '. El límite es ' + lim.maxMb + ' MB: compártelo como enlace.', true); return; }
      var usados = f.evidencias.filter(function (e) { return e.t === 'a'; }).length + H.subidas.filter(function (s) { return s.form === f; }).length;
      if (usados >= lim.maxArchivos) { EA.toast('Puedes adjuntar hasta ' + lim.maxArchivos + ' archivos por huella.', true); return; }
      var s = { k: ++H.seq, file: file, n: file.name, s: file.size, x: x, pct: 0, estado: 'subiendo', form: f };
      H.subidas.push(s);
      H.cola = H.cola.then(function () { return subirUno(s); });
    });
    pintarEvs();
  }
  function subirUno(s) {
    if (s.cancelado) return null;
    s.estado = 'subiendo'; s.msg = ''; s.pct = 0;
    return conReintentos(function () { return EA.api('subidaIniciar', { nombre: s.n, tam: s.s, tipo: s.file.type || '' }); }, 0).then(function (r) {
      var off = 0;
      function paso() {
        if (s.cancelado) return null;
        return leerB64(s.file.slice(off, Math.min(off + r.parte, s.s))).then(function (b64) {
          return conReintentos(function () { return EA.api('subidaParte', { sid: r.sid, inicio: off, datos: b64 }, { tiempo: 180000 }); }, 0);
        }).then(function (r2) {
          if (r2.archivo) return r2.archivo;
          off = r2.sig; s.pct = Math.min(99, Math.floor(off / s.s * 100)); barra(s);
          return paso();
        });
      }
      return paso();
    }).then(function (archivo) {
      if (!archivo) return;
      if (s.cancelado) { EA.api('evidenciaDescartar', { id: archivo.id }).catch(function () { }); return; }
      H.subidas = H.subidas.filter(function (x) { return x !== s; });
      s.form.evidencias.push(archivo);
      EA.store(claveBorrador(s.form.id), s.form);
      if (s.form === H.form) pintarEvs();
    }).catch(function (e) {
      s.estado = 'error'; s.msg = e.message || 'No se pudo subir.';
      if (s.form === H.form) pintarEvs();
    });
  }
  function quitarEvidencia(i) {
    var f = H.form, e = f.evidencias[i];
    if (!e) return;
    f.evidencias.splice(i, 1);
    // Un archivo subido en este borrador (y no guardado antes) se manda a la papelera.
    if (e.t === 'a' && (f.guardadas || []).indexOf(e.id) < 0) EA.api('evidenciaDescartar', { id: e.id }).catch(function () { });
    guardarBorrador(); pintarEvs();
  }
  window.addEventListener('beforeunload', function (ev) {
    if (H.subidas.some(function (s) { return s.estado === 'subiendo'; })) { ev.preventDefault(); ev.returnValue = ''; }
  });

  /* ---------------- detalle ---------------- */
  function vVer() {
    var id = S.id;
    H.confirmar = false;
    if (H.det[id]) return pintarVer();
    EA.loading('Abriendo la huella…');
    EA.api('huDetalle', { id: id }).then(function (d) { H.det[id] = d; if (S.view === 'huellaVer' && S.id === id) pintarVer(); })
      .catch(function (e) {
        if (S.view !== 'huellaVer' || S.id !== id) return;
        $('#view').innerHTML = '<div class="err">' + esc(e.message) + '</div><p><button class="btn ghost" type="button" data-go="' + esc(H.origen) + '">Volver</button></p>';
      });
  }
  function bloque(titulo, texto, color) {
    return '<section class="card stack" style="gap:8px"><span class="strip ' + (color || '') + '">' + titulo + '</span><p class="texto">' + esc(texto) + '</p></section>';
  }
  function evVer(e) {
    if (e.t === 'e') {
      return '<a class="ev-item ev-link" href="' + esc(e.u) + '" target="_blank" rel="noopener noreferrer"><span class="tipo">' + ICO.enlace + '</span>' +
        '<div class="mid"><span class="nom">' + esc(e.n) + '</span><span class="ev-sub">' + esc(e.u) + '</span></div><span class="abrir">Abrir</span></a>';
    }
    return '<button type="button" class="ev-item ev-link" data-hu="abrirEv" data-a="' + esc(e.id) + '"><span class="tipo">' + esc(String(e.x || '').slice(0, 4)) + '</span>' +
      '<div class="mid"><span class="nom">' + esc(e.n) + '</span><span class="ev-sub">' + fTam(e.s) + ' · se abre en Google Drive</span></div><span class="abrir">Abrir</span></button>';
  }
  function pintarVer() {
    var d = H.det[S.id], volver = H.origen || 'huMias';
    var acts = '<button class="btn ghost" type="button" data-go="' + esc(volver) + '">Volver</button>' + (d.propia ? '<button class="btn" type="button" data-go="huEditar" data-id="' + esc(d.id) + '">Editar</button>' : '');
    var h = EA.tb('Huella de clases · ' + esc(EA.fFechaLarga(d.fecha)), esc(d.tema), acts, esc(cursoTxt(d) + ' · ' + d.asignatura + ' · ' + d.sede) + (d.propia ? '' : ' · ' + esc(d.docente)));
    if (H.recien === d.id) {
      h += '<div class="card teal row" style="justify-content:space-between"><span><b>Huella guardada.</b> ¿Registras otra clase?</span><button class="btn sm" type="button" data-go="huella">Registrar otra</button></div>';
      H.recien = '';
    }
    h += '<div class="grid2">' + bloque('Contenidos desarrollados', d.contenidos, 'blue') + bloque('Actividades de los estudiantes', d.actividades, 'green') + '</div>';
    var recs = d.recursos.concat(d.recursoOtro ? [d.recursoOtro] : []);
    h += '<div class="grid2"><section class="card stack" style="gap:10px"><span class="strip">Recursos y metodología</span>' +
      (recs.length ? '<div class="tags">' + recs.map(function (r) { return '<span class="chip">' + esc(r) + '</span>'; }).join('') + '</div>' : '<p class="muted small">Sin recursos registrados.</p>') +
      (d.metodologia ? '<p class="texto"><b>Metodología:</b> ' + esc(d.metodologia) + '</p>' : '') + '</section>' +
      '<section class="card stack" style="gap:10px"><span class="strip pink">Estado del contenido</span><div class="row">' + chipEstado(d.estado) + '<b>' + esc(S.hu.estados[d.estado] || d.estado) + '</b></div>' +
      (d.pendiente ? '<p class="texto"><b>Quedó pendiente:</b> ' + esc(d.pendiente) + '</p>' : '') + '</section></div>';
    h += '<section class="card stack" style="gap:10px"><span class="strip sky">Evidencia de la clase</span>' +
      (d.evidencias.length ? '<div class="evs">' + d.evidencias.map(evVer).join('') + '</div>' : '<p class="muted">Sin evidencia adjunta.</p>') + '</section>';
    h += '<p class="small muted">Registrada por ' + esc(d.docente) + ' (' + esc(d.email) + ') el ' + esc(EA.fFechaLarga(d.creado)) + (d.editado ? ' · editada el ' + esc(EA.fFechaLarga(d.editado)) : '') + '.</p>';
    if (d.propia) {
      h += H.confirmar
        ? '<div class="confirm">¿Eliminar esta huella? Sus archivos irán a la papelera de Drive.<button class="btn coral sm" type="button" data-hu="eliminarSi">Sí, eliminar</button><button class="btn ghost sm" type="button" data-hu="eliminarNo">Cancelar</button></div>'
        : '<div><button class="btn ghost sm" type="button" data-hu="eliminarPedir">Eliminar esta huella</button></div>';
    }
    $('#view').innerHTML = h;
  }
  function abrirEvidencia(boton) {
    var d = H.det[S.id], id = boton.dataset.a;
    if (EA.DEMO) { EA.toast('En el portal publicado, el archivo se abre en Google Drive con tu cuenta.'); return; }
    var w = null;
    try { w = window.open('', '_blank'); } catch (e) { w = null; }
    boton.disabled = true;
    EA.api('evidenciaAbrir', { huella: d.id, archivo: id }).then(function (r) {
      boton.disabled = false;
      if (w && !w.closed) { w.location.href = r.url; return; }
      var a = document.createElement('a'); a.href = r.url; a.target = '_blank'; a.rel = 'noopener'; a.className = 'btn sm'; a.textContent = 'Abrir ' + (r.nombre || 'archivo');
      boton.replaceWith(a); EA.toast('Toca «Abrir» para ver el archivo.');
    }).catch(function (e) { boton.disabled = false; if (w) w.close(); EA.toast(e.message, true); });
  }

  /* ---------------- mis huellas y huellas de mis cursos ---------------- */
  function vMias() {
    var mias = S.hu.mias, f = H.lista, mes = EA.hoy().slice(0, 7);
    var h = EA.tb('Huella de clases', 'Mis huellas', '<button class="btn" type="button" data-go="huella">Registrar huella</button>', S.hu.anio ? 'Año lectivo ' + esc(S.hu.anio) : '');
    h += tabs('huMias');
    h += '<div class="tiles"><div class="tile"><b>' + mias.filter(function (x) { return x.fecha >= lunes(); }).length + '</b><span>Esta semana</span></div>' +
      '<div class="tile"><b>' + mias.filter(function (x) { return x.fecha.slice(0, 7) === mes; }).length + '</b><span>Este mes</span></div>' +
      '<div class="tile"><b>' + porContinuar().length + '</b><span>Por continuar</span></div>' +
      '<div class="tile"><b>' + mias.filter(function (x) { return x.nEvid > 0; }).length + '</b><span>Con evidencia</span></div></div>';
    var cursos = []; mias.forEach(function (x) { if (cursos.indexOf(x.curso) < 0) cursos.push(x.curso); });
    h += '<div class="filters"><label class="f q"><span>Buscar</span><input type="search" id="huMq" value="' + esc(f.q) + '" placeholder="Tema, curso o asignatura" autocomplete="off"></label>' +
      '<label class="f"><span>Curso</span><select id="huMcurso">' + opcion('', 'Todos', f.curso) + cursos.map(function (x) { return opcion(x, x, f.curso); }).join('') + '</select></label>' +
      '<label class="f"><span>Estado</span><select id="huMest">' + opcion('', 'Todos', f.est) + Object.keys(ESTADO_CORTO).map(function (k) { return opcion(k, ESTADO_CORTO[k], f.est); }).join('') + '</select></label></div>';
    h += '<div id="huMlista"></div>';
    $('#view').innerHTML = h;
    pintarMias();
  }
  function pintarMias() {
    var f = H.lista, q = f.q.trim().toLowerCase(), mias = S.hu.mias;
    var l = mias.filter(function (x) {
      if (f.curso && x.curso !== f.curso) return false;
      if (f.est && x.estado !== f.est) return false;
      if (q && [x.tema, x.curso, x.paralelos.join(' '), x.asignatura].join(' ').toLowerCase().indexOf(q) < 0) return false;
      return true;
    });
    var el = $('#huMlista'); if (!el) return;
    if (!mias.length) { el.innerHTML = '<div class="card empty-state"><span class="strip">Sin huellas</span><h2>Todavía no registras ninguna clase</h2><p class="muted">Al terminar tu próxima clase, registra lo que impartiste: toma unos dos minutos.</p><p><button class="btn" type="button" data-go="huella">Registrar huella</button></p></div>'; return; }
    el.innerHTML = l.length ? '<div class="list">' + l.map(function (x) { return itemHuella(x, false); }).join('') + '</div>' : '<div class="empty"><b>Ninguna huella coincide</b>Ajusta o quita los filtros.</div>';
  }
  function vCursos() {
    var h = EA.tb('Huella de clases', 'Huellas de mis cursos', '<button class="btn ghost" type="button" data-hu="recargarCursos">Actualizar</button>',
      'Lo que registran otros docentes en los cursos y paralelos donde tú también registras.');
    h += tabs('huCursos');
    h += '<div class="filters"><label class="f q"><span>Buscar</span><input type="search" id="huCq" value="' + esc(H.cursosQ) + '" placeholder="Docente, tema, curso o asignatura" autocomplete="off"></label><div></div><div></div></div>';
    h += '<div id="huClista"></div>';
    $('#view').innerHTML = h;
    pintarCursos();
  }
  function pintarCursos() {
    var q = H.cursosQ.trim().toLowerCase(), todas = S.hu.pares;
    var l = todas.filter(function (x) { return !q || [x.docente, x.tema, x.curso, x.paralelos.join(' '), x.asignatura].join(' ').toLowerCase().indexOf(q) >= 0; });
    var el = $('#huClista'); if (!el) return;
    if (!todas.length) {
      el.innerHTML = '<div class="card empty-state"><span class="strip blue">Aún no hay huellas</span><h2>Aquí verás las clases de tus compañeros</h2><p class="muted">' +
        (S.hu.mias.length ? 'Ningún otro docente ha registrado todavía en tus cursos y paralelos.' : 'Aparecen cuando registras tus propias huellas: verás las de otros docentes en esos mismos cursos y paralelos.') + '</p></div>';
      return;
    }
    el.innerHTML = l.length ? '<div class="list">' + l.map(function (x) { return itemHuella(x, true); }).join('') + '</div>' : '<div class="empty"><b>Ninguna huella coincide</b>Prueba con otra búsqueda.</div>';
  }

  /* ---------------- registros (coordinación, Departamento y Dirección) ---------------- */
  var PERIODOS = [['hoy', 'Hoy'], ['7', '7 días'], ['30', '30 días'], ['', 'Todo el año']];
  function sedesPermitidas() { var p = S.hu.permisos; return p.global ? HU_SEDES.slice() : p.coord.slice(); }
  function filtrosRegistro() {
    var r = H.reg, desde = '';
    if (r.per === 'hoy') desde = EA.hoy(); else if (r.per) desde = EA.haceDias(Number(r.per) - 1);
    return { sede: r.sede, curso: r.curso, asignatura: r.asig, estado: r.est, q: r.q.trim(), desde: desde };
  }
  function vRegistros() {
    if (!S.hu.permisos.registros) return EA.go('inicio');
    var r = H.reg, c = cat(), sedes = sedesPermitidas(), visibles = r.sede ? [r.sede] : sedes;
    var cursos = [], asigs = [];
    visibles.forEach(function (s) {
      (c.cursos[s] || []).forEach(function (x) { if (cursos.indexOf(x) < 0) cursos.push(x); });
      (c.asignaturas[s] || []).forEach(function (x) { if (asigs.indexOf(x) < 0) asigs.push(x); });
    });
    var h = EA.tb(esc(sedes.join(' y ')), 'Registros de huellas', EA.DEMO ? '' : '<button class="btn ghost" type="button" data-hu="regCsv">Exportar a Excel (CSV)</button>',
      'Las huellas de clase que registran los docentes. Toca una fila para ver el registro completo.');
    h += '<div id="huRegKpis"></div>';
    h += '<section class="card stack"><div class="toolbar' + (sedes.length > 1 ? ' t5' : '') + '">' +
      '<label class="f q"><span>Buscar</span><input type="search" id="huRq" value="' + esc(r.q) + '" placeholder="Docente, tema, curso o paralelo" autocomplete="off"></label>' +
      (sedes.length > 1 ? '<label class="f"><span>Sede</span><select id="huRsede">' + opcion('', 'Las dos', r.sede) + sedes.map(function (s) { return opcion(s, s, r.sede); }).join('') + '</select></label>' : '') +
      '<label class="f"><span>Curso</span><select id="huRcurso">' + opcion('', 'Todos', r.curso) + cursos.map(function (x) { return opcion(x, x, r.curso); }).join('') + '</select></label>' +
      '<label class="f"><span>Asignatura</span><select id="huRasig">' + opcion('', 'Todas', r.asig) + asigs.map(function (x) { return opcion(x, x, r.asig); }).join('') + '</select></label>' +
      '<label class="f"><span>Estado</span><select id="huRest">' + opcion('', 'Todos', r.est) + Object.keys(ESTADO_CORTO).map(function (k) { return opcion(k, ESTADO_CORTO[k], r.est); }).join('') + '</select></label></div>' +
      '<div class="row"><div class="seg">' + PERIODOS.map(function (p) { return '<button type="button" data-hu="regPer" data-v="' + p[0] + '" aria-pressed="' + (r.per === p[0]) + '">' + p[1] + '</button>'; }).join('') + '</div>' +
      '<span class="muted small" id="huRegCount" style="margin-left:auto"></span><button class="btn ghost sm" type="button" data-hu="regLimpiar">Quitar filtros</button></div></section>';
    h += '<div id="huRegList"></div>';
    $('#view').innerHTML = h;
    if (H.regRes) pintarRegistros();
    cargarRegistros();
  }
  function cargarRegistros() {
    var n = ++H.regPide;
    var el = $('#huRegList'); if (el && !H.regRes) el.innerHTML = '<div class="loading"><span class="spin"></span>Cargando huellas…</div>';
    EA.api('huLista', filtrosRegistro()).then(function (res) {
      if (n !== H.regPide) return;
      H.regRes = res; H.regErr = '';
      if (S.view === 'huRegistros') pintarRegistros();
    }).catch(function (e) {
      if (n !== H.regPide) return;
      H.regErr = e.message;
      if (S.view === 'huRegistros') { var l = $('#huRegList'); if (l) l.innerHTML = '<div class="err">' + esc(e.message) + '</div>'; }
    });
  }
  function pintarRegistros() {
    var res = H.regRes, k = $('#huRegKpis'), l = $('#huRegList');
    if (!res || !k || !l) return;
    k.innerHTML = '<div class="tiles"><div class="tile"><b>' + res.total + '</b><span>Huellas registradas</span></div>' +
      '<div class="tile"><b>' + res.docentes + '</b><span>Docentes que registraron</span></div>' +
      '<div class="tile"><b>' + res.pendientes + '</b><span>Parciales o por continuar</span></div>' +
      '<div class="tile"><b>' + res.conEvidencia + '</b><span>Con evidencia</span></div></div>';
    $('#huRegCount').textContent = res.total === 1 ? '1 huella' : res.total + ' huellas';
    if (!res.filas.length) { l.innerHTML = '<div class="empty"><b>No hay huellas con estos filtros</b>Cambia el periodo o quita los filtros.</div>'; return; }
    l.innerHTML = '<div class="tbl-wrap regs-wrap"><table class="tbl regs hu-regs"><thead><tr><th>Fecha</th><th>Docente</th><th>Curso</th><th>Asignatura y tema</th><th>Estado</th><th class="c">Evidencia</th></tr></thead><tbody>' +
      res.filas.map(function (x) {
        return '<tr class="click" data-go="huellaVer" data-id="' + esc(x.id) + '" tabindex="0">' +
          '<td data-l="Fecha" class="n">' + esc(EA.fFecha(x.fecha)) + ' ' + esc(x.fecha.slice(0, 4)) + (x.editado ? '<span class="sub2">Editada</span>' : '') + '</td>' +
          '<td data-l="Docente" class="doc"><b>' + esc(x.docente) + '</b><span class="sub2">' + esc(x.email) + '</span></td>' +
          '<td data-l="Curso"><span class="chip">' + esc(x.sede) + '</span><span class="sub2">' + esc(cursoTxt(x)) + '</span></td>' +
          '<td data-l="Asignatura"><b>' + esc(x.asignatura) + '</b><span class="sub2">' + esc(x.tema) + '</span></td>' +
          '<td data-l="Estado">' + chipEstado(x.estado) + (x.estado !== 'completo' && x.pendiente ? '<span class="sub2">' + esc(x.pendiente.length > 90 ? x.pendiente.slice(0, 88) + '…' : x.pendiente) + '</span>' : '') + '</td>' +
          '<td data-l="Evidencia" class="c n">' + (x.nEvid ? '<span class="evn">' + ICO.clip + x.nEvid + '</span>' : '<span class="muted">—</span>') + '</td></tr>';
      }).join('') + '</tbody></table></div>' +
      (res.total > res.filas.length ? '<p class="small muted">Se muestran las ' + res.filas.length + ' más recientes de ' + res.total + '. Usa los filtros o exporta a Excel para verlas todas.</p>' : '');
  }
  function csvRegistros() {
    var b = document.querySelector('[data-hu="regCsv"]'); if (b) { b.disabled = true; b.textContent = 'Preparando…'; }
    EA.api('huExportar', filtrosRegistro()).then(function (r) {
      var celda = function (x) { x = x == null ? '' : String(x); return /[";\n\r]/.test(x) ? '"' + x.replace(/"/g, '""') + '"' : x; };
      var filas = [['Fecha', 'Sede', 'Curso', 'Paralelos', 'Asignatura', 'Docente', 'Correo', 'Tema', 'Contenidos desarrollados', 'Actividades de los estudiantes',
        'Recursos', 'Otro recurso', 'Metodología', 'Estado', 'Quedó pendiente', 'Evidencias', 'Registrada', 'Editada']].concat(r.filas.map(function (x) {
        return [x.fecha, x.sede, x.curso, x.paralelos.join(', '), x.asignatura, x.docente, x.email, x.tema, x.contenidos, x.actividades, x.recursos.join(', '), x.recursoOtro,
          x.metodologia, S.hu.estados[x.estado] || x.estado, x.pendiente, x.evidencias.length, String(x.creado).replace('T', ' '), String(x.editado || '').replace('T', ' ')];
      }));
      EA.descargar('huellas-de-clase-' + EA.hoy() + '.csv', '﻿' + filas.map(function (f) { return f.map(celda).join(';'); }).join('\r\n'));
      EA.toast('Archivo descargado: ábrelo con Excel o Numbers.');
    }).catch(function (e) { EA.toast(e.message, true); })
      .then(function () { var b2 = document.querySelector('[data-hu="regCsv"]'); if (b2) { b2.disabled = false; b2.textContent = 'Exportar a Excel (CSV)'; } });
  }

  /* ---------------- eventos ---------------- */
  function alternar(lista, v) { var i = lista.indexOf(v); if (i >= 0) lista.splice(i, 1); else lista.push(v); }
  function click(ev) {
    var g = ev.target.closest('[data-go]');
    if (g && g.dataset.go === 'huellaVer' && S.view !== 'huellaVer') H.origen = S.view;
    var a = ev.target.closest('[data-hu]');
    if (!a) return false;
    var act = a.dataset.hu, v = a.dataset.v, f = H.form;
    ev.preventDefault();
    if (act === 'sede') {
      a.disabled = true;
      EA.api('huSede', { sede: v }).then(function () { S.hu.usuario.sede = v; EA.renderWho(); EA.go('inicio'); EA.toast('Sede: ' + v + '.'); })
        .catch(function (e) { a.disabled = false; EA.toast(e.message, true); });
      return true;
    }
    if (act === 'par') { alternar(f.paralelos, v); a.setAttribute('aria-pressed', f.paralelos.indexOf(v) >= 0); guardarBorrador(); refrescarPendiente(); return true; }
    if (act === 'rec') { alternar(f.recursos, v); a.setAttribute('aria-pressed', f.recursos.indexOf(v) >= 0); guardarBorrador(); return true; }
    if (act === 'otro') { f.otroOn = !f.otroOn; guardarBorrador(); vForm(); if (f.otroOn) { var o = $('#huRecOtro'); if (o) o.focus(); } return true; }
    if (act === 'estado') { f.estado = v; guardarBorrador(); vForm(); if (v !== 'completo') { var p = $('#huPend'); if (p) p.focus(); } return true; }
    if (act === 'repetir') {
      var u = S.hu.mias[0]; if (!u) return true;
      var sede = sedeDe(u.curso) || U().sede, lista = cat().asignaturas[sede] || [];
      f.curso = u.curso; f.paralelos = u.paralelos.slice();
      if (lista.indexOf(u.asignatura) >= 0) { f.asignatura = u.asignatura; f.otraAsig = false; f.asigTexto = ''; } else { f.asignatura = ''; f.otraAsig = true; f.asigTexto = u.asignatura; }
      guardarBorrador(); vForm(); EA.toast('Copiamos curso, paralelos y asignatura de tu último registro.');
      return true;
    }
    if (act === 'descartarBorrador') {
      if (f) f.evidencias.forEach(function (e) { if (e.t === 'a' && (f.guardadas || []).indexOf(e.id) < 0) EA.api('evidenciaDescartar', { id: e.id }).catch(function () { }); });
      H.subidas.forEach(function (s) { if (s.form === f) s.cancelado = true; });
      H.subidas = H.subidas.filter(function (s) { return s.form !== f; });
      clearTimeout(borradorT); EA.store(claveBorrador(f ? f.id : ''));
      H.form = null; H.formKey = ''; vForm();
      return true;
    }
    if (act === 'agregarEnlace') {
      var inp = $('#huUrl'), url = inp ? inp.value.trim() : '';
      if (url && !/^https?:\/\//i.test(url)) url = 'https://' + url;
      if (!/^https:\/\/[^\s<>"']+\.[^\s<>"']+$/i.test(url)) { EA.toast('Escribe un enlace válido que empiece con https://', true); if (inp) inp.focus(); return true; }
      if (f.evidencias.filter(function (e) { return e.t === 'e'; }).length >= S.hu.limites.maxEnlaces) { EA.toast('Puedes agregar hasta ' + S.hu.limites.maxEnlaces + ' enlaces.', true); return true; }
      if (!f.evidencias.some(function (e) { return e.u === url; })) f.evidencias.push({ t: 'e', u: url, n: (url.match(/^https:\/\/([^\/?#]+)/i) || [])[1].replace(/^www\./, '') });
      if (inp) inp.value = '';
      guardarBorrador(); pintarEvs();
      return true;
    }
    if (act === 'quitarEv') { quitarEvidencia(Number(a.dataset.i)); return true; }
    if (act === 'quitarSubida') {
      var s = H.subidas.filter(function (x) { return x.k === Number(a.dataset.k); })[0];
      if (s) { s.cancelado = true; H.subidas = H.subidas.filter(function (x) { return x !== s; }); }
      pintarEvs(); return true;
    }
    if (act === 'reintentar') {
      var s2 = H.subidas.filter(function (x) { return x.k === Number(a.dataset.k); })[0];
      if (s2) { s2.estado = 'subiendo'; s2.pct = 0; pintarEvs(); H.cola = H.cola.then(function () { return subirUno(s2); }); }
      return true;
    }
    if (act === 'abrirEv') { abrirEvidencia(a); return true; }
    if (act === 'eliminarPedir') { H.confirmar = true; pintarVer(); return true; }
    if (act === 'eliminarNo') { H.confirmar = false; pintarVer(); return true; }
    if (act === 'eliminarSi') {
      var id = S.id; a.disabled = true;
      EA.api('huEliminar', { id: id }).then(function () {
        S.hu.mias = S.hu.mias.filter(function (x) { return x.id !== id; }); delete H.det[id];
        EA.go('huMias'); EA.toast('Huella eliminada.');
      }).catch(function (e) { a.disabled = false; EA.toast(e.message, true); });
      return true;
    }
    if (act === 'recargarCursos') {
      a.disabled = true;
      EA.api('huInicio').then(function (hu) { S.hu = hu; vCursos(); EA.toast('Lista actualizada.'); }).catch(function (e) { a.disabled = false; EA.toast(e.message, true); });
      return true;
    }
    if (act === 'regPer') { H.reg.per = v; vRegistros(); return true; }
    if (act === 'regLimpiar') { H.reg = { per: '30', sede: '', curso: '', asig: '', est: '', q: '' }; vRegistros(); return true; }
    if (act === 'regCsv') { csvRegistros(); return true; }
    return false;
  }
  // Actualiza solo el aviso de "Quedó pendiente" sin repintar el formulario (no se pierde el foco).
  function refrescarPendiente() {
    if (S.view !== 'huella' && S.view !== 'huEditar') return;
    var cont = document.querySelectorAll('#huForm .sec')[1];
    if (!cont) return;
    var viejo = cont.querySelector('.callout'), nuevo = pendienteAnterior();
    if (viejo) viejo.remove();
    if (nuevo) cont.querySelector('.sec-h').insertAdjacentHTML('afterend', nuevo);
  }
  var CAMPOS = { huTema: 'tema', huCont: 'contenidos', huAct: 'actividades', huMet: 'metodologia', huPend: 'pendiente', huAsigOtra: 'asigTexto', huRecOtro: 'recursoOtro' };
  var regT;
  function input(ev) {
    var t = ev.target;
    if (CAMPOS[t.id] && H.form) { H.form[CAMPOS[t.id]] = t.value; guardarBorrador(); if (t.id === 'huAsigOtra') refrescarPendiente(); return true; }
    if (t.id === 'huMq') { H.lista.q = t.value; pintarMias(); return true; }
    if (t.id === 'huCq') { H.cursosQ = t.value; pintarCursos(); return true; }
    if (t.id === 'huRq') { H.reg.q = t.value; clearTimeout(regT); regT = setTimeout(cargarRegistros, 350); return true; }
    return false;
  }
  function change(ev) {
    var t = ev.target, f = H.form;
    if (t.id === 'huFecha' && f) { f.fecha = t.value; guardarBorrador(); return true; }
    if (t.id === 'huCurso' && f) {
      var antes = sedeDe(f.curso) || U().sede;
      f.curso = t.value;
      var ahora = sedeDe(f.curso) || U().sede, pars = cat().paralelos[ahora] || [];
      f.paralelos = f.paralelos.filter(function (p) { return pars.indexOf(p) >= 0; });
      if (antes !== ahora && f.asignatura && (cat().asignaturas[ahora] || []).indexOf(f.asignatura) < 0) f.asignatura = '';
      guardarBorrador(); vForm(); return true;
    }
    if (t.id === 'huAsig' && f) {
      if (t.value === '__otra') { f.otraAsig = true; f.asignatura = ''; guardarBorrador(); vForm(); var o = $('#huAsigOtra'); if (o) o.focus(); }
      else { var eraOtra = f.otraAsig; f.otraAsig = false; f.asigTexto = ''; f.asignatura = t.value; guardarBorrador(); if (eraOtra) vForm(); else refrescarPendiente(); }
      return true;
    }
    if (t.id === 'huArchivos') { adjuntar(t.files); t.value = ''; return true; }
    if (t.id === 'huMcurso') { H.lista.curso = t.value; pintarMias(); return true; }
    if (t.id === 'huMest') { H.lista.est = t.value; pintarMias(); return true; }
    var rm = { huRsede: 'sede', huRcurso: 'curso', huRasig: 'asig', huRest: 'est' }[t.id];
    if (rm) { H.reg[rm] = t.value; if (rm === 'sede') { H.reg.curso = ''; H.reg.asig = ''; } vRegistros(); return true; }
    return false;
  }
  function submit(ev) { if (ev.target.id !== 'huForm') return false; guardar(); return true; }
  // Arrastrar archivos sobre la zona de evidencia (computadora).
  document.addEventListener('dragover', function (ev) { var d = ev.target.closest && ev.target.closest('#huDrop'); if (d) { ev.preventDefault(); d.classList.add('sobre'); } });
  document.addEventListener('dragleave', function (ev) { var d = ev.target.closest && ev.target.closest('#huDrop'); if (d) d.classList.remove('sobre'); });
  document.addEventListener('drop', function (ev) {
    var d = ev.target.closest && ev.target.closest('#huDrop');
    if (!d) return;
    ev.preventDefault(); d.classList.remove('sobre');
    if (ev.dataTransfer && ev.dataTransfer.files) adjuntar(ev.dataTransfer.files);
  });

  var PADRE = { huella: 'huella', huEditar: 'huella', huMias: 'huella', huCursos: 'huella', huellaVer: 'huella', huRegistros: 'huRegistros', inicio: 'inicio', sede: 'inicio' };
  return {
    vistas: { sede: vSede, inicio: vInicio, huella: vForm, huEditar: vForm, huMias: vMias, huCursos: vCursos, huellaVer: vVer, huRegistros: vRegistros },
    nav: function () {
      if (!S.hu.usuario.sede) return [];   // primero la sede (paso 2)
      var items = [['inicio', 'Inicio'], ['huella', 'Huella de clases']];
      if (S.hu.permisos.registros) items.push(['huRegistros', 'Registros de huellas']);
      if (S.boot) items.push(['|'], [S.boot.usuario.role === 'evaluador' ? 'visitas' : 'registros', 'Evaluación de clases']);
      return items;
    },
    sinSede: function () { return !S.hu.usuario.sede; },
    padre: function (v) { return v === 'huellaVer' && H.origen === 'huRegistros' ? 'huRegistros' : PADRE[v]; },
    click: click, input: input, change: change, submit: submit, reiniciar: reiniciar
  };
};

/* EA Conecta · portal (cliente) */
(function () {
  'use strict';
  // Dos modos: el sitio publicado (habla con el servidor de Apps Script) y la demostración con datos de ejemplo.
  var DEMO = !!window.REA_DEMO;
  var C = RubricaCore;
  var CV = ['C1', 'C2', 'C3', 'C4', 'C5', 'C6'], CE = ['B1', 'B2', 'B3'];
  var MESES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
  var S = { boot: null, view: '', id: null, det: null, filtro: { q: '', estado: '', trim: 0 }, labFiltro: { trim: 0 }, resTrim: 0, res: null, resOrden: 'desc', resQ: '',
    tick: null, confirm: '', draft: null, rev: null, editDoc: null, form: {}, err: '', busy: false,
    v: '', cacheDet: {}, resCache: {}, watch: null, refrescando: false,
    regF: { q: '', sub: '', niv: '', est: '', per: '' }, hu: null, huError: '' };

  /* ---------------- utilidades ---------------- */
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function $(sel, root) { return (root || document).querySelector(sel); }
  function $$(sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); }
  function api(accion, datos) {
    if (!DEMO) return window.REA_WEB.llamar(accion, datos || {});
    return new Promise(function (res, rej) {
      setTimeout(function () {
        try { res(JSON.parse(JSON.stringify(window.REA_DEMO.api(accion, datos || {})))); } catch (e) { rej(e); }
      }, 80);
    });
  }
  // Escritura: el servidor responde con los datos ya actualizados (un solo viaje).
  function escribir(accion, datos, conDetalle) {
    var det = conDetalle && S.det ? { tipo: S.det.tipo, id: S.id } : null;
    if (DEMO) {
      return api(accion, datos).then(function (r) {
        return api('bootstrap').then(function (b) {
          if (!det) return { r: r, boot: b };
          return api(det.tipo, { id: det.id }).then(function (x) { return { r: r, boot: b, det: x }; });
        });
      });
    }
    var d = {}; for (var k in (datos || {})) d[k] = datos[k];
    if (det) d._det = det;
    return api(accion, d);
  }
  // Lectura combinada: datos generales y, si se pide, el detalle abierto (un solo viaje).
  function refrescar(conDetalle) {
    var det = conDetalle && S.det ? { tipo: S.det.tipo, id: S.id } : null;
    if (DEMO) {
      return api('bootstrap').then(function (b) {
        if (!det) return { boot: b };
        return api(det.tipo, { id: det.id }).then(function (x) { return { boot: b, det: x }; });
      });
    }
    return api('refrescar', { det: det });
  }
  // Al crear, el servidor devuelve también el detalle para abrirlo sin otro viaje.
  function abrirAl(datos, tipo) { if (DEMO) return datos; var d = {}; for (var k in datos) d[k] = datos[k]; d._abrir = tipo; return d; }
  function fijarDetalle(d, tipo, id) {
    d.tipo = tipo; d.puntuaciones = ordenEval(d.puntuaciones || []); d._v = S.v;
    S.cacheDet[tipo + ':' + id] = d;
    if (S.id === id && S.view === tipo) S.det = d;
    return d;
  }
  function aplicar(out) {
    if (!out) return;
    if (out.boot) S.boot = out.boot;
    if (out.v) { if (out.v !== S.v) S.resCache = {}; S.v = out.v; }
    if (out.det && S.det) fijarDetalle(out.det, S.det.tipo, S.id);
  }
  // No se repinta encima de alguien que está escribiendo o puntuando.
  function puedeRepintar() {
    if (S.busy || S.confirm) return false;
    if (S.det && S.draft && !S.det.resumen.mia) return false;
    if (S.det && S.rev && !S.det.resumen.miaRevisada) return false;
    var a = document.activeElement;
    return !(a && /^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName));
  }
  var toastT;
  function toast(msg, bad) {
    var t = $('#toast'); if (!t) return;
    t.textContent = msg; t.className = 'toast' + (bad ? ' bad' : ''); t.hidden = false;
    clearTimeout(toastT); toastT = setTimeout(function () { t.hidden = true; }, bad ? 6000 : 3200);
  }
  function fFecha(f) { if (!f) return ''; var p = String(f).slice(0, 10).split('-'); return Number(p[2]) + ' ' + MESES[Number(p[1]) - 1]; }
  function fFechaLarga(f) { if (!f) return ''; var p = String(f).slice(0, 10).split('-'); return Number(p[2]) + ' ' + MESES[Number(p[1]) - 1] + ' ' + p[0] + (String(f).length > 10 ? ' · ' + String(f).slice(11, 16) : ''); }
  function hoy() { var d = new Date(); return d.getFullYear() + '-' + ('0' + (d.getMonth() + 1)).slice(-2) + '-' + ('0' + d.getDate()).slice(-2); }
  function ahoraHM() { var d = new Date(); return ('0' + d.getHours()).slice(-2) + ':' + ('0' + d.getMinutes()).slice(-2); }
  function num1(x) { return x == null ? '—' : String(Math.round(x * 10) / 10).replace('.', ','); }
  function esEval() { return S.boot && S.boot.usuario.role === 'evaluador'; }
  function docente(id) { return (S.boot.docentes.filter(function (d) { return d.id === id; })[0]) || { nombre: 'Docente eliminado', asignatura: '', subnivel: '' }; }
  function lv(n, sm) { n = Number(n); return n ? '<span class="lv l' + n + (sm ? ' sm' : '') + '" title="' + esc(C.nombreNivel(n)) + '">' + n + '</span>' : '<span class="lv empty' + (sm ? ' sm' : '') + '">–</span>'; }
  function cat(n, p) { n = Number(n); return n ? '<span class="cat c' + n + '">' + (p != null ? '<span class="tab-n">' + num1(p) + '</span> · ' : '') + esc(C.nombreNivel(n)) + '</span>' : ''; }
  function chipEstado(estado) {
    var t = { abierta: 'Puntuando', revision: 'En revisión', consolidada: 'Por verificar', verificada: 'Verificada' }[estado] || estado;
    return '<span class="chip ' + esc(estado) + '"><span class="dot"></span>' + esc(t) + '</span>';
  }
  function nombreEval(email) {
    var lista = (S.boot && S.boot.config.evaluadores) || [];
    var i = lista.indexOf(String(email).toLowerCase());
    return (i >= 0 ? 'Evaluador ' + (i + 1) : 'Evaluador') + ' · ' + String(email).split('@')[0];
  }
  function ordenEval(ps) {
    var lista = (S.boot && S.boot.config.evaluadores) || [];
    var pos = function (p) { var i = lista.indexOf(String(p.evaluador).toLowerCase()); return i < 0 ? 99 : i; };
    return ps.slice().sort(function (a, b) { return pos(a) - pos(b); });
  }
  function store(k, v) { try { if (v === undefined) localStorage.removeItem(k); else localStorage.setItem(k, JSON.stringify(v)); } catch (e) { } }
  function load(k) { try { var v = localStorage.getItem(k); return v ? JSON.parse(v) : null; } catch (e) { return null; } }
  function crit(id) { return REA.criterios[id]; }
  function strip(t, cls) { return '<span class="strip ' + (cls || '') + '">' + esc(t) + '</span>'; }

  function haceDias(n) { var d = new Date(); d.setDate(d.getDate() - n); return d.getFullYear() + '-' + ('0' + (d.getMonth() + 1)).slice(-2) + '-' + ('0' + d.getDate()).slice(-2); }
  function descargar(nombre, texto) {
    var url = URL.createObjectURL(new Blob([texto], { type: 'text/csv;charset=utf-8' }));
    var a = document.createElement('a'); a.href = url; a.download = nombre; document.body.appendChild(a); a.click();
    setTimeout(function () { URL.revokeObjectURL(url); a.remove(); }, 1000);
  }

  /* ---------------- módulos: Huella de clases ---------------- */
  // El portal comparte con cada módulo lo mínimo: estado, utilidades y navegación.
  var EA = { S: S, DEMO: DEMO, esc: esc, $: $, $$: $$, api: api, toast: toast, tb: tb, go: go, loading: loading, fFecha: fFecha, fFechaLarga: fFechaLarga,
    hoy: hoy, haceDias: haceDias, store: store, load: load, descargar: descargar, renderWho: function () { renderWho(); } };
  var HU = window.HU_MODULO ? window.HU_MODULO(EA) : null;

  /* ---------------- estructura ---------------- */
  var NAV = [['inicio', 'Inicio'], ['|'], ['visitas', 'Visitas'], ['registros', 'Registros de evaluación'], ['laboratorios', 'Laboratorios'], ['resultados', 'Resultados'], ['docentes', 'Docentes'], ['|'], ['rubrica', 'Rúbrica'], ['conversacion', 'Conversación 1 a 1']];
  var VISTAS_EVAL = { visitas: 1, nuevaVisita: 1, visita: 1, laboratorios: 1, nuevaExperiencia: 1, experiencia: 1, resultados: 1, docentes: 1, rubrica: 1, conversacion: 1, registros: 1 };
  function navItems() {
    if (VISTAS_EVAL[S.view] && S.boot) return S.hu ? NAV : NAV.slice(2);
    return HU && S.hu ? HU.nav() : [];
  }
  function shell() {
    var anio = S.boot ? S.boot.config.anio : S.hu ? S.hu.anio : '';
    $('#app').innerHTML =
      '<div class="stripe" aria-hidden="true"><i></i><i></i><i></i><i></i><i></i><i></i></div>' +
      '<header class="topbar"><div class="wrap gut">' +
      '<span class="thumb"><img src="' + REA_LOGO_SYM + '" alt="Eight Academy"></span>' +
      '<div class="t"><b>EA Conecta</b><span>Experiencias de Aprendizaje · Eight Academy' + (anio ? ' · ' + esc(anio) : '') + '</span></div>' +
      '<div class="who" id="who"></div></div></header>' +
      (!DEMO ? '' : '<div class="demo-band"><div class="wrap gut"><b>Demostración con datos de ejemplo.</b><span>Nada se guarda: al recargar vuelve al inicio. Cambia de persona arriba para ver el portal como docente, coordinación, Dirección o evaluador.</span></div></div>') +
      '<div class="navbar"><div class="wrap gut"><nav class="nav" id="nav" aria-label="Secciones"></nav></div></div>' +
      '<main><div class="wrap gut" id="view"></div></main>' +
      '<footer class="footer"><div class="wrap gut">Eight Academy · Unidad Educativa — We are the change.' + (DEMO ? '' : ' · <a href="privacidad.html">Aviso de privacidad</a>') + '</div></footer>' +
      '<div class="stripe" aria-hidden="true"><i></i><i></i><i></i><i></i><i></i><i></i></div>' +
      '<div id="toast" class="toast" hidden role="status" aria-live="polite"></div>';
  }
  function renderWho() {
    var u = S.hu ? S.hu.usuario : S.boot.usuario;
    var h = '';
    if (DEMO) {
      h += '<label class="demo-sel"><span>Ver como</span><select id="demoUser">' + window.REA_DEMO.usuarios.map(function (x, i) {
        return '<option value="' + i + '"' + (i === window.REA_DEMO.actual ? ' selected' : '') + '>' + esc(x.etiqueta) + '</option>';
      }).join('') + '</select></label>';
    }
    h += '<span class="av" aria-hidden="true">' + esc((u.nombre || u.email || '?').charAt(0).toUpperCase()) + '</span><span class="mail">' + esc(u.email) + '</span>';
    if (S.hu && S.hu.usuario.sede) h += '<button class="sede-btn" type="button" data-go="sede" title="Cambiar de sede">' + esc(S.hu.usuario.sede) + '</button>';
    if (S.boot) h += '<span class="role">' + (S.boot.usuario.role === 'evaluador' ? 'Evaluador' : 'Lectura') + '</span>';
    if (!DEMO) h += '<button class="salir" type="button" data-act="salir">Salir</button>';
    $('#who').innerHTML = h;
  }
  function renderNav() {
    var padre = HU && HU.padre(S.view);
    $('#nav').innerHTML = navItems().map(function (n) {
      if (n[0] === '|') return '<span class="sep" aria-hidden="true"></span>';
      var cur = S.view === n[0] || padre === n[0] || (S.view === 'visita' || S.view === 'nuevaVisita') && n[0] === 'visitas' || (S.view === 'experiencia' || S.view === 'nuevaExperiencia') && n[0] === 'laboratorios';
      return '<button data-go="' + n[0] + '"' + (cur ? ' aria-current="page"' : '') + '>' + n[1] + '</button>';
    }).join('');
  }
  function loading(t) { $('#view').innerHTML = '<div class="loading"><span class="spin"></span>' + esc(t || 'Cargando…') + '</div>'; }

  function stopTimers() { clearInterval(S.tick); S.tick = null; }
  function go(view, id) {
    if (VISTAS_EVAL[view] && !S.boot) view = 'inicio';   // sin rol de evaluación no hay vistas de evaluación
    if (!VISTAS_EVAL[view] && (!HU || !S.hu)) view = S.boot ? (esEval() ? 'visitas' : 'registros') : view;
    if (HU && S.hu && HU.sinSede() && !VISTAS_EVAL[view]) view = 'sede';
    stopTimers();
    S.view = view; S.id = id || null; S.confirm = ''; S.err = ''; S.det = null; S.draft = null; S.rev = null;
    renderNav(); render(); window.scrollTo(0, 0);
  }
  function render() {
    var v = S.view;
    if (HU && S.hu && HU.vistas[v]) return HU.vistas[v]();
    if (v === 'visitas') return vVisitas();
    if (v === 'nuevaVisita') return vNuevaVisita();
    if (v === 'visita') return vDetalle('visita');
    if (v === 'laboratorios') return vLaboratorios();
    if (v === 'nuevaExperiencia') return vNuevaExperiencia();
    if (v === 'experiencia') return vDetalle('experiencia');
    if (v === 'resultados') return vResultados();
    if (v === 'docentes') return vDocentes();
    if (v === 'rubrica') return vRubrica();
    if (v === 'conversacion') return vConversacion();
    if (v === 'registros') return vRegistros();
  }
  function refreshBoot() { return api('bootstrap').then(function (b) { S.boot = b; }); }
  function tb(sub, title, acts, meta) {
    return '<div class="tb"><div class="t"><span class="sub">' + sub + '</span><h1>' + title + '</h1>' + (meta ? '<p class="meta">' + meta + '</p>' : '') + '</div>' + (acts ? '<div class="acts">' + acts + '</div>' : '') + '</div>';
  }
  function trimSelect(id, val) {
    return '<label class="f"><span>Trimestre</span><select id="' + id + '">' + [1, 2, 3].map(function (t) { return '<option value="' + t + '"' + (t === val ? ' selected' : '') + '>Trimestre ' + t + '</option>'; }).join('') + '</select></label>';
  }

  /* ---------------- visitas ---------------- */
  function pendienteMia(v) { return (v.estado === 'abierta' && !v.mia) || (v.estado === 'revision' && v.mia && !v.miaRevisada) || (v.estado === 'consolidada' && v.mia && !v.yoVerifique); }
  function vVisitas() {
    var b = S.boot, ev = esEval(), t = S.filtro.trim || b.config.trimestre;
    var todas = b.visitas.filter(function (v) { return v.trimestre === t; });
    var cuenta = function (f) { return todas.filter(f).length; };
    var cs = [
      ['', 'Todas', todas.length],
      ['pendiente', ev ? 'Te toca a ti' : 'En curso', ev ? cuenta(pendienteMia) : cuenta(function (v) { return v.estado !== 'verificada'; })],
      ['consolidada', 'Por verificar', cuenta(function (v) { return v.estado === 'consolidada'; })],
      ['verificada', 'Verificadas', cuenta(function (v) { return v.estado === 'verificada'; })]
    ];
    var q = S.filtro.q.toLowerCase();
    var lista = todas.filter(function (v) {
      var e = S.filtro.estado;
      if (e === 'pendiente' && !(ev ? pendienteMia(v) : v.estado !== 'verificada')) return false;
      if (e && e !== 'pendiente' && v.estado !== e) return false;
      if (q) { var d = docente(v.docente_id); if ((d.nombre + ' ' + v.asignatura + ' ' + v.curso + ' ' + v.espacio).toLowerCase().indexOf(q) < 0) return false; }
      return true;
    });
    var h = tb('Trimestre ' + t + ' · ' + esc(b.config.anio), 'Visitas', ev ? '<button class="btn" data-go="nuevaVisita">Nueva visita</button>' : '');
    h += '<div class="counts">' + cs.map(function (c) { return '<button class="count" data-act="fEstado" data-v="' + c[0] + '" aria-pressed="' + (S.filtro.estado === c[0]) + '"><b>' + c[2] + '</b><span>' + c[1] + '</span></button>'; }).join('') + '</div>';
    h += '<div class="filters"><label class="f q"><span>Buscar</span><input type="search" id="fq" placeholder="Docente, asignatura, curso o espacio" value="' + esc(S.filtro.q) + '"></label>' + trimSelect('ftrim', t) + '<div></div></div>';
    if (!lista.length) {
      h += '<div class="card empty-state"><span class="strip blue">Sin visitas</span><h2>' + (todas.length ? 'Ninguna visita coincide con el filtro' : 'Aún no hay visitas en el trimestre ' + t) + '</h2><p class="muted">' +
        (ev ? 'Crea la visita al entrar al aula: los tres evaluadores la verán en su iPad y puntuarán por separado.' : 'Las visitas aparecen aquí cuando los evaluadores las registran.') + '</p></div>';
    } else {
      h += '<div class="list">' + lista.map(itemVisita).join('') + '</div>';
    }
    $('#view').innerHTML = h;
  }
  function progresoTxt(v) {
    if (v.estado === 'abierta') return 'Puntuación ' + v.enviadas + ' de ' + v.requeridas;
    if (v.estado === 'revision') return v.marcados + (v.marcados === 1 ? ' criterio' : ' criterios') + ' en revisión';
    if (v.estado === 'consolidada') return 'Verificación ' + v.verificados + ' de ' + v.requeridas;
    return '';
  }
  function itemVisita(v) {
    var d = docente(v.docente_id);
    var res = v.puntaje != null ? cat(v.categoria, v.puntaje) : (esEval() && pendienteMia(v) ? '<span class="chip me">Te toca</span>' : '');
    return '<button class="item" data-go="visita" data-id="' + esc(v.id) + '">' +
      '<div class="when">' + fFecha(v.fecha) + '<span>' + esc(v.hora) + '</span></div>' +
      '<div class="who-d"><b>' + esc(d.nombre) + '</b><span>' + esc([v.asignatura, v.curso, v.subnivel].filter(Boolean).join(' · ')) + '</span></div>' +
      '<div class="what row"><span class="chip">' + esc(v.tipoVisita) + '</span><span class="chip lab-' + esc(v.espacio) + '">' + esc(v.espacio) + '</span></div>' +
      '<div class="st stack" style="gap:4px">' + chipEstado(v.estado) + '<span class="small muted">' + esc(progresoTxt(v)) + '</span></div>' +
      '<div class="res">' + res + '</div></button>';
  }

  function vNuevaVisita() {
    if (!esEval()) return go('visitas');
    var b = S.boot, f = S.form;
    var tiposVisita = b.catalogos.tipos.filter(function (t) { return t !== 'Calibración'; });
    if (!f.inic) { S.form = f = { inic: 1, espacio: 'Aula', tipo: tiposVisita[0], trimestre: b.config.trimestre, fecha: hoy(), hora: ahoraHM() }; }
    var docs = b.docentes.filter(function (d) { return d.activo; });
    var h = tb('Visitas', 'Nueva visita', '<button class="btn ghost" data-go="visitas">Cancelar</button>');
    h += '<p class="lead">Créala al entrar al aula. Los tres evaluadores la verán en su iPad y cada uno puntuará por separado.</p>';
    if (!docs.length) h += '<div class="err">Primero agrega docentes en la sección Docentes.</div>';
    h += '<form class="card stack" id="fVisita" novalidate>' + (S.err ? '<div class="err">' + esc(S.err) + '</div>' : '') +
      '<div class="form">' +
      '<label class="f" style="grid-column:1/-1"><span>Docente</span><select id="nvDoc" required><option value="">Elige un docente</option>' + docs.map(function (d) { return '<option value="' + esc(d.id) + '"' + (f.docente === d.id ? ' selected' : '') + '>' + esc(d.nombre) + (d.asignatura ? ' · ' + esc(d.asignatura) : '') + '</option>'; }).join('') + '</select></label>' +
      '<label class="f"><span>Asignatura</span><input type="text" id="nvAsig" value="' + esc(f.asignatura || '') + '" maxlength="80"></label>' +
      '<label class="f"><span>Curso</span><input type="text" id="nvCurso" placeholder="7.º B" value="' + esc(f.curso || '') + '" maxlength="40"></label>' +
      '<label class="f"><span>Subnivel</span><select id="nvSub">' + ['', 'Elemental', 'Media', 'Superior', 'BGU'].map(function (s) { return '<option value="' + s + '"' + ((f.subnivel || '') === s ? ' selected' : '') + '>' + (s || 'Según el docente') + '</option>'; }).join('') + '</select></label>' +
      '<label class="f"><span>Tipo de visita</span><select id="nvTipo">' + tiposVisita.map(function (t) { return '<option' + (f.tipo === t ? ' selected' : '') + '>' + esc(t) + '</option>'; }).join('') + '</select></label>' +
      trimSelect('nvTrim', f.trimestre) +
      '<label class="f"><span>Fecha</span><input type="date" id="nvFecha" value="' + esc(f.fecha) + '"></label>' +
      '<label class="f"><span>Hora de inicio</span><input type="time" id="nvHora" value="' + esc(f.hora) + '"></label>' +
      '</div><div class="stack" style="gap:6px"><span class="k">Espacio</span><div class="seg">' + b.catalogos.espacios.map(function (e) { return '<button type="button" data-act="nvEsp" data-v="' + esc(e) + '" aria-pressed="' + (f.espacio === e) + '">' + esc(e) + '</button>'; }).join('') + '</div></div>' +
      '<div class="row"><button class="btn" type="submit"' + (S.busy ? ' disabled' : '') + '>Crear visita</button><span class="hint">La rúbrica no se muestra al docente antes de su conversación 1 a 1.</span></div></form>';
    $('#view').innerHTML = h;
  }

  /* ---------------- detalle (visita o experiencia) ---------------- */
  // Si la visita ya se abrió antes, se muestra al instante y se actualiza en segundo plano.
  function vDetalle(tipo) {
    var id = S.id, guardado = S.cacheDet[tipo + ':' + id];
    if (guardado) { S.det = guardado; pintarDetalle(); } else loading();
    if (guardado && !DEMO && guardado._v === S.v) return;   // ya está al día: el vigía avisa si cambia
    api(tipo, { id: id }).then(function (d) {
      var antes = guardado ? firma(guardado) : null;
      fijarDetalle(d, tipo, id);
      if (S.id !== id || S.view !== tipo) return;
      if (!guardado) pintarDetalle();
      else if (firma(d) !== antes && puedeRepintar()) pintarDetalle();
    }).catch(function (e) {
      if (guardado || S.id !== id) return;
      $('#view').innerHTML = '<div class="err">' + esc(e.message) + '</div><p><button class="btn ghost" data-go="' + (tipo === 'visita' ? 'visitas' : 'laboratorios') + '">Volver</button></p>';
    });
  }
  function firma(d) { var r = d.resumen; return [r.estado, r.enviadas, r.verificados, r.marcados, (d.puntuaciones || []).filter(function (p) { return p.revisada; }).length, d.autorreflexion ? d.autorreflexion.respondida + '/' + d.autorreflexion.enviada : ''].join('|'); }
  // Vigía: cada 8 s pregunta solo "¿hubo cambios?" (respuesta mínima). Si los hubo, trae todo en un viaje.
  function vigilar() {
    if (DEMO || !S.boot) return;
    clearInterval(S.watch);
    S.watch = setInterval(revisarCambios, 8000);
    document.addEventListener('visibilitychange', function () { if (!document.hidden) revisarCambios(); });
  }
  function revisarCambios() {
    if (document.hidden || S.busy || S.refrescando || !S.boot) return;
    S.refrescando = true;
    api('version').then(function (r) {
      if (!r || r.v === S.v) return;
      var enDetalle = (S.view === 'visita' || S.view === 'experiencia') && S.det;
      var vista = S.view, id = S.id, antes = enDetalle ? firma(S.det) : '';
      return refrescar(enDetalle).then(function (out) {
        S.boot = out.boot; S.v = out.v; S.resCache = {};
        if (enDetalle && out.det) fijarDetalle(out.det, vista, id);
        if (S.view !== vista || S.id !== id || !puedeRepintar()) return;
        if (enDetalle) { if (out.det && firma(out.det) !== antes) { pintarDetalle(); toast('Hubo cambios: la vista se actualizó.'); } }
        else if (vista === 'visitas' || vista === 'laboratorios' || vista === 'docentes') render();
        else if (vista === 'registros') pintarRegistros();
        else if (vista === 'resultados') vResultados();
      });
    }).catch(function () { }).then(function () { S.refrescando = false; });
  }
  function pasos(r) {
    var i = ['abierta', 'revision', 'consolidada', 'verificada'].indexOf(r.estado);
    var reviso = r.marcados > 0;
    var items = [
      ['Puntuación', i === 0 ? 'now' : 'done', i === 0 ? r.enviadas + '/' + r.requeridas : ''],
      ['Revisión', !reviso ? 'skip' : i === 1 ? 'now' : i > 1 ? 'done' : '', ''],
      ['Consolidada', i >= 2 ? 'done' : '', ''],
      ['Verificada', i === 3 ? 'done' : i === 2 ? 'now' : '', i === 2 ? r.verificados + '/' + r.requeridas : '']
    ];
    return '<div class="steps">' + items.map(function (it, k) {
      return '<span class="step ' + it[1] + '"><i>' + (it[1] === 'done' ? '✓' : k + 1) + '</i>' + it[0] + (it[2] ? ' · ' + it[2] : '') + '</span>';
    }).join('') + '</div>';
  }
  function pintarDetalle() {
    var d = S.det, r = d.resumen, tipo = d.tipo, ev = esEval();
    var doc = docente(r.docente_id);
    var h;
    if (tipo === 'visita') {
      h = tb(esc(r.tipoVisita) + ' · Trimestre ' + r.trimestre, esc(doc.nombre), '<button class="btn ghost" data-go="visitas">Todas las visitas</button>',
        esc([r.asignatura, r.curso, r.subnivel, r.espacio].filter(Boolean).join(' · ')) + ' · ' + fFechaLarga(r.fecha) + ' · ' + esc(r.hora));
    } else {
      h = tb('Laboratorio de Experiencia · Trimestre ' + r.trimestre, esc(r.laboratorio) + ' · ' + esc(doc.nombre), '<button class="btn ghost" data-go="laboratorios">Todas las experiencias</button>',
        esc([r.curso, r.tema].filter(Boolean).join(' · ')) + ' · ' + fFechaLarga(r.fecha));
    }
    h += '<div class="row" style="justify-content:space-between">' + pasos(r) + chipEstado(r.estado) + '</div>';
    if (tipo === 'experiencia') h += panelCuenta(d);
    if (r.estado === 'abierta') {
      if (ev && !r.mia) h += panelPuntuar(tipo);
      else if (ev && r.mia) h += panelEsperando(d, 'Enviaste tu puntuación. Faltan ' + (r.requeridas - r.enviadas) + ' de ' + r.requeridas + ' evaluadores. Los niveles de los demás aparecen cuando puntúen todos.');
      else h += '<div class="card sky"><span class="strip blue">En curso</span><p>Los resultados aparecen cuando los tres evaluadores consolidan.</p></div>';
      if (ev && r.enviadas === 0 && tipo === 'visita') h += panelAnular();
    } else if (r.estado === 'revision') {
      if (ev && r.mia && !r.miaRevisada) h += panelRevision(tipo);
      else if (ev) h += panelEsperando(d, 'Enviaste tu revisión. Los niveles revisados aparecen cuando revisen los tres.');
      else h += '<div class="card sky"><span class="strip blue">En revisión</span><p>Los evaluadores están revisando criterios con 2 o más niveles de diferencia.</p></div>';
    } else {
      h += panelConsolidacion(d);
      if (tipo === 'visita') h += panelInforme(d);
      h += panelEvidencia(d);
    }
    if (tipo === 'visita') h += '<div class="grid2">' + panelAuto(d) + panelReto(d) + '</div>';
    $('#view').innerHTML = h;
    if (S.draft && S.draft.inicio) iniciarTick();
  }
  function panelEsperando(d, texto) {
    var mia = (d.puntuaciones || []).filter(function (p) { return p.propia; })[0];
    var n = d.tipo === 'visita' ? CV : CE;
    var lista = mia ? n.map(function (c, k) { return '<span class="row" style="gap:6px">' + lv((mia.niveles || mia.iniciales)[k], true) + '<span class="small">' + c + '</span></span>'; }).join('') : '';
    return '<div class="card teal"><span class="strip">Tu parte está lista</span><p>' + esc(texto) + '</p>' + (lista ? '<div class="row" style="margin-top:10px;gap:14px">' + lista + '</div>' : '') +
      '<div class="row" style="margin-top:12px"><button class="btn ghost sm" data-act="recargar">Actualizar</button>' + (!DEMO ? '<span class="hint">La vista se actualiza sola cuando alguien puntúa o verifica.</span>' : '<span class="hint">En la demostración, cambia de evaluador arriba para continuar.</span>') + '</div></div>';
  }
  function panelAnular() {
    if (S.confirm === 'anular') return '<div class="confirm"><span>¿Anular esta visita? No tiene puntuaciones.</span><button class="btn coral sm" data-act="anular">Sí, anular</button><button class="btn ghost sm" data-act="noConfirm">No</button></div>';
    return '<div><button class="btn ghost sm" data-act="pedir" data-v="anular">Anular visita creada por error</button></div>';
  }

  /* ---- puntuar ---- */
  function claveDraft(tipo) { return 'rea.borrador.' + tipo + '.' + S.id + '.' + S.boot.usuario.email; }
  function iniciarDraft(tipo) {
    if (S.draft) return;
    var n = tipo === 'visita' ? 6 : 3;
    S.draft = load(claveDraft(tipo)) || { niveles: Array(n).fill(0), evidencias: Array(n).fill(''), muestreo: Array(8).fill(''), respuestas: ['', '', '', ''], inicio: null };
  }
  function guardarDraft() { if (S.det) store(claveDraft(S.det.tipo), S.draft); }
  function panelPuntuar(tipo) {
    iniciarDraft(tipo);
    var ids = tipo === 'visita' ? CV : CE, h = '';
    if (tipo === 'visita') {
      h += '<div class="grid2">' + tarjetaReloj() + tarjetaMuestreo() + '</div>';
      h += tarjetaPreguntas();
    }
    h += ids.map(function (id, k) { return tarjetaCriterio(id, k); }).join('');
    h += '<div class="dock" id="dock">' + dock(ids.length) + '</div>';
    return '<section class="stack" id="puntuar">' + h + '</section>';
  }
  function tarjetaReloj() {
    return '<div class="card clock"><div class="row" style="justify-content:space-between"><span class="strip ink">Reloj de la visita</span><span class="small muted" id="fase">' + (S.draft.inicio ? '' : 'Inícialo al entrar al aula') + '</span></div>' +
      '<div class="row" style="justify-content:space-between;align-items:flex-end"><div class="big" id="reloj">00:00</div>' +
      (S.draft.inicio ? '<button class="btn ghost sm" data-act="relojReset">Reiniciar</button>' : '<button class="btn teal" data-act="relojIni">Iniciar reloj</button>') + '</div>' +
      '<div class="timeline"><i></i><i></i><i></i><span class="cur" id="cur" style="left:0"></span></div>' +
      '<div class="tl-labels"><span>0–25 · Observar</span><span>25–35 · Recorrido</span><span>35–40</span></div></div>';
  }
  function tarjetaMuestreo() {
    var m = S.draft.muestreo;
    var nD = m.filter(function (x) { return x === 'D'; }).length, nE = m.filter(function (x) { return x === 'E'; }).length;
    return '<div class="card stack" style="gap:10px"><div class="row" style="justify-content:space-between"><span class="strip">Muestreo para C2</span><span class="small muted">Toca: D docente · E estudiantes</span></div>' +
      '<div class="samples">' + [5, 10, 15, 20, 25, 30, 35, 40].map(function (min, i) { return '<button class="sample ' + (m[i] || '') + '" data-act="muestra" data-i="' + i + '" aria-label="Minuto ' + min + '"><small>min ' + min + '</small><b>' + (m[i] || '·') + '</b></button>'; }).join('') + '</div>' +
      '<p class="small muted" id="sugC2" style="margin:0">' + sugerenciaC2(nD, nE) + '</p></div>';
  }
  // Los umbrales del muestreo vienen del servidor con el resto de la rúbrica (no están en el código público).
  function sugerenciaC2(nD, nE) {
    var g = REA.muestreoGuia;
    if (nD + nE < g.minimo) return g.textoPoco;
    var ref = nD >= g.n1 ? g.ref1 : nD >= g.n2 ? g.ref2 : nE >= g.n34 ? g.ref34 : g.refNada;
    return 'D ' + nD + ' · E ' + nE + ': ' + ref + '. ' + g.cierre;
  }
  function tarjetaPreguntas() {
    var r = S.draft.respuestas, pf = REA.preguntasFijas;
    return '<div class="card stack" style="gap:10px"><div class="row" style="justify-content:space-between"><span class="strip pink">Recorrido · preguntas fijas</span><span class="small muted">Minutos 25 a 35 · para C1 y C5</span></div>' +
      '<div class="grid2">' + [0, 1].map(function (e) {
        return '<div class="stack" style="gap:8px"><span class="k">Estudiante ' + (e + 1) + '</span>' + pf.map(function (q, j) {
          var i = e * 2 + j;
          return '<label class="f"><span>' + esc(q) + (j === 1 ? ' <span class="muted">(Elemental: ' + esc(REA.preguntaFijaElemental) + ')</span>' : '') + '</span><input type="text" data-in="resp" data-i="' + i + '" maxlength="400" value="' + esc(r[i]) + '"></label>';
        }).join('') + '</div>';
      }).join('') + '</div></div>';
  }
  function tarjetaCriterio(id, k) {
    var c = crit(id), sel = S.draft.niveles[k], dim = REA.dimensiones.filter(function (x) { return x.id === c.dim; })[0];
    var eyebrow = c.momento ? 'Parte B · ' + c.momento : 'Dimensión ' + c.dim + ' · ' + dim.nombre;
    return '<div class="card crit" data-crit="' + k + '"><div class="crit-h"><div><span class="k">' + esc(eyebrow) + '</span><h3>' + id + ' · ' + esc(c.nombre) + '</h3>' + (c.pregunta ? '<p>' + esc(c.pregunta) + '</p>' : '') + '</div>' + (c.llave ? '<span class="key">Criterio llave</span>' : '') + '</div>' +
      '<div class="levels">' + c.niveles.map(function (txt, j) {
        var n = j + 1;
        return '<button class="lvbtn l' + n + '" data-act="nivel" data-k="' + k + '" data-n="' + n + '" aria-pressed="' + (sel === n) + '"><b>' + lv(n, true) + esc(REA.niveles[j]) + '</b><span>' + esc(txt) + '</span></button>';
      }).join('') + '</div>' +
      '<label class="f"><span>Evidencia observada · hechos, citas, productos' + (c.evidencia ? ' <span class="muted">— ' + esc(c.evidencia) + '</span>' : '') + '</span><textarea data-in="evid" data-k="' + k + '" maxlength="2000" placeholder="Ejemplo: 18 de 25 estudiantes copian de la pantalla; la consigna dice «completen la tabla».">' + esc(S.draft.evidencias[k]) + '</textarea></label>' +
      '<span class="warn" data-warn="' + k + '"' + (faltaEvid(k) ? '' : ' hidden') + '>Sin evidencia escrita, el nivel no pasa de 1.</span></div>';
  }
  function faltaEvid(k) { return S.draft.niveles[k] >= 2 && String(S.draft.evidencias[k] || '').trim().length < 3; }
  function dock(n) {
    var listos = S.draft.niveles.filter(Boolean).length;
    var faltan = S.draft.niveles.map(function (x, k) { return faltaEvid(k); }).filter(Boolean).length;
    var ok = listos === n && !faltan;
    var acc = S.confirm === 'enviar'
      ? '<div class="confirm"><span>¿Enviar tu puntuación? Después no podrás cambiarla.</span><button class="btn teal sm" data-act="enviar"' + (S.busy ? ' disabled' : '') + '>Sí, enviar</button><button class="btn ghost sm" data-act="noConfirm">Volver</button></div>'
      : '<button class="btn" data-act="pedir" data-v="enviar"' + (ok ? '' : ' disabled') + '>Enviar mi puntuación</button>';
    return '<div class="card"><div class="progress"><span>' + listos + ' de ' + n + ' criterios' + (faltan ? ' · ' + faltan + ' sin evidencia' : '') + '</span><div class="bar"><i style="width:' + Math.round(listos / n * 100) + '%"></i></div></div>' + acc + '</div>';
  }
  function actualizarDock() { var d = $('#dock'); if (d) d.innerHTML = dock(S.det.tipo === 'visita' ? 6 : 3); }
  function iniciarTick() {
    clearInterval(S.tick);
    var paint = function () {
      if (!S.draft || !S.draft.inicio || !$('#reloj')) { clearInterval(S.tick); return; }
      var s = Math.max(0, Math.floor((Date.now() - S.draft.inicio) / 1000)), m = Math.floor(s / 60);
      $('#reloj').textContent = ('0' + m).slice(-2) + ':' + ('0' + (s % 60)).slice(-2);
      $('#cur').style.left = Math.min(100, s / 2400 * 100) + '%';
      var fase = m < 25 ? 'Observar sin intervenir' : m < 35 ? 'Recorrido silencioso' : m < 40 ? 'Cierre de la clase' : 'Clase terminada: puntúa en silencio';
      var prox = [5, 10, 15, 20, 25, 30, 35, 40].filter(function (x) { return x * 60 > s; })[0];
      $('#fase').textContent = fase + (prox ? ' · próxima marca: min ' + prox : '');
      var idx = Math.min(7, Math.max(0, Math.round(s / 300) - 1));
      $$('.sample').forEach(function (b, i) { b.classList.toggle('now', s >= 270 && i === idx && Math.abs(s - (idx + 1) * 300) <= 45); });
    };
    paint(); S.tick = setInterval(paint, 1000);
  }
  var wake = null;
  function pedirWake() { try { if (navigator.wakeLock) navigator.wakeLock.request('screen').then(function (w) { wake = w; }).catch(function () { }); } catch (e) { } }

  /* ---- revisión ---- */
  function panelRevision(tipo) {
    var d = S.det, ids = tipo === 'visita' ? CV : CE;
    var mia = d.puntuaciones.filter(function (p) { return p.propia; })[0];
    if (!S.rev) { S.rev = { niveles: {}, notas: {} }; d.marcados.forEach(function (k) { S.rev.niveles[k] = mia.iniciales[k]; S.rev.notas[k] = ''; }); }
    var h = '<div class="card cream"><span class="strip amber">Revisión</span><h2>' + d.marcados.length + (d.marcados.length === 1 ? ' criterio tiene' : ' criterios tienen') + ' 2 o más niveles de diferencia</h2><p>Revisen juntos la evidencia durante 5 minutos. Después, cada uno vuelve a puntuar por separado. Los demás criterios quedan como están.</p></div>';
    d.marcados.forEach(function (k) {
      var id = ids[k], c = crit(id);
      h += '<div class="card crit"><div class="crit-h"><div><span class="k">Dispersión inicial: ' + d.dispIni[k] + ' niveles</span><h3>' + id + ' · ' + esc(c.nombre) + '</h3></div>' + (c.llave ? '<span class="key">Criterio llave</span>' : '') + '</div>' +
        '<div class="grid3">' + d.puntuaciones.map(function (p) {
          return '<div class="ev"><span class="ev-who">' + esc(nombreEval(p.evaluador)) + (p.propia ? ' · tú' : '') + '</span><div class="row">' + lv(p.iniciales[k]) + '<span class="small">' + esc(REA.niveles[p.iniciales[k] - 1]) + '</span></div><div class="ev-text">' + (esc(p.evidencias[k]) || '<span class="muted">Sin evidencia escrita</span>') + '</div></div>';
        }).join('') + '</div>' +
        '<span class="k">Tu nuevo nivel</span><div class="levels">' + c.niveles.map(function (txt, j) {
          var n = j + 1;
          return '<button class="lvbtn l' + n + '" data-act="revNivel" data-k="' + k + '" data-n="' + n + '" aria-pressed="' + (S.rev.niveles[k] === n) + '"><b>' + lv(n, true) + esc(REA.niveles[j]) + '</b><span>' + esc(txt) + '</span></button>';
        }).join('') + '</div>' +
        '<label class="f"><span>Nota de revisión (opcional; obligatoria si subes a 2 o más sin evidencia previa)</span><textarea data-in="revNota" data-k="' + k + '" maxlength="1000">' + esc(S.rev.notas[k]) + '</textarea></label></div>';
    });
    var acc = S.confirm === 'revisar'
      ? '<div class="confirm"><span>¿Enviar tu revisión?</span><button class="btn teal sm" data-act="revisar"' + (S.busy ? ' disabled' : '') + '>Sí, enviar</button><button class="btn ghost sm" data-act="noConfirm">Volver</button></div>'
      : '<button class="btn" data-act="pedir" data-v="revisar">Enviar mi revisión</button>';
    h += '<div class="dock"><div class="card"><span class="progress">Revisas ' + d.marcados.length + ' de ' + ids.length + ' criterios</span>' + acc + '</div></div>';
    return '<section class="stack">' + h + '</section>';
  }

  /* ---- consolidación ---- */
  function panelConsolidacion(d) {
    var ids = d.tipo === 'visita' ? CV : CE, r = d.resultado, ps = d.puntuaciones, ev = esEval(), res = d.resumen;
    var filas = ids.map(function (id, k) {
      var marc = d.marcados.indexOf(k) >= 0;
      return '<tr' + (marc ? ' class="flag"' : '') + '><td><b>' + id + '</b> ' + esc(crit(id).nombre) + (marc ? ' <span class="chip revision">Revisado</span>' : '') + '</td>' +
        ps.map(function (p) { var cambio = p.niveles[k] !== p.iniciales[k]; return '<td class="c">' + lv(p.niveles[k], true) + (cambio ? '<div class="small muted">antes ' + p.iniciales[k] + '</div>' : '') + '</td>'; }).join('') +
        '<td class="c n">' + (d.dispIni[k] != null ? d.dispIni[k] : '–') + '</td><td class="c">' + lv(d.medianas[k]) + '</td></tr>';
    }).join('');
    var head = '<tr><th>Criterio</th>' + ps.map(function (p) { return '<th class="c">' + esc(nombreEval(p.evaluador).split(' · ')[0]) + '<div style="font-weight:600;text-transform:none;letter-spacing:0">' + esc(String(p.evaluador).split('@')[0]) + '</div></th>'; }).join('') + '<th class="c">Dispersión</th><th class="c">Mediana</th></tr>';
    var resumen;
    if (d.tipo === 'visita') {
      var topeTxt = r.tope === 'llave' ? '<p class="small"><b>Tope llave aplicado:</b> C2 = ' + d.medianas[1] + ', la categoría no supera ' + esc(C.nombreNivel(d.medianas[1])) + '. Sin tope: ' + num1(r.sinTope) + '.</p>' : '';
      var dims = [['I', 'Diseño pedagógico', C.promedio(d.medianas.slice(0, 3))], ['II', 'Gestión del aula digital', d.medianas[3]], ['III', 'Uso de evidencias', C.promedio(d.medianas.slice(4, 6))]];
      resumen = '<div class="card cream stack" style="gap:10px"><span class="strip amber">Puntaje de la visita</span><div class="score">' + num1(r.puntaje) + '<small> / 100</small></div>' + cat(r.categoria) +
        '<p class="small muted">Suma de medianas ' + r.suma + ' de 24.</p>' + topeTxt +
        '<div class="stack" style="gap:6px">' + dims.map(function (x) { return '<div class="row" style="justify-content:space-between"><span class="small"><b>' + x[0] + '</b> ' + esc(x[1]) + '</span>' + lv(Math.round(x[2])) + '</div>'; }).join('') + '</div></div>';
    } else {
      resumen = '<div class="card cream stack" style="gap:10px"><span class="strip amber">Puntaje de la experiencia</span><div class="score">' + r.suma + '<small> / 12</small></div><p class="small muted">' + (res.cuenta ? 'Cuenta para la Parte B del trimestre.' : 'No cuenta: no tiene ruta y evidencias en el repositorio dentro del plazo.') + '</p></div>';
    }
    var ver = '<div class="stack" style="gap:8px">' + ps.map(function (p) {
      var ok = d.verificadoPor.indexOf(String(p.evaluador).toLowerCase()) >= 0;
      return '<div class="row" style="justify-content:space-between"><span class="small"><b>' + esc(nombreEval(p.evaluador)) + '</b></span>' + (ok ? '<span class="chip verificada"><span class="dot"></span>Verificó</span>' : '<span class="chip">Pendiente</span>') + '</div>';
    }).join('') + '</div>';
    var accion = '';
    if (res.estado === 'consolidada' && ev && res.mia && !res.yoVerifique) {
      accion = S.confirm === 'verificar'
        ? '<div class="confirm"><span>Confirmas que la consolidación es correcta.</span><button class="btn teal sm" data-act="verificar"' + (S.busy ? ' disabled' : '') + '>Sí, verifico</button><button class="btn ghost sm" data-act="noConfirm">Volver</button></div>'
        : '<button class="btn teal" data-act="pedir" data-v="verificar">Verifico esta consolidación</button>';
    } else if (res.estado === 'verificada') {
      accion = '<p class="small muted">Verificada por los tres el ' + fFechaLarga(d.verificada) + '.</p>';
    }
    return '<div class="split">' +
      '<div class="card stack" style="gap:10px"><span class="strip ink">Consolidación</span><div class="scroll"><table class="tbl"><thead>' + head + '</thead><tbody>' + filas + '</tbody></table></div><p class="small muted">Nivel oficial = mediana de los tres. Las filas resaltadas pasaron por revisión.</p></div>' +
      '<div class="stack">' + resumen + '<div class="card stack" style="gap:10px"><span class="strip green">Verificación de los tres</span>' + ver + accion + '</div></div></div>';
  }

  function panelInforme(d) {
    var med = d.medianas;
    var orden = CV.map(function (id, k) { return { id: id, k: k, n: med[k] }; });
    var fort = orden.slice().sort(function (a, b) { return b.n - a.n || a.k - b.k; }).slice(0, 2);
    var dims = REA.dimensiones.filter(function (x) { return !x.parteB; }).map(function (x) {
      var ks = x.criterios.map(function (id) { return CV.indexOf(id); });
      return { dim: x, prom: C.promedio(ks.map(function (k) { return med[k]; })), ks: ks };
    }).sort(function (a, b) { return a.prom - b.prom; });
    var foco = dims[0], fk = foco.ks.slice().sort(function (a, b) { return med[a] - med[b] || a - b; })[0];
    var fc = crit(CV[fk]);
    var sig = med[fk] < 4 ? '<p class="small"><b>Siguiente nivel (' + esc(REA.niveles[med[fk]]) + '):</b> ' + esc(fc.niveles[med[fk]]) + '</p>' : '';
    return '<details class="card teal" open><summary><span class="row"><span class="strip">Para la conversación 1 a 1</span><span>Dos fortalezas y un foco</span></span></summary><div class="grid3" style="margin-top:12px">' +
      fort.map(function (f) { var c = crit(f.id); return '<div class="card"><span class="k">Fortaleza</span><h3>' + f.id + ' · ' + esc(c.nombre) + '</h3><div class="row">' + lv(f.n) + '<span class="small"><b>' + esc(REA.niveles[f.n - 1]) + '</b></span></div><p class="small">' + esc(c.niveles[f.n - 1]) + '</p></div>'; }).join('') +
      '<div class="card cream"><span class="k">Foco · Dimensión ' + foco.dim.id + ' (' + esc(foco.dim.nombre) + ')</span><h3>' + CV[fk] + ' · ' + esc(fc.nombre) + '</h3><div class="row">' + lv(med[fk]) + '<span class="small"><b>' + esc(REA.niveles[med[fk] - 1]) + '</b></span></div><p class="small">' + esc(fc.niveles[med[fk] - 1]) + '</p>' + sig + '</div></div>' +
      '<p class="small muted" style="margin-top:10px">Muestra al docente la rúbrica completa desde la sección Rúbrica. Los niveles no se negocian en la conversación.</p></details>';
  }

  function panelEvidencia(d) {
    var ids = d.tipo === 'visita' ? CV : CE;
    var h = ids.map(function (id, k) {
      return '<div class="stack" style="gap:8px"><h3 style="margin:6px 0 0;font-size:15px">' + id + ' · ' + esc(crit(id).nombre) + ' ' + lv(d.medianas[k], true) + '</h3><div class="grid3">' + d.puntuaciones.map(function (p) {
        return '<div class="ev"><span class="ev-who">' + esc(nombreEval(p.evaluador)) + '</span><div class="ev-text">' + (esc(p.evidencias[k]) || '<span class="muted">—</span>') + '</div></div>';
      }).join('') + '</div></div>';
    }).join('');
    if (d.tipo === 'visita') {
      h += '<div class="stack" style="gap:8px"><h3 style="margin:6px 0 0;font-size:15px">Muestreo y preguntas fijas</h3><div class="grid3">' + d.puntuaciones.map(function (p) {
        var m = p.muestreo || [], r = p.respuestas || [];
        return '<div class="ev"><span class="ev-who">' + esc(nombreEval(p.evaluador)) + '</span><div class="ev-text">Muestreo: ' + (m.map(function (x) { return x || '·'; }).join(' ')) + '\n' +
          REA.preguntasFijas.map(function (q, j) { return q + ' ' + [r[j], r[j + 2]].filter(Boolean).map(function (x) { return '«' + x + '»'; }).join(' / '); }).map(esc).join('\n') + '</div></div>';
      }).join('') + '</div></div>';
    }
    return '<details class="card"><summary><span class="row"><span class="strip blue">Evidencia registrada</span><span>Lo que anotó cada evaluador</span></span></summary><div class="stack" style="margin-top:12px">' + h + '</div></details>';
  }

  function panelAuto(d) {
    var a = d.autorreflexion, ev = esEval();
    var estado = a.respondida ? 'Respondida el ' + fFechaLarga(a.respondida) : a.enviada ? 'Enviada el ' + fFechaLarga(a.enviada) + '; esperando respuesta' : 'Sin enviar';
    var h = '<div class="card stack" style="gap:10px"><span class="strip pink">Autorreflexión del docente</span><p class="small"><b>' + esc(estado) + '</b></p>';
    if (a.respondida) {
      h += REA.autorreflexion.map(function (q, i) { return '<div class="ev"><span class="ev-who">' + esc(q[0]) + '</span><div class="ev-text">' + esc(a.respuestas[i]) + '</div></div>'; }).join('');
    } else if (ev) {
      h += '<p class="small muted">Cuatro preguntas de la Biblioteca de coaching de Apple. El enlace se abre solo con la cuenta institucional del docente y no muestra la rúbrica.</p>';
      h += S.confirm === 'auto'
        ? '<div class="confirm"><span>¿Enviar el correo al docente?</span><button class="btn teal sm" data-act="autoEnviar"' + (S.busy ? ' disabled' : '') + '>Sí, enviar</button><button class="btn ghost sm" data-act="noConfirm">Volver</button></div>'
        : '<div class="row"><button class="btn sm" data-act="pedir" data-v="auto">' + (a.enviada ? 'Reenviar por correo' : 'Enviar por correo') + '</button><button class="btn ghost sm" data-act="copiar">Copiar enlace</button></div>';
      h += '<input type="text" readonly id="enlaceAuto" value="' + esc(d.enlaceAutorreflexion || '') + '" aria-label="Enlace de la autorreflexión">';
    }
    return h + '</div>';
  }

  function panelReto(d) {
    var r = d.reto, ev = esEval();
    var campos = [['objetivos', 'Objetivos · ¿Qué quieres lograr?'], ['acciones', 'Acciones · ¿Cómo lograrás tu objetivo?'], ['fecha', 'Fecha límite · ¿Cuándo prevés que lograrás tu objetivo?'],
      ['pruebas', 'Pruebas · ¿Cómo sabrás que lograste tu objetivo? Enumera los tipos de pruebas que vas a recopilar.'], ['lab', 'Laboratorio y fecha de la observación del reto'], ['recurso', 'Recurso que se creará en conjunto y responsable']];
    var vacio = campos.every(function (c) { return !r[c[0]]; });
    var h = '<div class="card blue stack" style="gap:10px"><span class="strip blue">Acuerdo de reto · Hoja de trabajo de objetivos</span>';
    if (!ev) {
      h += vacio ? '<p class="small muted">Se completa en la conversación 1 a 1.</p>' : campos.map(function (c) { return r[c[0]] ? '<div class="ev"><span class="ev-who">' + esc(c[1]) + '</span><div class="ev-text">' + esc(c[0] === 'fecha' ? fFechaLarga(r[c[0]]) : r[c[0]]) + '</div></div>' : ''; }).join('');
      return h + '</div>';
    }
    h += '<form id="fReto" class="stack" style="gap:10px">' + campos.map(function (c) {
      return '<label class="f"><span>' + esc(c[1]) + '</span>' + (c[0] === 'fecha' ? '<input type="date" id="reto_' + c[0] + '" value="' + esc(r[c[0]]) + '">' : '<textarea id="reto_' + c[0] + '" maxlength="2000">' + esc(r[c[0]]) + '</textarea>') + '</label>';
    }).join('') + '<div><button class="btn sm" type="submit"' + (S.busy ? ' disabled' : '') + '>Guardar acuerdo</button></div></form>';
    return h + '</div>';
  }

  function panelCuenta(d) {
    var r = d.resumen, ev = esEval();
    var enlace = d.enlace ? '<a href="' + esc(d.enlace) + '" target="_blank" rel="noopener">Abrir la carpeta en el repositorio</a>' : '<span class="muted">Sin enlace a la carpeta.</span>';
    var ctrl = ev && r.estado !== 'verificada'
      ? '<div class="seg"><button data-act="cuenta" data-v="1" aria-pressed="' + r.cuenta + '">Sí cuenta</button><button data-act="cuenta" data-v="0" aria-pressed="' + !r.cuenta + '">No cuenta</button></div>'
      : '<span class="chip ' + (r.cuenta ? 'verificada' : '') + '">' + (r.cuenta ? 'Cuenta' : 'No cuenta') + '</span>';
    return '<div class="card sky row" style="justify-content:space-between"><div class="stack" style="gap:4px"><span class="k">Condición de entrada</span><span class="small">Ruta y evidencias en el repositorio dentro de 5 días hábiles. ' + enlace + '</span></div>' + ctrl + '</div>';
  }

  /* ---------------- laboratorios ---------------- */
  function vLaboratorios() {
    var b = S.boot, ev = esEval(), t = S.labFiltro.trim || b.config.trimestre;
    var lista = b.experiencias.filter(function (e) { return e.trimestre === t; });
    var exp = b.config.expectativas[t];
    var h = tb('Parte B · Trimestre ' + t, 'Laboratorios de Experiencia', ev ? '<button class="btn" data-go="nuevaExperiencia">Registrar experiencia</button>' : '');
    h += '<div class="grid3">' + REA.laboratorios.map(function (l, i) {
      var n = lista.filter(function (e) { return e.laboratorio === l.nombre; }).length;
      return '<div class="card ' + ['blue', 'teal', 'pink'][i] + '"><span class="k">' + esc(l.tipo) + '</span><h2 style="margin:4px 0 2px">' + esc(l.nombre) + '</h2><p class="small muted">' + n + (n === 1 ? ' experiencia registrada' : ' experiencias registradas') + ' en el trimestre ' + t + '</p></div>';
    }).join('') + '</div>';
    h += '<div class="row" style="justify-content:space-between"><p class="lead">Cada experiencia se puntúa con B1 Antes, B2 Durante y B3 Después. Solo cuenta si su ruta y sus evidencias están en el repositorio dentro de 5 días hábiles. ' +
      (t === 1 ? '<b>Trimestre 1: línea base de uso espontáneo.</b>' : exp ? '<b>Expectativa mínima: ' + exp + ' por docente.</b>' : '<b>Expectativa mínima sin fijar.</b>') + '</p>' + trimSelect('ltrim', t) + '</div>';
    if (!lista.length) {
      h += '<div class="card empty-state"><span class="strip">Sin experiencias</span><h2>Aún no hay experiencias en el trimestre ' + t + '</h2><p class="muted">' + (ev ? 'Registra cada uso de Panorama, Órbita o Frecuencia con el enlace a su carpeta del repositorio.' : 'Aparecen aquí cuando los evaluadores las registran.') + '</p></div>';
    } else {
      h += '<div class="list">' + lista.map(function (e) {
        var d = docente(e.docente_id);
        var res = e.suma != null ? '<span class="cat c' + Math.min(4, Math.max(1, Math.round(e.suma / 3))) + '"><span class="tab-n">' + e.suma + '</span> / 12</span>' : (ev && pendienteMia(e) ? '<span class="chip me">Te toca</span>' : '');
        return '<button class="item" data-go="experiencia" data-id="' + esc(e.id) + '"><div class="when">' + fFecha(e.fecha) + '<span>' + esc(e.curso) + '</span></div>' +
          '<div class="who-d"><b>' + esc(d.nombre) + '</b><span>' + esc(e.tema || 'Sin tema') + '</span></div>' +
          '<div class="what row"><span class="chip lab-' + esc(e.laboratorio) + '">' + esc(e.laboratorio) + '</span><span class="chip ' + (e.cuenta ? 'verificada' : '') + '">' + (e.cuenta ? 'Cuenta' : 'No cuenta') + '</span></div>' +
          '<div class="st stack" style="gap:4px">' + chipEstado(e.estado) + '<span class="small muted">' + esc(progresoTxt(e)) + '</span></div><div class="res">' + res + '</div></button>';
      }).join('') + '</div>';
    }
    $('#view').innerHTML = h;
  }
  function vNuevaExperiencia() {
    if (!esEval()) return go('laboratorios');
    var b = S.boot, f = S.form;
    if (!f.inicE) { S.form = f = { inicE: 1, laboratorio: 'Panorama', trimestre: S.labFiltro.trim || b.config.trimestre, fecha: hoy(), cuenta: true }; }
    var docs = b.docentes.filter(function (d) { return d.activo; });
    var h = tb('Laboratorios de Experiencia', 'Registrar experiencia', '<button class="btn ghost" data-go="laboratorios">Cancelar</button>');
    h += '<form class="card stack" id="fExp" novalidate>' + (S.err ? '<div class="err">' + esc(S.err) + '</div>' : '') +
      '<div class="stack" style="gap:6px"><span class="k">Laboratorio</span><div class="seg">' + b.catalogos.labs.map(function (l) { return '<button type="button" data-act="neLab" data-v="' + esc(l) + '" aria-pressed="' + (f.laboratorio === l) + '">' + esc(l) + '</button>'; }).join('') + '</div></div>' +
      '<div class="form"><label class="f" style="grid-column:1/-1"><span>Docente</span><select id="neDoc"><option value="">Elige un docente</option>' + docs.map(function (d) { return '<option value="' + esc(d.id) + '">' + esc(d.nombre) + (d.asignatura ? ' · ' + esc(d.asignatura) : '') + '</option>'; }).join('') + '</select></label>' +
      '<label class="f"><span>Fecha de la sesión</span><input type="date" id="neFecha" value="' + esc(f.fecha) + '"></label>' + trimSelect('neTrim', f.trimestre) +
      '<label class="f"><span>Curso</span><input type="text" id="neCurso" maxlength="40" placeholder="9.º A"></label>' +
      '<label class="f"><span>Tema</span><input type="text" id="neTema" maxlength="160"></label>' +
      '<label class="f" style="grid-column:1/-1"><span>Enlace a la carpeta del repositorio</span><input type="url" id="neEnlace" maxlength="500" placeholder="https://drive.google.com/…"></label></div>' +
      '<div class="stack" style="gap:6px"><span class="k">¿Ruta y evidencias en el repositorio dentro de 5 días hábiles?</span><div class="seg"><button type="button" data-act="neCuenta" data-v="1" aria-pressed="' + f.cuenta + '">Sí</button><button type="button" data-act="neCuenta" data-v="0" aria-pressed="' + !f.cuenta + '">Todavía no</button></div></div>' +
      '<div><button class="btn" type="submit"' + (S.busy ? ' disabled' : '') + '>Registrar experiencia</button></div></form>';
    $('#view').innerHTML = h;
  }

  /* ---------------- registros de evaluación ---------------- */
  var PERIODOS = [['', 'Todo'], ['hoy', 'Hoy'], ['7', '7 días'], ['30', '30 días'], ['t1', 'Trimestre 1'], ['t2', 'Trimestre 2'], ['t3', 'Trimestre 3']];
  var ESTADOS = [['', 'Todos'], ['abierta', 'Puntuando'], ['revision', 'En revisión'], ['consolidada', 'Por verificar'], ['verificada', 'Verificada']];
  function codigo(v) { return 'EA-' + String(v.id).slice(0, 6).toUpperCase(); }
  function selectF(id, etiqueta, opciones, valor) {
    return '<label class="f"><span>' + etiqueta + '</span><select id="' + id + '">' + opciones.map(function (o) { return '<option value="' + esc(o[0]) + '"' + (String(valor) === String(o[0]) ? ' selected' : '') + '>' + esc(o[1]) + '</option>'; }).join('') + '</select></label>';
  }
  function vRegistros() {
    var ev = esEval(), f = S.regF, b = S.boot;
    var acts = (DEMO ? '' : '<button class="btn ghost" type="button" data-act="regCsv">Exportar a Excel (CSV)</button>') + (ev ? '<button class="btn" data-go="nuevaVisita">Nueva visita</button>' : '');
    var h = tb('Comité de Experiencias de Aprendizaje', 'Registros de evaluación', acts, 'Todas las visitas con su nota. Toca una fila para abrir la ficha completa.');
    h += '<div id="regKpis"></div>';
    h += '<section class="card stack">' +
      '<div class="toolbar">' +
      '<label class="f q"><span>Buscar</span><input type="search" id="regq" value="' + esc(f.q) + '" placeholder="Docente, asignatura, curso o código" autocomplete="off"></label>' +
      selectF('regSub', 'Subnivel', [['', 'Todos']].concat((b.catalogos.subniveles || []).map(function (s) { return [s, s]; })), f.sub) +
      selectF('regNiv', 'Nivel', [['', 'Todos']].concat(REA.niveles.map(function (n, i) { return [String(i + 1), n]; })).concat([['sin', 'Sin nota aún']]), f.niv) +
      selectF('regEst', 'Estado', ESTADOS, f.est) +
      '</div>' +
      '<div class="row"><div class="seg">' + PERIODOS.map(function (p) { return '<button type="button" data-act="regPer" data-v="' + p[0] + '" aria-pressed="' + (f.per === p[0]) + '">' + p[1] + '</button>'; }).join('') + '</div>' +
      '<span class="muted small" id="regCount" style="margin-left:auto"></span><button class="btn ghost sm" type="button" data-act="regLimpiar">Quitar filtros</button></div>' +
      '</section>';
    h += '<div id="regList"></div>';
    $('#view').innerHTML = h;
    pintarRegistros();
  }
  function regFiltrados() {
    var f = S.regF, q = f.q.trim().toLowerCase(), hoyS = hoy();
    var desde = f.per === 'hoy' ? hoyS : f.per === '7' ? haceDias(6) : f.per === '30' ? haceDias(29) : '';
    return S.boot.visitas.filter(function (v) {
      if (f.sub && v.subnivel !== f.sub) return false;
      if (f.est && v.estado !== f.est) return false;
      if (f.niv === 'sin' && v.categoria) return false;
      if (f.niv && f.niv !== 'sin' && Number(v.categoria) !== Number(f.niv)) return false;
      if (desde && (v.fecha < desde || v.fecha > hoyS)) return false;
      if (/^t[123]$/.test(f.per) && v.trimestre !== Number(f.per.slice(1))) return false;
      if (q) { var d = docente(v.docente_id); if ([d.nombre, v.asignatura, v.curso, v.espacio, v.tipoVisita, codigo(v)].join(' ').toLowerCase().indexOf(q) < 0) return false; }
      return true;
    });
  }
  function autoTag(v) {
    if (v.autoRespondida) return '<span class="chip verificada">Autorreflexión respondida</span>';
    if (v.autoEnviada) return '<span class="chip">Autorreflexión enviada</span>';
    return '';
  }
  function pintarRegistros() {
    var l = regFiltrados(), b = S.boot;
    var conNota = l.filter(function (v) { return v.puntaje != null; });
    var prom = conNota.length ? conNota.reduce(function (a, v) { return a + Number(v.puntaje); }, 0) / conNota.length : null;
    $('#regKpis').innerHTML = '<div class="tiles">' +
      '<div class="tile"><b>' + l.length + '</b><span>Visitas en la lista</span></div>' +
      '<div class="tile"><b>' + conNota.length + '</b><span>Con nota</span></div>' +
      '<div class="tile"><b>' + (prom == null ? '—' : num1(prom)) + '</b><span>Nota promedio · sobre 100</span></div>' +
      '<div class="tile"><b>' + l.filter(function (v) { return v.estado === 'verificada'; }).length + '</b><span>Verificadas por los tres</span></div></div>';
    $('#regCount').textContent = l.length === 1 ? '1 visita' : l.length + ' visitas';
    if (!l.length) {
      $('#regList').innerHTML = '<div class="empty">' + (b.visitas.length ? '<b>Ninguna visita coincide</b>Ajusta o quita los filtros.' : '<b>Todavía no hay visitas registradas</b>' + (esEval() ? 'Registra la primera desde «Nueva visita».' : 'Aparecerán aquí cuando los evaluadores las registren.')) + '</div>';
      return;
    }
    $('#regList').innerHTML = '<div class="tbl-wrap regs-wrap"><table class="tbl regs"><thead><tr><th>Código</th><th>Fecha</th><th>Docente y asignatura</th><th>Curso</th><th>Evaluación</th><th class="c">Nota</th><th>Nivel</th></tr></thead><tbody>' +
      l.map(function (v) {
        var d = docente(v.docente_id);
        var avance = v.estado === 'abierta' ? v.enviadas + ' de ' + v.requeridas + ' puntuaciones' : v.estado === 'consolidada' ? v.verificados + ' de ' + v.requeridas + ' verificaciones' : v.estado === 'revision' ? 'Revisando diferencias' : 'Lista para el 1 a 1';
        return '<tr class="click" data-go="visita" data-id="' + esc(v.id) + '" tabindex="0">' +
          '<td data-l="Código"><span class="code">' + esc(codigo(v)) + '</span></td>' +
          '<td data-l="Fecha" class="n">' + esc(fFecha(v.fecha)) + ' ' + esc(String(v.fecha).slice(0, 4)) + '<span class="sub2">' + esc(v.hora || '') + ' · Trimestre ' + v.trimestre + '</span></td>' +
          '<td data-l="Docente" class="doc"><b>' + esc(d.nombre) + '</b><span class="sub2">' + esc([v.asignatura || d.asignatura, v.tipoVisita].filter(Boolean).join(' · ')) + '</span></td>' +
          '<td data-l="Curso">' + (v.subnivel ? '<span class="chip">' + esc(v.subnivel) + '</span>' : '') + '<span class="sub2">' + esc([v.curso, v.espacio].filter(Boolean).join(' · ')) + '</span></td>' +
          '<td data-l="Evaluación">' + chipEstado(v.estado) + '<span class="sub2">' + esc(avance) + '</span></td>' +
          '<td data-l="Nota" class="c">' + (v.puntaje != null ? '<b class="nota">' + num1(v.puntaje) + '</b><span class="sub2">sobre 100</span>' : '<span class="muted">—</span>') + '</td>' +
          '<td data-l="Nivel"><div class="tags">' + (v.categoria ? cat(v.categoria) : '<span class="muted small">Sin nota aún</span>') + autoTag(v) + '</div></td>' +
          '</tr>';
      }).join('') + '</tbody></table></div>';
  }
  function csvRegistros(l) {
    var celda = function (x) { x = x == null ? '' : String(x); return /[";\n\r]/.test(x) ? '"' + x.replace(/"/g, '""') + '"' : x; };
    var est = { abierta: 'Puntuando', revision: 'En revisión', consolidada: 'Por verificar', verificada: 'Verificada' };
    var filas = [['Código', 'Fecha', 'Hora', 'Trimestre', 'Tipo de visita', 'Docente', 'Asignatura', 'Subnivel', 'Curso', 'Espacio', 'Estado', 'Nota (/100)', 'Nivel', 'Autorreflexión']].concat(l.map(function (v) {
      var d = docente(v.docente_id);
      return [codigo(v), v.fecha, v.hora, v.trimestre, v.tipoVisita, d.nombre, v.asignatura || d.asignatura, v.subnivel, v.curso, v.espacio, est[v.estado] || v.estado,
        v.puntaje != null ? num1(v.puntaje) : '', v.categoria ? REA.niveles[v.categoria - 1] : '', v.autoRespondida ? 'Respondida' : v.autoEnviada ? 'Enviada' : ''];
    }));
    return '﻿' + filas.map(function (r) { return r.map(celda).join(';'); }).join('\r\n');
  }
  /* ---------------- resultados ---------------- */
  function vResultados() {
    var t = S.resTrim || S.boot.config.trimestre, guardado = S.resCache[t];
    if (guardado) { S.res = guardado; pintarResultados(); return; }   // sin cambios desde la última consulta
    loading('Calculando resultados…');
    api('resultados', { trimestre: t }).then(function (r) {
      S.resCache[t] = r;
      if (S.view === 'resultados' && (S.resTrim || S.boot.config.trimestre) === t) { S.res = r; pintarResultados(); }
    }).catch(function (e) { if (S.view === 'resultados') $('#view').innerHTML = '<div class="err">' + esc(e.message) + '</div>'; });
  }
  function pintarResultados() {
    var r = S.res, b = S.boot;
    var con = r.filas.filter(function (f) { return f.resultado; });
    var total = con.length || 1;
    var h = tb('Trimestre ' + r.trimestre + (r.lineaBase ? ' · línea base' : ''), 'Resultados', '', 'Solo cuentan visitas y experiencias verificadas por los tres evaluadores.');
    h += '<div class="row" style="justify-content:space-between">' + '<div class="seg">' + [1, 2, 3].map(function (t) { return '<button data-act="resTrim" data-v="' + t + '" aria-pressed="' + (t === r.trimestre) + '">Trimestre ' + t + '</button>'; }).join('') + '</div></div>';
    h += '<div class="tiles"><div class="tile"><b>' + con.length + ' <small style="font-size:15px;color:var(--ink-2)">de ' + r.filas.length + '</small></b><span>Docentes con visita verificada</span></div>' +
      '<div class="tile"><b>' + r.visitasVerificadas + '</b><span>Visitas verificadas</span></div>' +
      '<div class="tile"><b>' + (r.lineaBase ? 'No aplica' : r.expectativa || 'Sin fijar') + '</b><span>Expectativa mínima de experiencias</span></div>' +
      '<div class="tile"><b>' + (con.length ? num1(C.promedio(con.map(function (f) { return f.resultado.puntaje; }))) : '—') + '</b><span>Puntaje promedio</span></div></div>';
    if (r.lineaBase) h += '<div class="card cream"><p class="small" style="margin:0"><b>Trimestre 1 = línea base.</b> La Parte B registra el uso espontáneo de los laboratorios y el tope de expectativa no se aplica. Sin experiencias que cuenten, el puntaje máximo posible es 70.</p></div>';
    h += '<div class="grid2"><div class="card stack" style="gap:10px"><span class="strip ink">Distribución por categoría</span>' +
      (con.length ? '<div class="distr">' + r.distribucion.map(function (n, i) { return n ? '<i class="c' + (i + 1) + '" style="width:' + (n / total * 100) + '%" title="' + esc(REA.niveles[i]) + ': ' + n + '">' + n + '</i>' : ''; }).join('') + '</div>' : '<p class="muted small">Aún no hay resultados verificados.</p>') +
      '<div class="legend">' + REA.niveles.map(function (n, i) { return '<span><i class="sw" style="background:var(--' + ['coral', 'amber', 'teal', 'blue'][i] + ')"></i>' + esc(n) + ' · ' + r.distribucion[i] + '</span>'; }).join('') + '</div></div>' +
      '<div class="card stack" style="gap:10px"><span class="strip blue">Promedio del colegio por criterio</span><div class="cbars">' + CV.map(function (id, k) {
        var v = r.promedios[k];
        return '<div class="cbar"><span>' + id + ' ' + esc(crit(id).nombre) + '</span><div class="track">' + [1, 2, 3].map(function (x) { return '<i class="tick" style="left:' + (x / 3 * 100) + '%"></i>'; }).join('') + (v ? '<i class="fill" style="width:' + ((v - 1) / 3 * 100) + '%;background:var(--' + ['coral', 'amber', 'teal', 'blue'][Math.min(3, Math.max(0, Math.round(v) - 1))] + ')"></i>' : '') + '</div><span class="v">' + num1(v) + '</span></div>';
      }).join('') + '</div><div class="ticks"><span></span><div><span>1</span><span>2</span><span>3</span><span>4</span></div><span></span></div></div></div>';
    var q = S.resQ.toLowerCase();
    var filas = r.filas.filter(function (f) { return !q || (f.docente.nombre + ' ' + f.docente.asignatura).toLowerCase().indexOf(q) >= 0; });
    filas.sort(function (a, b) {
      if (S.resOrden === 'nombre') return a.docente.nombre.localeCompare(b.docente.nombre, 'es');
      var x = a.resultado ? a.resultado.puntaje : -1, y = b.resultado ? b.resultado.puntaje : -1;
      return S.resOrden === 'asc' ? (x < 0 ? 1 : y < 0 ? -1 : x - y) : y - x;
    });
    h += '<div class="filters"><label class="f q"><span>Buscar docente</span><input type="search" id="rq" value="' + esc(S.resQ) + '" placeholder="Nombre o asignatura"></label><label class="f"><span>Ordenar</span><select id="rord"><option value="desc"' + (S.resOrden === 'desc' ? ' selected' : '') + '>Puntaje, mayor primero</option><option value="asc"' + (S.resOrden === 'asc' ? ' selected' : '') + '>Puntaje, menor primero</option><option value="nombre"' + (S.resOrden === 'nombre' ? ' selected' : '') + '>Nombre</option></select></label><div></div></div>';
    h += '<div class="scroll"><table class="tbl"><thead><tr><th>Docente</th><th class="c">Visitas</th><th class="c">Parte A /24</th><th class="c">Parte B /12</th><th class="c">Sin tope</th><th>Topes</th><th class="c">Puntaje</th><th>Categoría</th><th class="c">I</th><th class="c">II</th><th class="c">III</th><th class="c">IV</th></tr></thead><tbody>' +
      filas.map(function (f) {
        var x = f.resultado, d = f.docente;
        var nom = '<td><b>' + esc(d.nombre) + '</b><div class="small muted">' + esc([d.asignatura, d.subnivel].filter(Boolean).join(' · ')) + '</div></td>';
        if (!x) return '<tr>' + nom + '<td class="c n">0</td><td colspan="10" class="muted small">Sin visitas verificadas en este trimestre</td></tr>';
        var topes = x.topes.filter(function (t) { return t.efecto; }).map(function (t) { return t.tipo === 'llave' ? 'Llave (C2 = ' + x.c2 + ')' : 'Expectativa'; }).join(', ') || '—';
        return '<tr>' + nom + '<td class="c n">' + f.visitas + '</td><td class="c n">' + num1(x.parteA) + '</td><td class="c n">' + (x.experiencias ? num1(x.parteB) + ' <span class="small muted">(' + x.experiencias + ')</span>' : '0') + '</td><td class="c n">' + num1(x.sinTope) + '</td><td class="small">' + esc(topes) + '</td><td class="c n"><b>' + num1(x.puntaje) + '</b></td><td>' + cat(x.categoria) + '</td>' +
          ['I', 'II', 'III', 'IV'].map(function (k) { return '<td class="c n">' + num1(x.dims[k]) + '</td>'; }).join('') + '</tr>';
      }).join('') + '</tbody></table></div>';
    h += '<p class="small muted">I Diseño pedagógico · II Gestión del aula digital · III Uso de evidencias · IV Integración de espacios. Promedios en la escala 1–4: la dimensión más baja indica el módulo de formación que corresponde.</p>';
    $('#view').innerHTML = h;
  }

  /* ---------------- docentes ---------------- */
  function vDocentes() {
    var b = S.boot, ev = esEval();
    var vis = {}; b.visitas.forEach(function (v) { vis[v.docente_id] = (vis[v.docente_id] || 0) + 1; });
    var e = S.editDoc || {};
    var h = tb(b.docentes.length + ' docentes registrados', 'Docentes', '');
    if (ev) {
      h += '<div class="grid2"><form class="card stack" id="fDoc" novalidate><span class="strip">' + (e.id ? 'Editar docente' : 'Agregar docente') + '</span>' + (S.err ? '<div class="err">' + esc(S.err) + '</div>' : '') +
        '<div class="form"><label class="f" style="grid-column:1/-1"><span>Nombre completo</span><input type="text" id="dNom" maxlength="120" value="' + esc(e.nombre || '') + '"></label>' +
        '<label class="f"><span>Correo institucional</span><input type="email" id="dMail" maxlength="120" value="' + esc(e.email || '') + '"></label>' +
        '<label class="f"><span>Asignatura principal</span><input type="text" id="dAsig" maxlength="80" value="' + esc(e.asignatura || '') + '"></label>' +
        '<label class="f"><span>Subnivel</span><select id="dSub">' + ['', 'Elemental', 'Media', 'Superior', 'BGU'].map(function (s) { return '<option value="' + s + '"' + ((e.subnivel || '') === s ? ' selected' : '') + '>' + (s || 'Sin definir') + '</option>'; }).join('') + '</select></label>' +
        '<label class="f"><span>Estado</span><select id="dAct"><option value="si"' + (e.activo !== false ? ' selected' : '') + '>Activo</option><option value="no"' + (e.activo === false ? ' selected' : '') + '>Inactivo</option></select></label></div>' +
        '<div class="row"><button class="btn" type="submit"' + (S.busy ? ' disabled' : '') + '>' + (e.id ? 'Guardar cambios' : 'Agregar docente') + '</button>' + (e.id ? '<button class="btn ghost" type="button" data-act="docNuevo">Cancelar edición</button>' : '') + '</div></form>' +
        '<form class="card stack" id="fImp" novalidate><span class="strip blue">Importar lista</span><p class="small muted" style="margin:0">Una línea por docente: nombre; correo; asignatura; subnivel. Puedes pegar las columnas desde una hoja de cálculo.</p><textarea id="dImp" style="min-height:130px" placeholder="María Pérez; mperez@eightacademy.edu.ec; Matemática; Media"></textarea><div><button class="btn ghost" type="submit"' + (S.busy ? ' disabled' : '') + '>Importar</button></div></form></div>';
    }
    if (!b.docentes.length) {
      h += '<div class="card empty-state"><span class="strip">Sin docentes</span><h2>La lista de docentes está vacía</h2><p class="muted">' + (ev ? 'Agrega docentes uno por uno o importa la lista completa.' : 'Los evaluadores la cargan.') + '</p></div>';
    } else {
      h += '<div class="scroll"><table class="tbl"><thead><tr><th>Nombre</th><th>Correo</th><th>Asignatura</th><th>Subnivel</th><th class="c">Visitas</th><th>Estado</th></tr></thead><tbody>' + b.docentes.map(function (d) {
        return '<tr' + (ev ? ' class="click" data-act="docEditar" data-id="' + esc(d.id) + '"' : '') + '><td><b>' + esc(d.nombre) + '</b></td><td class="small">' + esc(d.email || '—') + '</td><td>' + esc(d.asignatura || '—') + '</td><td>' + esc(d.subnivel || '—') + '</td><td class="c n">' + (vis[d.id] || 0) + '</td><td>' + (d.activo ? '<span class="chip verificada"><span class="dot"></span>Activo</span>' : '<span class="chip">Inactivo</span>') + '</td></tr>';
      }).join('') + '</tbody></table></div>';
      if (ev) h += '<p class="small muted">Toca una fila para editarla. El correo es el que se usa para la autorreflexión.</p>';
    }
    $('#view').innerHTML = h;
  }

  /* ---------------- consulta ---------------- */
  function tablaNiveles(id) {
    var c = crit(id);
    return '<div class="scroll"><table class="tbl rub"><thead><tr><th>Nivel</th><th>Descriptor</th></tr></thead><tbody>' + c.niveles.map(function (t, j) {
      return '<tr><td><span class="row" style="gap:8px">' + lv(j + 1, true) + esc(REA.niveles[j]) + '</span></td><td>' + esc(t) + '</td></tr>';
    }).join('') + '</tbody></table></div>';
  }
  function vRubrica() {
    var h = tb('Comité de Experiencias de Aprendizaje', 'Rúbrica EA', '', 'Mide lo que hacen y aprenden los estudiantes en cada visita y cómo cada docente integra los Laboratorios de Experiencia en el trimestre.');
    h += '<div class="card cream"><span class="strip amber">Principios que no se negocian</span><ul class="prose">' + REA.principios.map(function (p) { return '<li>' + esc(p) + '</li>'; }).join('') + '</ul></div>';
    REA.dimensiones.forEach(function (d, i) {
      h += '<section class="card stack" style="gap:14px"><div class="row"><span class="strip ' + ['', 'blue', 'pink', 'green'][i] + '">Dimensión ' + d.id + (d.parteB ? ' · Parte B, por trimestre' : ' · Parte A, cada visita') + '</span><h2 style="margin:0;font-size:21px">' + esc(d.nombre) + '</h2></div>';
      if (d.parteB) h += '<p class="small" style="margin:0"><b>Condición de entrada:</b> una experiencia en Panorama, Órbita o Frecuencia cuenta solo si su ruta y sus evidencias están en el repositorio dentro de 5 días hábiles.</p>';
      d.criterios.forEach(function (id) {
        var c = crit(id);
        h += '<div class="stack" style="gap:8px"><div class="crit-h"><div><h3>' + id + ' · ' + (c.momento ? esc(c.momento) + ': ' : '') + esc(c.nombre) + '</h3>' + (c.pregunta ? '<p>' + esc(c.pregunta) + '</p>' : '') + '</div>' + (c.llave ? '<span class="key">Criterio llave</span>' : '') + '</div>' + tablaNiveles(id) +
          (c.evidencia ? '<p class="small muted" style="margin:0"><b>Evidencia:</b> ' + esc(c.evidencia) + '</p>' : '') + (c.llave ? '<p class="small" style="margin:0"><b>Regla llave:</b> la categoría de una visita nunca supera el nivel de C2.</p>' : '') + '</div>';
      });
      h += '</section>';
    });
    h += '<section class="card stack" style="gap:12px"><span class="strip ink">Puntuación</span><ul class="prose" style="margin:0"><li>Cada evaluador asigna un nivel de 1 a 4 por criterio, solo y en silencio. El nivel oficial es la mediana de los tres.</li><li>Lo que no se observa no se puntúa por encima de 1. Cada nivel 2, 3 o 4 se justifica con evidencia escrita.</li><li>Ante la duda entre dos niveles, se asigna el inferior.</li></ul>' +
      '<div class="formula">Visita = (C1 + … + C6) ÷ 24 × 100</div><div class="formula">Trimestre = (Parte A ÷ 24) × 70 + (Parte B ÷ 12) × 30</div>' +
      '<p class="small" style="margin:0">Parte A del trimestre = promedio de la suma C1–C6 de las visitas oficiales. Parte B = promedio de B1 + B2 + B3 de las experiencias que cuentan; si ninguna cuenta, vale 0.</p>' +
      '<div class="scroll"><table class="tbl"><thead><tr><th>Categoría</th><th>Puntaje</th><th>Referencia</th></tr></thead><tbody>' + REA.categorias.map(function (c, i) { return '<tr><td>' + cat(i + 1) + '</td><td class="n">' + esc(c.rango) + '</td><td>' + esc(c.ref) + '</td></tr>'; }).join('') + '</tbody></table></div>' +
      '<h3 style="margin:6px 0 0">Topes (si se aplican los dos, vale el menor)</h3><ul class="prose" style="margin:0"><li><b>Tope llave:</b> la categoría no supera el nivel de C2. En el trimestre se usa el promedio de C2 de las visitas oficiales, redondeado hacia abajo.</li><li><b>Tope de expectativa mínima (desde el trimestre 2):</b> si el docente no alcanza el número de experiencias que fija la Dirección, la categoría no pasa de En transición.</li><li>Con un tope, el puntaje se recorta al máximo de esa categoría: 37,4 · 62,4 · 87,4.</li></ul>' +
      '<p class="small" style="margin:0"><b>Trimestre 1 = línea base.</b> La Parte B registra el uso espontáneo y el tope de expectativa no se aplica.</p>' +
      '<h3 style="margin:6px 0 0">Ejemplos calculados</h3><div class="scroll"><table class="tbl"><thead><tr><th>Caso</th><th>Medianas C1–C6</th><th>Parte B</th><th class="c">Sin tope</th><th>Tope</th><th>Resultado</th></tr></thead><tbody>' + REA.ejemplos.map(function (e) { return '<tr>' + e.map(function (x, i) { return '<td' + (i === 3 ? ' class="c n"' : '') + '>' + esc(x) + '</td>'; }).join('') + '</tr>'; }).join('') + '</tbody></table></div></section>';
    $('#view').innerHTML = h;
  }
  function vConversacion() {
    var h = tb('Después de cada visita', 'Conversación 1 a 1', '', 'Primero se escucha y después se devuelve. Las preguntas con página son de la Biblioteca de coaching de Apple.');
    h += '<section class="card stack" style="gap:10px"><span class="strip pink">Autorreflexión · se responde antes de la conversación</span><div class="scroll"><table class="tbl"><thead><tr><th class="c">#</th><th>Pregunta</th><th>Origen</th></tr></thead><tbody>' + REA.autorreflexion.map(function (q, i) { return '<tr><td class="c n">' + (i + 1) + '</td><td><b>' + esc(q[0]) + '</b></td><td class="small">' + esc(q[1]) + '</td></tr>'; }).join('') + '</tbody></table></div></section>';
    h += '<section class="card stack" style="gap:10px"><span class="strip ink">Seis momentos · unos 32 minutos</span><div class="scroll"><table class="tbl" style="min-width:720px"><thead><tr><th>Momento</th><th class="c">Min.</th><th>Propósito</th><th>Preguntas y acciones</th></tr></thead><tbody>' + REA.conversacion.map(function (m, i) { return '<tr><td><span class="row" style="gap:8px;flex-wrap:nowrap"><span class="num n' + (i % 6 + 1) + '">' + (i + 1) + '</span><b>' + esc(m[0]) + '</b></span></td><td class="c n">' + esc(m[1]) + '</td><td>' + esc(m[2]) + '</td><td class="small">' + esc(m[3]) + '</td></tr>'; }).join('') + '</tbody></table></div></section>';
    h += '<div class="grid2"><section class="card blue stack" style="gap:8px"><span class="strip blue">Cierre del trimestre · pág. 22</span><ol class="prose" style="margin:0">' + REA.cierreTrimestre.map(function (q) { return '<li>' + esc(q) + '</li>'; }).join('') + '</ol></section>' +
      '<section class="card stack" style="gap:8px"><span class="strip">Registro de necesidades</span><p class="small muted" style="margin:0">La Dirección recibe solo el conteo por categoría, sin nombres.</p><div class="scroll"><table class="tbl"><thead><tr><th>Categoría</th><th>Ejemplo</th></tr></thead><tbody>' + REA.necesidades.map(function (n) { return '<tr><td><b>' + esc(n[0]) + '</b></td><td class="small">' + esc(n[1]) + '</td></tr>'; }).join('') + '</tbody></table></div></section></div>';
    h += '<p class="small muted">El acuerdo de reto (Hoja de trabajo de objetivos, pág. 11) se registra en cada visita, en la sección Visitas.</p>';
    $('#view').innerHTML = h;
  }
  /* ---------------- acciones ---------------- */
  function trabajar(promesa, ok) {
    S.busy = true;
    return promesa.then(function (r) { S.busy = false; S.err = ''; if (ok) ok(r); return r; })
      .catch(function (e) { S.busy = false; S.err = e.message; S.confirm = ''; toast(e.message, true); render2(); });
  }
  function render2() { if (S.view === 'visita' || S.view === 'experiencia') { if (S.det) pintarDetalle(); } else render(); }
  // Escribe y repinta el detalle con lo que devuelve el servidor (un solo viaje).
  function escribirDetalle(accion, datos, msg, antes) {
    return trabajar(escribir(accion, datos, true), function (out) {
      if (antes) antes(out);
      aplicar(out); S.confirm = ''; pintarDetalle(); if (msg) toast(typeof msg === 'function' ? msg(out) : msg);
    });
  }
  function recargarDetalle(msg) {
    return refrescar(true).then(function (out) { aplicar(out); S.confirm = ''; pintarDetalle(); if (msg) toast(msg); })
      .catch(function (e) { toast(e.message, true); });
  }

  document.addEventListener('click', function (ev) {
    if (HU && S.hu && HU.click(ev)) return;
    var g = ev.target.closest('[data-go]');
    if (g) { ev.preventDefault(); if (g.dataset.go === 'nuevaVisita' || g.dataset.go === 'nuevaExperiencia') S.form = {}; go(g.dataset.go, g.dataset.id); return; }
    var a = ev.target.closest('[data-act]');
    if (!a) return;
    var act = a.dataset.act, v = a.dataset.v;
    if (act === 'fEstado') { S.filtro.estado = v; vVisitas(); return; }
    if (act === 'nvEsp') { S.form.espacio = v; $$('[data-act="nvEsp"]').forEach(function (b) { b.setAttribute('aria-pressed', b.dataset.v === v); }); return; }
    if (act === 'neLab') { S.form.laboratorio = v; $$('[data-act="neLab"]').forEach(function (b) { b.setAttribute('aria-pressed', b.dataset.v === v); }); return; }
    if (act === 'neCuenta') { S.form.cuenta = v === '1'; $$('[data-act="neCuenta"]').forEach(function (b) { b.setAttribute('aria-pressed', b.dataset.v === v); }); return; }
    if (act === 'resTrim') { S.resTrim = Number(v); vResultados(); return; }
    if (act === 'regPer') { S.regF.per = v; $$('[data-act="regPer"]').forEach(function (x) { x.setAttribute('aria-pressed', x.dataset.v === v); }); pintarRegistros(); return; }
    if (act === 'regLimpiar') { S.regF = { q: '', sub: '', niv: '', est: '', per: '' }; vRegistros(); return; }
    if (act === 'regCsv') { descargar('registros-ea-conecta-' + hoy() + '.csv', csvRegistros(regFiltrados())); toast('Archivo descargado: ábrelo con Excel o Numbers.'); return; }
    if (act === 'pedir') { S.confirm = v; if (v === 'enviar') actualizarDock(); else pintarDetalle(); return; }
    if (act === 'noConfirm') { var era = S.confirm; S.confirm = ''; if (era === 'enviar') actualizarDock(); else pintarDetalle(); return; }
    if (act === 'recargar') { recargarDetalle('Vista actualizada.'); return; }
    if (act === 'nivel') {
      var k = Number(a.dataset.k), n = Number(a.dataset.n);
      S.draft.niveles[k] = n; guardarDraft();
      $$('[data-act="nivel"][data-k="' + k + '"]').forEach(function (b) { b.setAttribute('aria-pressed', Number(b.dataset.n) === n); });
      var w = $('[data-warn="' + k + '"]'); if (w) w.hidden = !faltaEvid(k);
      S.confirm = ''; actualizarDock(); return;
    }
    if (act === 'muestra') {
      var i = Number(a.dataset.i), cur = S.draft.muestreo[i], nx = cur === '' ? 'D' : cur === 'D' ? 'E' : '';
      S.draft.muestreo[i] = nx; guardarDraft();
      a.className = 'sample ' + nx; a.querySelector('b').textContent = nx || '·';
      var m = S.draft.muestreo; $('#sugC2').textContent = sugerenciaC2(m.filter(function (x) { return x === 'D'; }).length, m.filter(function (x) { return x === 'E'; }).length);
      return;
    }
    if (act === 'relojIni') { S.draft.inicio = Date.now(); guardarDraft(); pedirWake(); pintarDetalle(); return; }
    if (act === 'relojReset') { S.draft.inicio = null; guardarDraft(); clearInterval(S.tick); pintarDetalle(); return; }
    if (act === 'enviar') {
      var d = S.det;
      escribirDetalle('enviarPuntuacion', { tipo: d.tipo, id: S.id, niveles: S.draft.niveles, evidencias: S.draft.evidencias, muestreo: S.draft.muestreo, respuestas: S.draft.respuestas }, 'Puntuación enviada.', function () {
        store(claveDraft(d.tipo)); S.draft = null; clearInterval(S.tick); S.tick = null; try { if (wake) wake.release(); } catch (e) { }
      });
      return;
    }
    if (act === 'revNivel') {
      var rk = Number(a.dataset.k), rn = Number(a.dataset.n); S.rev.niveles[rk] = rn;
      $$('[data-act="revNivel"][data-k="' + rk + '"]').forEach(function (b) { b.setAttribute('aria-pressed', Number(b.dataset.n) === rn); });
      return;
    }
    if (act === 'revisar') {
      escribirDetalle('enviarRevision', { tipo: S.det.tipo, id: S.id, niveles: S.rev.niveles, notas: S.rev.notas }, 'Revisión enviada.', function () { S.rev = null; });
      return;
    }
    if (act === 'verificar') { escribirDetalle('verificar', { tipo: S.det.tipo, id: S.id }, 'Verificación registrada.'); return; }
    if (act === 'anular') {
      var anulada = S.id;
      trabajar(escribir('anularVisita', { id: S.id }), function (out) { aplicar(out); delete S.cacheDet['visita:' + anulada]; go('visitas'); toast('Visita anulada.'); });
      return;
    }
    if (act === 'autoEnviar') {
      escribirDetalle('enviarAutorreflexion', { id: S.id }, function (out) {
        return DEMO ? 'En el portal publicado, aquí sale el correo a ' + out.r.para + '.' : 'Correo enviado a ' + out.r.para + '. Queda en tus Enviados de Gmail.';
      });
      return;
    }
    if (act === 'salir') { if (window.REA_WEB) window.REA_WEB.salir(); return; }
    if (act === 'copiar') {
      var inp = $('#enlaceAuto'); if (!inp) return;
      var copiado = function () { toast('Enlace copiado.'); };
      try { navigator.clipboard.writeText(inp.value).then(copiado).catch(function () { inp.select(); toast('Selecciona y copia el enlace.'); }); } catch (e) { inp.select(); toast('Selecciona y copia el enlace.'); }
      return;
    }
    if (act === 'cuenta') { escribirDetalle('actualizarCuenta', { id: S.id, cuenta: v === '1' }, 'Actualizado.'); return; }
    if (act === 'docEditar') { S.editDoc = S.boot.docentes.filter(function (d) { return d.id === a.dataset.id; })[0]; S.err = ''; vDocentes(); window.scrollTo(0, 0); return; }
    if (act === 'docNuevo') { S.editDoc = null; S.err = ''; vDocentes(); return; }
  });

  document.addEventListener('keydown', function (ev) {
    if (ev.key !== 'Enter') return;
    var fila = ev.target.closest && ev.target.closest('tr[data-go]');
    if (fila) { ev.preventDefault(); fila.click(); }
  });

  document.addEventListener('input', function (ev) {
    if (HU && S.hu && HU.input(ev)) return;
    var t = ev.target;
    if (t.dataset.in === 'evid') { var k = Number(t.dataset.k); S.draft.evidencias[k] = t.value; guardarDraft(); var w = $('[data-warn="' + k + '"]'); if (w) w.hidden = !faltaEvid(k); actualizarDockLigero(); return; }
    if (t.dataset.in === 'resp') { S.draft.respuestas[Number(t.dataset.i)] = t.value; guardarDraft(); return; }
    if (t.dataset.in === 'revNota') { S.rev.notas[Number(t.dataset.k)] = t.value; return; }
    if (t.id === 'fq') { S.filtro.q = t.value; var pos = t.selectionStart; vVisitas(); var n = $('#fq'); n.focus(); try { n.setSelectionRange(pos, pos); } catch (e) { } return; }
    if (t.id === 'regq') { S.regF.q = t.value; pintarRegistros(); return; }
    if (t.id === 'rq') { S.resQ = t.value; var p2 = t.selectionStart; pintarResultados(); var r = $('#rq'); r.focus(); try { r.setSelectionRange(p2, p2); } catch (e) { } return; }
  });
  var dockT;
  function actualizarDockLigero() { clearTimeout(dockT); dockT = setTimeout(function () { if (S.confirm !== 'enviar') actualizarDock(); }, 250); }

  document.addEventListener('change', function (ev) {
    if (HU && S.hu && HU.change(ev)) return;
    var t = ev.target;
    if (t.id === 'ftrim') { S.filtro.trim = Number(t.value); vVisitas(); return; }
    if (t.id === 'ltrim') { S.labFiltro.trim = Number(t.value); vLaboratorios(); return; }
    if (t.id === 'rord') { S.resOrden = t.value; pintarResultados(); return; }
    if (t.id === 'regSub' || t.id === 'regNiv' || t.id === 'regEst') { S.regF[{ regSub: 'sub', regNiv: 'niv', regEst: 'est' }[t.id]] = t.value; pintarRegistros(); return; }
    if (t.id === 'nvDoc') {
      S.form.docente = t.value; var d = docente(t.value);
      if (t.value) { $('#nvAsig').value = d.asignatura || ''; $('#nvSub').value = d.subnivel || ''; }
      return;
    }
    if (t.id === 'demoUser') {
      window.REA_DEMO.actual = Number(t.value);
      S.cacheDet = {}; S.resCache = {};   // lo guardado era desde la vista de otra persona
      if (HU) HU.reiniciar();
      api('inicio').then(function (o) {
        S.boot = o.boot || null; S.hu = o.hu || null;
        renderWho();
        var vista = S.view, id = S.id;
        if (VISTAS_EVAL[vista] && S.boot) go(S.boot.usuario.role === 'evaluador' ? vista : (vista === 'nuevaVisita' || vista === 'nuevaExperiencia' ? 'registros' : vista), id);
        else go(S.hu && !S.hu.usuario.sede ? 'sede' : 'inicio');
      });
    }
  });

  document.addEventListener('submit', function (ev) {
    ev.preventDefault();
    if (HU && S.hu && HU.submit(ev)) return;
    var f = ev.target;
    if (f.id === 'fVisita') {
      var datos = { docente_id: $('#nvDoc').value, asignatura: $('#nvAsig').value, curso: $('#nvCurso').value, subnivel: $('#nvSub').value, tipo: $('#nvTipo').value, trimestre: Number($('#nvTrim').value), fecha: $('#nvFecha').value, hora: $('#nvHora').value, espacio: S.form.espacio };
      Object.assign(S.form, { docente: datos.docente_id, asignatura: datos.asignatura, curso: datos.curso, subnivel: datos.subnivel, tipo: datos.tipo, trimestre: datos.trimestre, fecha: datos.fecha, hora: datos.hora });
      trabajar(escribir('crearVisita', abrirAl(datos, 'visita')), function (out) { aplicar(out); if (out.det) fijarDetalle(out.det, 'visita', out.r.id); S.form = {}; go('visita', out.r.id); toast('Visita creada. Ya pueden puntuar los tres.'); });
    }
    if (f.id === 'fExp') {
      var e = { docente_id: $('#neDoc').value, fecha: $('#neFecha').value, trimestre: Number($('#neTrim').value), curso: $('#neCurso').value, tema: $('#neTema').value, enlace: $('#neEnlace').value.trim(), laboratorio: S.form.laboratorio, cuenta: S.form.cuenta };
      trabajar(escribir('crearExperiencia', abrirAl(e, 'experiencia')), function (out) { aplicar(out); if (out.det) fijarDetalle(out.det, 'experiencia', out.r.id); S.form = {}; go('experiencia', out.r.id); toast('Experiencia registrada.'); });
    }
    if (f.id === 'fReto') {
      var r = { id: S.id }; ['objetivos', 'acciones', 'fecha', 'pruebas', 'lab', 'recurso'].forEach(function (k) { r[k] = $('#reto_' + k).value; });
      escribirDetalle('guardarReto', r, 'Acuerdo de reto guardado.');
    }
    if (f.id === 'fDoc') {
      var d = { id: S.editDoc ? S.editDoc.id : '', nombre: $('#dNom').value, email: $('#dMail').value, asignatura: $('#dAsig').value, subnivel: $('#dSub').value, activo: $('#dAct').value === 'si' };
      S.editDoc = Object.assign({}, S.editDoc || {}, d);
      trabajar(escribir('guardarDocente', d), function (out) { aplicar(out); S.editDoc = null; vDocentes(); toast('Docente guardado.'); });
    }
    if (f.id === 'fImp') {
      trabajar(escribir('importarDocentes', { texto: $('#dImp').value }), function (out) {
        var r = out.r; aplicar(out); vDocentes();
        toast(r.agregados + ' docentes agregados' + (r.omitidos.length ? '. Omitidos: ' + r.omitidos.slice(0, 3).join('; ') + (r.omitidos.length > 3 ? '…' : '') : '.'), r.omitidos.length > 0);
      });
    }
  });

  /* ---------------- arranque ---------------- */
  // Docentes y evaluadores entran al Inicio del portal (si aún no eligieron sede, primero la sede).
  function abrir() {
    shell(); renderWho();
    if (S.hu) go(S.hu.usuario.sede ? 'inicio' : 'sede');
    else { go(esEval() ? 'visitas' : 'registros'); if (S.huError) toast('Huella de clases no está disponible: ' + S.huError, true); }
    vigilar();
  }
  function iniciar() {
    if (DEMO) {
      $('#app').innerHTML = '<div class="loading" style="justify-content:center;padding:80px 16px"><span class="spin"></span>Abriendo EA Conecta…</div>';
      api('inicio').then(function (o) { S.boot = o.boot || null; S.hu = o.hu || null; abrir(); }).catch(function (e) {
        $('#app').innerHTML = '<div class="wrap gut" style="padding-block:60px"><div class="err">' + esc(e.message) + '</div></div>';
      });
      return;
    }
    window.REA_WEB.iniciar({ alEntrar: cargarInicio });
  }
  // Sitio publicado: un solo viaje trae los datos y, si el navegador no la tiene, la rúbrica.
  function cargarInicio() {
    $('#app').innerHTML = '<div class="loading" style="justify-content:center;padding:80px 16px"><span class="spin"></span>Abriendo EA Conecta…</div>';
    var guardado = null;
    try { guardado = JSON.parse(sessionStorage.getItem('rea_contenido') || 'null'); } catch (e) { guardado = null; }
    api('inicio', { cv: guardado ? guardado.cv : '' }).then(function (o) {
      if (o.boot) {
        if (o.contenido) {
          window.REA = o.contenido;
          try { sessionStorage.setItem('rea_contenido', JSON.stringify({ cv: o.cv, c: o.contenido })); } catch (e) { }
        } else window.REA = guardado.c;
      } else {
        try { sessionStorage.removeItem('rea_contenido'); } catch (e) { }   // sin rol de evaluación no se conserva la rúbrica
      }
      S.boot = o.boot || null; S.hu = o.hu || null; S.huError = o.huError || ''; S.v = o.v;
      abrir();
    }).catch(function (e) {
      var otra = e.codigo === 'SINACCESO' || e.codigo === 'DOMINIO';
      $('#app').innerHTML = '<div class="stripe" aria-hidden="true"><i></i><i></i><i></i><i></i><i></i><i></i></div><header class="topbar"><div class="wrap gut"><span class="thumb"><img src="' + REA_LOGO_SYM + '" alt="Eight Academy"></span><div class="t"><b>EA Conecta</b><span>Experiencias de Aprendizaje · Eight Academy</span></div></div></header>' +
        '<div class="wrap gut" style="padding-block:28px 60px;max-width:640px"><div class="tb"><div class="t"><span class="sub">EA Conecta</span><h1>' + (otra ? 'No tienes acceso a este portal' : 'No se pudo abrir el portal') + '</h1></div></div>' +
        '<p class="err" style="margin-top:16px">' + esc(e.message) + '</p><div class="row" style="margin-top:12px">' +
        (otra ? '<button class="btn" type="button" data-act="salir">Usar otra cuenta</button>' : '<button class="btn" type="button" onclick="location.reload()">Intentar de nuevo</button>') + '</div></div>';
    });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', iniciar); else iniciar();
})();
