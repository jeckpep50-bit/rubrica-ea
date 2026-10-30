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
         archivoPropio(id, email) -> { n, s } | null, marcarArchivo(id, huellaId), aPapelera(id), ahora(), hoy(), uuid() }
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

/* ---------------- reglas compartidas (Huella de clases y Pedir un recurso) ---------------- */
// Errores de validación: el mensaje es para la persona; no se registran como fallas del portal.
function huErr(m) { var e = new Error(m); e.codigo = 'VALIDACION'; throw e; }
function huTxt(v, max) { v = v == null ? '' : String(v).replace(/\r\n?/g, '\n').trim(); return v.length > max ? v.slice(0, max) : v; }
function huLow(v) { return String(v == null ? '' : v).trim().toLowerCase(); }
function huPartes(s) { return String(s == null ? '' : s).split(',').map(function (x) { return x.trim(); }).filter(Boolean); }
function huJson(s, d) { try { return s ? JSON.parse(s) : d; } catch (e) { return d; } }
function huUnicos(a) { var o = []; a.forEach(function (x) { if (o.indexOf(x) < 0) o.push(x); }); return o; }
function huSedeDeCurso(c, curso) { for (var i = 0; i < HU_SEDES.length; i++) if ((c.cursos[HU_SEDES[i]] || []).indexOf(curso) >= 0) return HU_SEDES[i]; return ''; }
// Curso, paralelos y asignatura contra el catálogo. "previa": el registro que se edita (sus valores se respetan
// aunque ya no estén en el catálogo).
function huValidarClase(c, p, previa) {
  var curso = huTxt(p.curso, 40);
  if (!curso) huErr('Elige el curso.');
  var sede = huSedeDeCurso(c, curso);
  if (!sede) { if (previa && previa.curso === curso) sede = String(previa.sede); else huErr('Elige el curso de la lista.'); }
  var permitidos = c.paralelos[sede] || [], antes = previa ? huPartes(previa.paralelos) : [];
  var pars = huUnicos((Array.isArray(p.paralelos) ? p.paralelos : []).map(function (x) { return huTxt(x, 12); }).filter(Boolean));
  if (!pars.length) huErr('Marca al menos un paralelo.');
  pars.forEach(function (x) { if (permitidos.indexOf(x) < 0 && antes.indexOf(x) < 0) huErr('El paralelo ' + x + ' no está en la lista de ' + sede + '.'); });
  pars.sort(function (a, b) { var i = permitidos.indexOf(a), j = permitidos.indexOf(b); return (i < 0 ? 99 : i) - (j < 0 ? 99 : j); });
  var asignatura = huTxt(p.asignatura, 80);
  if (asignatura.length < 2) huErr('Elige la asignatura.');
  if ((c.asignaturas[sede] || []).indexOf(asignatura) < 0 && !(previa && previa.asignatura === asignatura) && !p.asignaturaOtra) huErr('Elige la asignatura de la lista o escribe la tuya en «Otra».');
  return { sede: sede, curso: curso, paralelos: pars, asignatura: asignatura };
}
// Archivos (subidos por esa misma persona) y enlaces https. "previas": adjuntos que ya tenía el registro.
function huValidarAdjuntos(db, ctx, lista, previas, que) {
  var cf = db.config(), arch = [], enl = [];
  (Array.isArray(lista) ? lista : []).forEach(function (e) {
    if (!e || typeof e !== 'object') return;
    if (e.t === 'e') {
      var u = huTxt(e.u, 1000);
      if (!/^https:\/\/[^\s<>"']+$/i.test(u)) huErr('Cada enlace debe empezar con https://');
      if (enl.some(function (x) { return x.u === u; })) return;
      var dom = (u.match(/^https:\/\/([^\/?#]+)/i) || [])[1] || 'Enlace';
      enl.push({ t: 'e', u: u, n: huTxt(e.n, 120) || dom.replace(/^www\./, '') });
    } else if (e.t === 'a') {
      var id = huTxt(e.id, 120);
      if (!/^[\w-]{6,}$/.test(id)) huErr('Uno de los archivos no es válido. Vuelve a adjuntarlo.');
      if (arch.some(function (x) { return x.id === id; })) return;
      var previo = (previas || []).filter(function (x) { return x.t === 'a' && x.id === id; })[0];
      if (previo) { arch.push(previo); return; }
      var meta = db.archivoPropio(id, ctx.email);
      if (!meta) {
        var cual = huTxt(e.n, 120);
        huErr((cual ? '«' + cual + '»' : 'Uno de los archivos') + ' no se subió desde tu cuenta o ya no está disponible ' +
          '(se borró o pasó más de dos semanas sin guardarse). Quítalo y vuelve a adjuntarlo.');
      }
      arch.push({ t: 'a', id: id, n: huTxt(meta.n || e.n, 200), s: Number(meta.s) || 0, x: huExtension(meta.n || e.n) });
    }
  });
  if (arch.length > cf.evidMaxArchivos) huErr('Puedes adjuntar hasta ' + cf.evidMaxArchivos + ' archivos por ' + que + '.');
  if (enl.length > HU_MAX_ENLACES) huErr('Puedes agregar hasta ' + HU_MAX_ENLACES + ' enlaces por ' + que + '.');
  return arch.concat(enl);
}
// Después de guardar: los archivos nuevos dejan de ser borradores; los que se quitaron van a la papelera de Drive.
function huCerrarAdjuntos(db, nuevos, previas, marca) {
  var es = function (lista, e) { return lista.some(function (x) { return x.t === 'a' && x.id === e.id; }); };
  nuevos.forEach(function (e) { if (e.t === 'a' && !es(previas, e)) db.marcarArchivo(e.id, marca); });
  previas.forEach(function (e) { if (e.t === 'a' && !es(nuevos, e)) db.aPapelera(e.id); });
}

function crearServicioHuella(db) {
  var err = huErr, txt = huTxt, low = huLow, partes = huPartes, json = huJson, unicos = huUnicos;
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
  function usuario(email) { return db.usuarios().filter(function (u) { return low(u.email) === email; })[0] || null; }
  // La lista en caché dice en qué fila está cada huella. Si la hoja se reordenó a mano y la fila ya no
  // corresponde, se recarga la lista y se intenta una vez más (auditoría B1).
  function completaDe(h) {
    var full = db.huellaCompleta(h);
    if (full && String(full.id) === String(h.id)) return full;
    if (db.invalidarHuellas) {
      db.invalidarHuellas();
      var otra = porId(h.id);
      full = otra && db.huellaCompleta(otra);
      if (full && String(full.id) === String(h.id)) return full;
    }
    err('La huella cambió mientras se abría. Intenta de nuevo.');
  }
  function publica(full, ctx) {
    var o = ligera(full);
    o.contenidos = String(full.contenidos || ''); o.actividades = String(full.actividades || '');
    o.recursoOtro = String(full.recurso_otro || ''); o.metodologia = String(full.metodologia || '');
    o.evidencias = json(full.evidencias, []);
    o.solicitud = String(full.solicitud || '');
    o.propia = low(full.email) === ctx.email;
    return o;
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
      anio: cf.anio, catalogo: db.catalogo(), estados: HU_ESTADOS,
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
    var cl = huValidarClase(c, p, previa), sede = cl.sede, curso = cl.curso, pars = cl.paralelos, asignatura = cl.asignatura;
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
    var ev = huValidarAdjuntos(db, ctx, p.evidencias, previasEv, 'huella');
    // Recurso solicitado que se usó en esta clase (opcional: muchas clases no usan ninguno).
    var solAntes = fullPrevia ? String(fullPrevia.solicitud || '') : '', sol = txt(p.solicitud, 40);
    if (sol && sol !== solAntes && db.solicitudVinculable) db.solicitudVinculable(ctx, sol);

    var obj = fullPrevia || { id: db.uuid(), creado: db.ahora(), email: ctx.email, actualizado: '', eliminado: '' };
    obj.docente = ctx.nombre || obj.docente || ctx.email;
    obj.sede = sede; obj.fecha = fecha; obj.curso = curso; obj.paralelos = pars.join(', '); obj.asignatura = asignatura;
    obj.tema = tema; obj.recursos = recursos.join(', '); obj.estado = estado; obj.pendiente = pendiente; obj.n_evidencias = ev.length;
    obj.contenidos = contenidos; obj.actividades = actividades; obj.recurso_otro = recursoOtro; obj.metodologia = metodologia;
    obj.evidencias = JSON.stringify(ev); obj.solicitud = sol;
    if (fullPrevia) { obj.actualizado = db.ahora(); db.actualizarHuella(obj); } else db.insertarHuella(obj);
    huCerrarAdjuntos(db, ev, previasEv, obj.id);
    if (sol !== solAntes && db.vincularSolicitud) db.vincularSolicitud(solAntes, sol, obj.id);
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
    // El recurso que se usó en esta clase queda libre para otra huella (auditoría A2).
    if (full.solicitud && db.vincularSolicitud) db.vincularSolicitud(String(full.solicitud), '', String(full.id));
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
if (typeof module !== 'undefined') module.exports = { huValidarClase: huValidarClase, crearServicioHuella: crearServicioHuella, huParsearCatalogo: huParsearCatalogo, huExtension: huExtension, HU_TIPOS: HU_TIPOS, HU_CATALOGO_INICIAL: HU_CATALOGO_INICIAL, HU_SEDES: HU_SEDES };

/* ============================================================
   EA Conecta · Pedir un recurso · reglas (independientes del almacenamiento)
   Se usan igual en el servidor (Apps Script) y en la demostración; las constantes y las fechas, también en el navegador.
   db: { config(), catalogo(), solicitudes(), insertarSolicitud(o), actualizarSolicitud(o), plantillas(),
         archivoPropio(id, email), marcarArchivo(id, marca), aPapelera(id), avisar(m), ahora(), hoy(), uuid(),
         huellaViva(id)?, recursoBanco(ctx, id)? }   avisar(m): m.evento = 'lista' | 'noProcede'
   plantillas(): los recursos oficiales del Banco de ideas [{ id, titulo, descripcion, herramientas }]
   ctx: { email, nombre, depto }   depto = Departamento de Experiencias de Aprendizaje (atiende las solicitudes)
   ============================================================ */
var RE_TIPOS = {
  plantilla: 'Plantilla lista',
  medida: 'Recurso a medida',
  acompanamiento: 'Acompañamiento en la clase',
  capacitacion: 'Capacitación corta'
};
var RE_TIPOS_DESC = {
  plantilla: 'Oficiales del Banco de ideas: los abres y los usas al instante.',
  medida: 'El Departamento lo prepara para tu clase.',
  acompanamiento: 'Alguien del Departamento te acompaña en el aula.',
  capacitacion: '15 minutos para aprender a usar la herramienta.'
};
var RE_HERRAMIENTAS = ['iPad', 'MAXHUB', 'Metaverso', 'Aula inmersiva', 'Podcast', 'Por recomendar'];
var RE_CON_RESERVA = ['Aula inmersiva', 'Metaverso', 'Podcast'];   // espacios que se reservan en el sistema de reservas
var RE_ESTADOS = { recibida: 'Recibida', proceso: 'En proceso', lista: 'Lista', entregada: 'Entregada', cancelada: 'Cancelada' };

// Días hábiles (lunes a viernes). No descuenta feriados.
function reSumarHabiles(iso, n) {
  var p = String(iso).split('-'), d = new Date(Number(p[0]), Number(p[1]) - 1, Number(p[2]));
  while (n > 0) { d.setDate(d.getDate() + 1); if (d.getDay() !== 0 && d.getDay() !== 6) n--; }
  return d.getFullYear() + '-' + ('0' + (d.getMonth() + 1)).slice(-2) + '-' + ('0' + d.getDate()).slice(-2);
}
function reDiasHabiles(desde, hasta) {
  var n = 0, d = desde;
  while (d < hasta && n < 400) { d = reSumarHabiles(d, 1); n++; }
  return n;
}

function crearServicioRecursos(db) {
  var err = huErr, txt = huTxt, low = huLow, partes = huPartes, json = huJson;
  function todas() { return db.solicitudes().filter(function (s) { return s.id !== '' && s.id != null; }); }
  function porId(id) { id = String(id || ''); return todas().filter(function (s) { return String(s.id) === id; })[0] || null; }
  function orden(a, b) { var x = String(b.creado), y = String(a.creado); return x < y ? -1 : x > y ? 1 : 0; }
  function plazo() { return db.config().solicitudDias; }
  function publica(s, ctx) {
    return {
      id: String(s.id), creado: String(s.creado || ''), email: String(s.email || ''), docente: String(s.docente || ''), sede: String(s.sede || ''),
      tipo: String(s.tipo || ''), herramienta: String(s.herramienta || ''), fechaUso: String(s.fecha_uso || '').slice(0, 10),
      curso: String(s.curso || ''), paralelos: partes(s.paralelos), asignatura: String(s.asignatura || ''), periodos: Number(s.periodos) || 1,
      reserva: String(s.reserva || ''), logro: String(s.logro || ''), actividad: String(s.actividad || ''), evidenciaLogro: String(s.evidencia_logro || ''),
      material: json(s.material, []), estado: String(s.estado || ''), fueraPlazo: s.fuera_plazo === 'sí',
      fechas: { recibida: String(s.creado || ''), proceso: String(s.en_proceso || ''), lista: String(s.lista || ''), entregada: String(s.entregada || ''), cancelada: String(s.cancelada || '') },
      respuestaEnlace: String(s.respuesta_enlace || ''), respuestaNota: String(s.respuesta_nota || ''), atendidoPor: String(s.atendido_por || ''),
      huellaId: huellaVigente(s), bancoId: String(s.banco_id || ''), bancoTitulo: String(s.banco_titulo || ''), propia: low(s.email) === ctx.email
    };
  }
  // Un vínculo a una huella que ya no existe (se eliminó antes de la versión 2.4.0) cuenta como libre.
  function huellaVigente(s) {
    var id = String(s.huella_id || '');
    return id && (!db.huellaViva || db.huellaViva(id)) ? id : '';
  }
  function propiaODepto(ctx, s) { if (low(s.email) !== ctx.email && !ctx.depto) err('No tienes acceso a esta solicitud.'); }
  function soloDepto(ctx) { if (!ctx.depto) err('Las solicitudes las atiende el Departamento de Experiencias de Aprendizaje.'); }

  var R = {};

  R.inicio = function (ctx) {
    var cf = db.config(), l = todas();
    return {
      tipos: RE_TIPOS, tiposDesc: RE_TIPOS_DESC, herramientas: RE_HERRAMIENTAS, conReserva: RE_CON_RESERVA, estados: RE_ESTADOS,
      plazo: plazo(), reservasUrl: cf.reservasUrl, depto: !!ctx.depto,
      plantillas: (db.plantillas() || []).map(function (p) {
        return { id: String(p.id), titulo: String(p.titulo), descripcion: String(p.descripcion || ''), herramientas: (p.herramientas || []).slice() };
      }),
      mias: l.filter(function (s) { return low(s.email) === ctx.email; }).sort(orden).map(function (s) { return publica(s, ctx); }),
      porAtender: ctx.depto ? l.filter(function (s) { return s.estado === 'recibida' || s.estado === 'proceso'; }).length : 0
    };
  };

  R.guardar = function (ctx, p) {
    p = p || {};
    var tipo = String(p.tipo || '');
    if (tipo === 'plantilla') err('Las plantillas listas están en el Banco de ideas: se abren al instante, sin solicitud.');
    if (!RE_TIPOS[tipo]) err('Elige qué tipo de apoyo necesitas.');
    var herramienta = String(p.herramienta || '');
    if (RE_HERRAMIENTAS.indexOf(herramienta) < 0) err('Elige la herramienta.');
    var hoy = db.hoy(), fechaUso = txt(p.fechaUso, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(fechaUso)) err('Elige la fecha en que usarás el recurso.');
    if (fechaUso < hoy) err('La fecha de uso no puede ser pasada.');
    var cl = huValidarClase(db.catalogo(), p, null);
    var periodos = Math.floor(Number(p.periodos));
    if (!(periodos >= 1 && periodos <= 8)) err('Indica cuántos periodos de clase dura.');
    var reserva = 'no aplica';
    if (RE_CON_RESERVA.indexOf(herramienta) >= 0) {
      reserva = String(p.reserva || '');
      if (reserva !== 'sí' && reserva !== 'no') err('Indica si ya reservaste el espacio.');
    }
    var logro = txt(p.logro, 1000), actividad = txt(p.actividad, 1500), evidencia = txt(p.evidenciaLogro, 1000);
    if (logro.length < 3) err('Escribe qué deben lograr tus estudiantes.');
    if (actividad.length < 3) err('Escribe qué harán tus estudiantes con el recurso.');
    // Una adaptación parte de un recurso del Banco de ideas: ese recurso ya es el material de referencia.
    var banco = null, bancoId = txt(p.banco, 40);
    if (bancoId) {
      banco = db.recursoBanco ? db.recursoBanco(ctx, bancoId) : null;
      if (!banco) err('Ese recurso del Banco de ideas ya no está disponible. Quítalo de la solicitud o elige otro.');
    }
    var material = huValidarAdjuntos(db, ctx, p.material, [], 'solicitud');
    if (!material.length && !banco) err('Adjunta el material de referencia (archivo o enlace): así sabemos exactamente qué buscas.');
    var s = {
      id: db.uuid(), creado: db.ahora(), actualizado: '', email: ctx.email, docente: ctx.nombre || ctx.email, sede: cl.sede,
      tipo: tipo, herramienta: herramienta, fecha_uso: fechaUso, curso: cl.curso, paralelos: cl.paralelos.join(', '), asignatura: cl.asignatura,
      periodos: periodos, reserva: reserva, logro: logro, actividad: actividad, evidencia_logro: evidencia, material: JSON.stringify(material),
      estado: 'recibida', fuera_plazo: fechaUso < reSumarHabiles(hoy, plazo()) ? 'sí' : 'no',
      en_proceso: '', lista: '', entregada: '', cancelada: '', respuesta_enlace: '', respuesta_nota: '', atendido_por: '', huella_id: '',
      banco_id: banco ? banco.id : '', banco_titulo: banco ? banco.titulo : ''
    };
    db.insertarSolicitud(s);
    huCerrarAdjuntos(db, material, [], 'sol-' + s.id);
    return { solicitud: publica(porId(s.id), ctx) };
  };

  function aviso(s, evento, enlace, nota) {
    return { evento: evento, para: String(s.email), nombre: String(s.docente), tipo: RE_TIPOS[s.tipo] || String(s.tipo), herramienta: String(s.herramienta),
      curso: String(s.curso) + ' ' + partes(s.paralelos).join(', '), fechaUso: String(s.fecha_uso).slice(0, 10), enlace: enlace || '', nota: nota || '' };
  }
  function cambiar(s, campos) { for (var k in campos) s[k] = campos[k]; s.actualizado = db.ahora(); db.actualizarSolicitud(s); return s; }

  // Quien pidió cancela mientras no se empezó; el Departamento puede cerrarla con un motivo («No procede»).
  R.cancelar = function (ctx, p) {
    var s = porId(p && p.id);
    if (!s) err('No encontramos esa solicitud.');
    propiaODepto(ctx, s);
    var nota = txt(p.nota, 600);
    if (low(s.email) === ctx.email && !ctx.depto) {
      if (s.estado !== 'recibida') err('Ya está en proceso: escribe al Departamento si necesitas cancelarla.');
    } else {
      if (s.estado === 'entregada' || s.estado === 'cancelada') err('Esta solicitud ya está cerrada.');
      if (low(s.email) !== ctx.email && nota.length < 3) err('Escribe el motivo para quien la pidió.');
    }
    var ajena = low(s.email) !== ctx.email;
    cambiar(s, { estado: 'cancelada', cancelada: db.ahora(), respuesta_nota: nota || s.respuesta_nota, atendido_por: ctx.depto ? ctx.email : s.atendido_por });
    // Si la cierra el Departamento («No procede»), quien la pidió recibe el motivo por correo (auditoría M3).
    if (ajena) db.avisar(aviso(s, 'noProcede', '', nota));
    return { solicitud: publica(s, ctx) };
  };

  R.estado = function (ctx, p) {
    soloDepto(ctx);
    var s = porId(p && p.id);
    if (!s) err('No encontramos esa solicitud.');
    var nuevo = String(p.estado || '');
    if (nuevo === 'proceso') {
      if (s.estado !== 'recibida') err('Solo una solicitud recibida pasa a «En proceso».');
      cambiar(s, { estado: 'proceso', en_proceso: db.ahora(), atendido_por: ctx.email });
    } else if (nuevo === 'lista') {
      if (s.estado !== 'recibida' && s.estado !== 'proceso') err('Esta solicitud ya no se puede marcar como lista.');
      var enlace = txt(p.enlace, 1000), nota = txt(p.nota, 1500);
      if (enlace && !/^https:\/\/[^\s<>"']+$/i.test(enlace)) err('El enlace del recurso debe empezar con https://');
      if (!enlace && nota.length < 5) err('Agrega el enlace del recurso o una nota (por ejemplo, el día y la hora del acompañamiento).');
      cambiar(s, { estado: 'lista', lista: db.ahora(), en_proceso: s.en_proceso || db.ahora(), respuesta_enlace: enlace, respuesta_nota: nota, atendido_por: ctx.email });
      db.avisar(aviso(s, 'lista', enlace, nota));
    } else err('Estado no válido.');
    return { solicitud: publica(s, ctx) };
  };

  // Quien pidió confirma que recibió el recurso: así queda la fecha real de entrega.
  R.recibido = function (ctx, p) {
    var s = porId(p && p.id);
    if (!s) err('No encontramos esa solicitud.');
    if (low(s.email) !== ctx.email) err('Solo quien pidió el recurso confirma que lo recibió.');
    if (s.estado !== 'lista') err('El recurso todavía no está listo.');
    cambiar(s, { estado: 'entregada', entregada: db.ahora() });
    return { solicitud: publica(s, ctx) };
  };

  R.detalle = function (ctx, p) {
    var s = porId(p && p.id);
    if (!s) err('No encontramos esa solicitud.');
    propiaODepto(ctx, s);
    return publica(s, ctx);
  };

  R.bandeja = function (ctx) {
    soloDepto(ctx);
    return { solicitudes: todas().sort(orden).map(function (s) { return publica(s, ctx); }), hoy: db.hoy() };
  };

  R.material = function (ctx, p) {
    var d = R.detalle(ctx, { id: p && p.solicitud });
    var e = d.material.filter(function (x) { return x.t === 'a' && x.id === String(p.archivo || ''); })[0];
    if (!e) err('Ese archivo ya no está en la solicitud.');
    return { id: e.id, n: e.n };
  };

  /* ---- resumen diario para el Departamento (auditoría M3) ---- */
  // Nuevas (todavía abiertas) desde el resumen anterior, y abiertas que se usan en 2 días hábiles o menos (o ya pasaron).
  R.resumenDiario = function (desde) {
    var hoy = db.hoy(), limite = reSumarHabiles(hoy, 2), ab = todas().filter(function (s) { return s.estado === 'recibida' || s.estado === 'proceso'; });
    var corta = function (s) {
      return { id: String(s.id), docente: String(s.docente), tipo: RE_TIPOS[s.tipo] || String(s.tipo), herramienta: String(s.herramienta),
        curso: String(s.curso) + ' ' + partes(s.paralelos).join(', '), fechaUso: String(s.fecha_uso).slice(0, 10), estado: String(s.estado), fueraPlazo: s.fuera_plazo === 'sí' };
    };
    var porFecha = function (a, b) { return a.fechaUso < b.fechaUso ? -1 : a.fechaUso > b.fechaUso ? 1 : 0; };
    return {
      nuevas: ab.filter(function (s) { return String(s.creado) > String(desde || ''); }).map(corta).sort(porFecha),   // ya atendidas o canceladas no cuentan
      porVencer: ab.filter(function (s) { return String(s.fecha_uso).slice(0, 10) <= limite; }).map(corta).sort(porFecha),
      abiertas: ab.length
    };
  };

  /* ---- vínculo con Huella de clases (opcional) ---- */
  R.vinculable = function (ctx, id) {
    var s = porId(id);
    if (!s || low(s.email) !== ctx.email) err('Esa solicitud de recurso no es tuya.');
    if (s.estado !== 'lista' && s.estado !== 'entregada') err('Solo puedes vincular un recurso que ya está listo.');
    if (huellaVigente(s)) err('Ese recurso ya está vinculado a otra huella.');
  };
  R.vincular = function (antes, nuevo, huellaId) {
    var a = antes && porId(antes);
    if (a && String(a.huella_id) === String(huellaId)) cambiar(a, { huella_id: '' });
    var n = nuevo && porId(nuevo);
    if (n) cambiar(n, n.estado === 'lista' ? { huella_id: huellaId, estado: 'entregada', entregada: db.ahora() } : { huella_id: huellaId });
  };

  return R;
}
if (typeof module !== 'undefined') module.exports = { crearServicioRecursos: crearServicioRecursos, reSumarHabiles: reSumarHabiles };

/* ============================================================
   EA Conecta · Trabajos de mis estudiantes · reglas (independientes del almacenamiento)
   Se usan igual en el servidor (Apps Script) y en la demostración; las listas, también en el navegador.
   El docente solo sube el trabajo. La selección para exhibir la hace el Departamento por fuera del portal:
   aquí no hay campos de publicación ni de autorización (la matrícula ya cede el derecho de imagen).
   db: { config(), catalogo(), trabajos(), insertarTrabajo(o), actualizarTrabajo(o),
         archivoPropio(id, email), marcarArchivo(id, marca), aPapelera(id), huellaPropia(email, id), ahora(), hoy(), uuid() }
   ctx: { email, nombre, global, coord: ['Primaria' | 'Secundaria'] }
   ============================================================ */
var TB_TIPOS = ['Podcast', 'Video', 'Presentación', 'Infografía o afiche', 'Modelo 3D o realidad aumentada', 'Experiencia inmersiva o metaverso',
  'Texto o ensayo', 'Maqueta o producto físico', 'Programación o app', 'Otro'];
var TB_AUTORIAS = { individual: 'Individual', equipo: 'En equipo', curso: 'Todo el curso' };
var TB_MAX_ESTUDIANTES = 45;

function crearServicioTrabajos(db) {
  var err = huErr, txt = huTxt, low = huLow, partes = huPartes, json = huJson, unicos = huUnicos;
  function vivos() { return db.trabajos().filter(function (t) { return t.id !== '' && t.id != null && !t.eliminado; }); }
  // Más reciente primero; dos guardados en el mismo segundo se desempatan por la fila (la última, primero).
  function orden(a, b) {
    var x = String(b.fecha) + String(b.creado), y = String(a.fecha) + String(a.creado);
    return x < y ? -1 : x > y ? 1 : (Number(b._fila) || 0) - (Number(a._fila) || 0);
  }
  function porId(id) { id = String(id || ''); return vivos().filter(function (t) { return String(t.id) === id; })[0] || null; }
  function lineas(s) { return String(s == null ? '' : s).split('\n').map(function (x) { return x.trim(); }).filter(Boolean); }
  function ligera(t) {
    var arch = json(t.archivos, []);
    return {
      id: String(t.id), fecha: String(t.fecha).slice(0, 10), sede: String(t.sede || ''), curso: String(t.curso || ''), paralelos: partes(t.paralelos),
      asignatura: String(t.asignatura || ''), titulo: String(t.titulo || ''), tipo: String(t.tipo || ''), autoria: String(t.autoria || ''),
      nEstudiantes: lineas(t.estudiantes).length, nArchivos: arch.length, docente: String(t.docente || ''), email: String(t.email || ''),
      herramientas: partes(t.herramientas), creado: String(t.creado || ''), editado: String(t.actualizado || '')
    };
  }
  function publica(t, ctx) {
    var o = ligera(t);
    o.estudiantes = lineas(t.estudiantes); o.descripcion = String(t.descripcion || ''); o.archivos = json(t.archivos, []);
    o.huellaId = String(t.huella_id || ''); o.propio = low(t.email) === ctx.email;
    return o;
  }
  // Ven el banco: Departamento y Dirección (todo) y coordinación (su sede). Cada docente ve los suyos.
  function puedeBanco(ctx) { return !!(ctx.global || (ctx.coord && ctx.coord.length)); }
  function puedeVer(ctx, t) { return low(t.email) === ctx.email || !!ctx.global || (ctx.coord || []).indexOf(String(t.sede)) >= 0; }

  var T = {};

  T.inicio = function (ctx) {
    var mios = vivos().filter(function (t) { return low(t.email) === ctx.email; }).sort(orden);
    return { tipos: TB_TIPOS, autorias: TB_AUTORIAS, herramientas: db.catalogo().recursos, maxEstudiantes: TB_MAX_ESTUDIANTES,
      banco: puedeBanco(ctx), mios: mios.map(ligera) };
  };

  T.guardar = function (ctx, p) {
    p = p || {};
    var c = db.catalogo(), previo = null;
    if (p.id) {
      previo = porId(p.id);
      if (!previo) err('No encontramos ese trabajo. Quizá fue eliminado.');
      if (low(previo.email) !== ctx.email) err('Solo quien subió el trabajo puede editarlo.');
    }
    var titulo = txt(p.titulo, 120);
    if (titulo.length < 3) err('Escribe el título del trabajo.');
    var fecha = txt(p.fecha, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(fecha)) err('Elige la fecha en que se hizo el trabajo.');
    if (fecha > db.hoy()) err('La fecha del trabajo no puede ser futura.');
    if (fecha < '2020-01-01') err('La fecha del trabajo no es válida.');
    var cl = huValidarClase(c, p, previo);
    var tipo = String(p.tipo || '');
    if (TB_TIPOS.indexOf(tipo) < 0 && !(previo && previo.tipo === tipo)) err('Elige el tipo de trabajo.');
    var autoria = String(p.autoria || '');
    if (!TB_AUTORIAS[autoria]) err('Indica si el trabajo es individual, en equipo o de todo el curso.');
    var nombres = autoria === 'curso' ? [] : unicos((Array.isArray(p.estudiantes) ? p.estudiantes : lineas(p.estudiantes))
      .map(function (x) { return txt(x, 80).replace(/\s+/g, ' '); }).filter(Boolean));
    if (nombres.length > TB_MAX_ESTUDIANTES) err('Escribe como máximo ' + TB_MAX_ESTUDIANTES + ' nombres.');
    if (autoria === 'individual' && nombres.length > 1) err('Un trabajo individual lleva un solo nombre. Si lo hicieron varios, elige «En equipo».');
    var herrAntes = previo ? partes(previo.herramientas) : [];
    var herramientas = unicos((Array.isArray(p.herramientas) ? p.herramientas : []).map(function (x) { return txt(x, 60); }).filter(Boolean));
    herramientas.forEach(function (h) { if (c.recursos.indexOf(h) < 0 && herrAntes.indexOf(h) < 0) err('La herramienta «' + h + '» no está en la lista.'); });
    var descripcion = txt(p.descripcion, 800);
    var huellaId = txt(p.huella, 40), huellaAntes = previo ? String(previo.huella_id || '') : '';
    if (huellaId && huellaId !== huellaAntes && !db.huellaPropia(ctx.email, huellaId)) err('Esa huella de clase no es tuya o ya no existe.');
    var previos = previo ? json(previo.archivos, []) : [];
    var archivos = huValidarAdjuntos(db, ctx, p.archivos, previos, 'trabajo');
    if (!archivos.length) err('Adjunta el trabajo: un archivo o un enlace.');

    var obj = previo || { id: db.uuid(), creado: db.ahora(), email: ctx.email, actualizado: '', eliminado: '' };
    obj.docente = ctx.nombre || obj.docente || ctx.email;
    obj.sede = cl.sede; obj.fecha = fecha; obj.curso = cl.curso; obj.paralelos = cl.paralelos.join(', '); obj.asignatura = cl.asignatura;
    obj.titulo = titulo; obj.tipo = tipo; obj.autoria = autoria; obj.estudiantes = nombres.join('\n');
    obj.herramientas = herramientas.join(', '); obj.descripcion = descripcion;
    obj.archivos = JSON.stringify(archivos); obj.n_archivos = archivos.length; obj.huella_id = huellaId;
    if (previo) { obj.actualizado = db.ahora(); db.actualizarTrabajo(obj); } else db.insertarTrabajo(obj);
    huCerrarAdjuntos(db, archivos, previos, 'tb-' + obj.id);
    var guardado = porId(obj.id);
    return { trabajo: ligera(guardado), detalle: publica(guardado, ctx) };
  };

  T.eliminar = function (ctx, p) {
    var t = porId(p && p.id);
    if (!t) err('No encontramos ese trabajo. Quizá ya fue eliminado.');
    if (low(t.email) !== ctx.email) err('Solo quien subió el trabajo puede eliminarlo.');
    t.eliminado = db.ahora();
    db.actualizarTrabajo(t);
    json(t.archivos, []).forEach(function (e) { if (e.t === 'a') db.aPapelera(e.id); });
    return { ok: true, id: String(t.id) };
  };

  T.detalle = function (ctx, p) {
    var t = porId(p && p.id);
    if (!t) err('No encontramos ese trabajo. Quizá fue eliminado.');
    if (!puedeVer(ctx, t)) err('No tienes acceso a este trabajo.');
    return publica(t, ctx);
  };

  // Un archivo se abre solo si quien lo pide puede ver el trabajo.
  T.archivo = function (ctx, p) {
    var d = T.detalle(ctx, { id: p && p.trabajo });
    var e = d.archivos.filter(function (x) { return x.t === 'a' && x.id === String(p.archivo || ''); })[0];
    if (!e) err('Ese archivo ya no está en el trabajo.');
    return { id: e.id, n: e.n };
  };

  /* ---------------- banco de trabajos (Departamento, Dirección y coordinación) ---------------- */
  // Organizado por materia y por el docente que acompañó el trabajo.
  function filtrar(ctx, p) {
    if (!puedeBanco(ctx)) err('El banco de trabajos es para el Departamento, Dirección y coordinación.');
    p = p || {};
    var sedes = ctx.global ? HU_SEDES.slice() : ctx.coord.slice();
    if (p.sede) { if (sedes.indexOf(p.sede) < 0) err('No tienes acceso a los trabajos de esa sede.'); sedes = [p.sede]; }
    var q = low(txt(p.q, 80));
    var desde = /^\d{4}-\d{2}-\d{2}$/.test(p.desde || '') ? p.desde : '', hasta = /^\d{4}-\d{2}-\d{2}$/.test(p.hasta || '') ? p.hasta : '';
    return vivos().filter(function (t) {
      if (sedes.indexOf(String(t.sede)) < 0) return false;
      if (p.asignatura && t.asignatura !== p.asignatura) return false;
      if (p.docente && low(t.email) !== low(p.docente)) return false;
      if (p.curso && t.curso !== p.curso) return false;
      if (p.tipo && t.tipo !== p.tipo) return false;
      if (p.herramienta && partes(t.herramientas).indexOf(p.herramienta) < 0) return false;
      var f = String(t.fecha).slice(0, 10);
      if (desde && f < desde) return false;
      if (hasta && f > hasta) return false;
      if (q && [t.titulo, t.docente, t.email, t.asignatura, t.curso, t.tipo, t.estudiantes, t.descripcion].join(' ').toLowerCase().indexOf(q) < 0) return false;
      return true;
    }).sort(orden);
  }
  T.banco = function (ctx, p) {
    var l = filtrar(ctx, p), mat = {}, doc = {};
    l.forEach(function (t) {
      var a = mat[t.asignatura] = mat[t.asignatura] || { asignatura: String(t.asignatura), trabajos: 0, docentes: {}, ultima: '' };
      a.trabajos++; a.docentes[low(t.email)] = 1; if (String(t.fecha) > a.ultima) a.ultima = String(t.fecha).slice(0, 10);
      var d = doc[low(t.email)] = doc[low(t.email)] || { docente: String(t.docente), email: low(t.email), trabajos: 0, materias: {}, ultima: '' };
      d.trabajos++; d.materias[String(t.asignatura)] = 1; if (String(t.fecha) > d.ultima) d.ultima = String(t.fecha).slice(0, 10);
    });
    var porMateria = Object.keys(mat).map(function (k) { var a = mat[k]; return { asignatura: a.asignatura, trabajos: a.trabajos, docentes: Object.keys(a.docentes).length, ultima: a.ultima }; })
      .sort(function (a, b) { return b.trabajos - a.trabajos || a.asignatura.localeCompare(b.asignatura, 'es'); });
    var porDocente = Object.keys(doc).map(function (k) { var d = doc[k]; return { docente: d.docente, email: d.email, trabajos: d.trabajos, materias: Object.keys(d.materias).sort(), ultima: d.ultima }; })
      .sort(function (a, b) { return b.trabajos - a.trabajos || a.docente.localeCompare(b.docente, 'es'); });
    // Opciones de los filtros: todo lo que la persona puede ver, no solo lo filtrado.
    var base = filtrar(ctx, { sede: p && p.sede }), docentes = {}, asignaturas = {};
    base.forEach(function (t) { docentes[low(t.email)] = String(t.docente); asignaturas[String(t.asignatura)] = 1; });
    return {
      total: l.length, limite: 1000, filas: l.slice(0, 1000).map(ligera), porMateria: porMateria, porDocente: porDocente,
      estudiantes: l.reduce(function (n, t) { return n + lineas(t.estudiantes).length; }, 0),
      opciones: { docentes: Object.keys(docentes).map(function (e) { return { email: e, nombre: docentes[e] }; }).sort(function (a, b) { return a.nombre.localeCompare(b.nombre, 'es'); }),
        asignaturas: Object.keys(asignaturas).sort(function (a, b) { return a.localeCompare(b, 'es'); }) }
    };
  };
  T.exportar = function (ctx, p) {
    var l = filtrar(ctx, p).slice(0, 5000);
    return { total: l.length, filas: l.map(function (t) { var o = publica(t, ctx); delete o.propio; return o; }) };
  };

  return T;
}
if (typeof module !== 'undefined') module.exports = { crearServicioTrabajos: crearServicioTrabajos, TB_TIPOS: TB_TIPOS, TB_AUTORIAS: TB_AUTORIAS };

/* ============================================================
   EA Conecta · Banco de ideas · reglas (independientes del almacenamiento)
   Recursos e ideas para diseñar clases. Cualquier cuenta del colegio explora y comparte.
   Lo que publica el Departamento es OFICIAL: listo para usar tal cual. Lo que comparte un docente es la idea
   de un colega: se copia y se ajusta a cada clase (o se pide la adaptación al Departamento).
   Se publica al instante; el Departamento modera después: oculta (con motivo), restaura y atiende reportes.
   No se separa por año lectivo: el banco crece de un año a otro.
   Se usan igual en el servidor (Apps Script) y en la demostración; las constantes y los formatos, también en el navegador.
   db: { config(), catalogo(), recursos() [filas ligeras], recursoCompleto(r), invalidarRecursos(), insertarRecurso(o), actualizarRecurso(o),
         reportes(), insertarReporte(o), actualizarReporte(o), archivoPropio(id, email), publicarArchivo(id, marca, email, publico),
         compartirArchivo(id, si), aPapelera(id), huellaPropia(email, id), avisar(m), ahora(), hoy(), uuid() }
   avisar(m): m.evento = 'reporte' | 'oculto' | 'restaurado'
   ctx: { email, nombre, depto }   depto = Departamento de Experiencias de Aprendizaje (publica oficiales y modera)
   ============================================================ */
var BN_TIPOS = { idea: 'Idea de actividad', plantilla: 'Plantilla', material: 'Material listo para usar', proyecto: 'Proyecto o secuencia' };
var BN_TIPOS_DESC = {
  idea: 'Una dinámica, estrategia o actividad que te funcionó.',
  plantilla: 'Un documento base para duplicar y llenar.',
  material: 'Presentación, guía, ficha, video o audio para la clase.',
  proyecto: 'Varias clases conectadas con un producto final.'
};
var BN_MOMENTOS = ['Inicio', 'Desarrollo', 'Cierre', 'Evaluación'];
var BN_DURACIONES = ['Menos de 15 minutos', 'Una clase', 'Varias clases'];
var BN_TRANSVERSAL = 'Transversal';
var BN_SUBNIVELES = ['Inicial', 'Preparatoria', 'Elemental', 'Media', 'Superior', 'Bachillerato'];
var BN_MOTIVOS = { derechos: 'Derechos de autor', enlace: 'Enlace roto o sin permiso', contenido: 'Contenido inapropiado', otro: 'Otro motivo' };
var BN_LIMITE_LISTA = 3000;

// Subnivel del currículo del Ministerio a partir del curso del catálogo («6.º EGB» → Media).
function bnSubnivelDe(curso) {
  var s = String(curso || '');
  if (/inicial/i.test(s)) return 'Inicial';
  var m = s.match(/(\d+)\s*\.?\s*º?\s*(EGB|BGU)/i);
  if (!m) return '';
  if (/BGU/i.test(m[2])) return 'Bachillerato';
  var n = Number(m[1]);
  return n <= 1 ? 'Preparatoria' : n <= 4 ? 'Elemental' : n <= 7 ? 'Media' : n <= 10 ? 'Superior' : '';
}
// Subniveles que tiene el colegio (según los cursos del catálogo), cada uno con sus cursos.
function bnSubniveles(c) {
  var m = {};
  HU_SEDES.forEach(function (s) {
    (c.cursos[s] || []).forEach(function (cu) { var k = bnSubnivelDe(cu); if (!k) return; m[k] = m[k] || []; if (m[k].indexOf(cu) < 0) m[k].push(cu); });
  });
  return BN_SUBNIVELES.filter(function (k) { return m[k]; }).map(function (k) { return { v: k, cursos: m[k] }; });
}
function bnAsignaturas(c) {
  var l = [];
  HU_SEDES.forEach(function (s) { (c.asignaturas[s] || []).forEach(function (a) { if (l.indexOf(a) < 0) l.push(a); }); });
  return [BN_TRANSVERSAL].concat(l);
}
var BN_EXT = {
  key: 'Keynote', pages: 'Pages', numbers: 'Numbers', pdf: 'PDF', doc: 'Word', docx: 'Word', xls: 'Excel', xlsx: 'Excel', ppt: 'PowerPoint', pptx: 'PowerPoint',
  odt: 'OpenDocument', ods: 'OpenDocument', odp: 'OpenDocument', jpg: 'Imagen', jpeg: 'Imagen', png: 'Imagen', heic: 'Imagen', heif: 'Imagen', gif: 'Imagen', webp: 'Imagen',
  mov: 'Video', mp4: 'Video', m4v: 'Video', m4a: 'Audio', mp3: 'Audio', wav: 'Audio', aac: 'Audio', usdz: 'Modelo 3D', reality: 'Modelo 3D', glb: 'Modelo 3D',
  zip: 'ZIP', epub: 'Libro digital', html: 'Página web', htm: 'Página web', txt: 'Texto', rtf: 'Texto', csv: 'Texto'
};
// Formato que verá quien lo abra: por la extensión del archivo o por el sitio del enlace.
function bnFormato(e) {
  if (!e) return '';
  if (e.t === 'a') return BN_EXT[String(e.x || huExtension(e.n)).toLowerCase()] || 'Archivo';
  var u = String(e.u || '').toLowerCase();
  var google = u.match(/^https:\/\/docs\.google\.com\/(document|presentation|spreadsheets|forms|drawings)\//);
  if (google) return { document: 'Documento de Google', presentation: 'Presentación de Google', spreadsheets: 'Hoja de Google', forms: 'Formulario de Google', drawings: 'Dibujo de Google' }[google[1]];
  if (/^https:\/\/(drive|docs)\.google\.com\//.test(u)) return 'Google Drive';
  if (/^https:\/\/([\w-]+\.)?canva\.(com|link)\//.test(u)) return 'Canva';
  var icloud = u.match(/^https:\/\/(www\.)?icloud\.com\/(keynote|pages|numbers|freeform|iclouddrive)/);
  if (icloud) return { keynote: 'Keynote (iCloud)', pages: 'Pages (iCloud)', numbers: 'Numbers (iCloud)', freeform: 'Freeform (iCloud)', iclouddrive: 'iCloud Drive' }[icloud[2]];
  if (/^https:\/\/(www\.)?icloud\.com\//.test(u)) return 'iCloud';
  if (/^https:\/\/((www|m)\.)?(youtube\.com|youtu\.be)\//.test(u)) return 'YouTube';
  if (/^https:\/\/([\w-]+\.)?(sharepoint\.com|onedrive\.live\.com|1drv\.ms)\//.test(u)) return 'OneDrive';
  return 'Enlace';
}
// Enlace de Google que se puede duplicar con un toque («Hacer mi copia»).
function bnCopiaGoogle(u) {
  var m = String(u || '').match(/^https:\/\/docs\.google\.com\/(document|presentation|spreadsheets|forms|drawings)\/d\/([\w-]{10,})/);
  return m ? 'https://docs.google.com/' + m[1] + '/d/' + m[2] + '/copy' : '';
}

function crearServicioBanco(db) {
  var err = huErr, txt = huTxt, low = huLow, partes = huPartes, json = huJson, unicos = huUnicos;
  function vivos() { return db.recursos().filter(function (r) { return r.id !== '' && r.id != null && !r.eliminado; }); }
  function porId(id) { id = String(id || ''); return vivos().filter(function (r) { return String(r.id) === id; })[0] || null; }
  // Lo más reciente primero; dos guardados en el mismo segundo se desempatan por la fila (la última, primero).
  function orden(a, b) {
    var x = String(b.creado), y = String(a.creado);
    return x < y ? -1 : x > y ? 1 : (Number(b._fila) || 0) - (Number(a._fila) || 0);
  }
  function oculto(r) { return String(r.estado) === 'oculto'; }
  function propio(ctx, r) { return low(r.email) === ctx.email; }
  // Un recurso oculto solo lo ven quien lo compartió y el Departamento.
  function visible(ctx, r) { return !oculto(r) || propio(ctx, r) || !!ctx.depto; }
  function soloDepto(ctx) { if (!ctx.depto) err('Esto lo hace el Departamento de Experiencias de Aprendizaje.'); }
  // La lista en caché dice en qué fila está cada recurso; si la hoja se reordenó a mano, se recarga una vez.
  function completaDe(r) {
    var full = db.recursoCompleto(r);
    if (full && String(full.id) === String(r.id)) return full;
    if (db.invalidarRecursos) {
      db.invalidarRecursos();
      var otro = porId(r.id);
      full = otro && db.recursoCompleto(otro);
      if (full && String(full.id) === String(r.id)) return full;
    }
    err('El recurso cambió mientras se abría. Intenta de nuevo.');
  }
  function lista(v, max) { return unicos((Array.isArray(v) ? v : []).map(function (x) { return txt(x, max).replace(/,/g, ' ').replace(/\s+/g, ' '); }).filter(Boolean)); }
  function enOrden(l, ref) { return l.slice().sort(function (a, b) { var i = ref.indexOf(a), j = ref.indexOf(b); return (i < 0 ? 999 : i) - (j < 0 ? 999 : j); }); }
  function abiertos() { return db.reportes().filter(function (x) { return x.id !== '' && x.id != null && String(x.estado) === 'abierto'; }); }
  function ligera(r) {
    return {
      id: String(r.id), titulo: String(r.titulo || ''), tipo: String(r.tipo || ''), oficial: r.oficial === 'sí',
      paraQue: String(r.para_que || ''), asignaturas: partes(r.asignaturas), subniveles: partes(r.subniveles), herramientas: partes(r.herramientas),
      momentos: partes(r.momentos), duracion: String(r.duracion || ''), dua: r.dua === 'sí', formatos: partes(r.formatos), nArchivos: Number(r.n_archivos) || 0,
      autor: String(r.autor || ''), email: String(r.email || ''), creado: String(r.creado || ''), editado: String(r.actualizado || ''),
      estado: oculto(r) ? 'oculto' : 'publicado'
    };
  }
  // En lo propio, la lista también dice de qué huella nació (para no ofrecer compartir la misma clase dos veces).
  function paraMi(ctx) { return function (r) { var o = ligera(r); if (propio(ctx, r)) o.huellaId = String(r.huella_id || ''); return o; }; }
  function publica(full, ctx) {
    var o = ligera(full), mio = propio(ctx, full);
    o.comoUsar = String(full.como_usar || '');
    o.archivos = json(full.archivos, []).map(function (e) {
      var c = {}; for (var k in e) c[k] = e[k];
      c.f = bnFormato(e);
      if (e.t === 'e') { var cp = bnCopiaGoogle(e.u); if (cp) c.copia = cp; }
      return c;
    });
    o.propio = mio; o.puedeEditar = mio || !!ctx.depto;
    o.huellaId = mio ? String(full.huella_id || '') : '';
    if (mio || ctx.depto) { o.motivoOculto = String(full.motivo_oculto || ''); o.ocultoEn = String(full.oculto_en || ''); }
    var rep = abiertos().filter(function (x) { return String(x.recurso_id) === o.id; });
    o.reportado = rep.some(function (x) { return low(x.email) === ctx.email; });
    if (ctx.depto) o.reportes = rep.map(function (x) { return { id: String(x.id), motivo: BN_MOTIVOS[x.motivo] || String(x.motivo), nota: String(x.nota || ''), por: String(x.nombre || x.email), creado: String(x.creado) }; });
    return o;
  }
  function cerrarReportes(recursoId, resolucion, email) {
    abiertos().filter(function (x) { return String(x.recurso_id) === String(recursoId); }).forEach(function (x) {
      x.estado = 'resuelto'; x.resolucion = resolucion; x.resuelto_por = email; x.resuelto_en = db.ahora();
      db.actualizarReporte(x);
    });
  }

  var B = {};

  B.inicio = function (ctx) {
    var c = db.catalogo(), l = vivos(), pub = l.filter(function (r) { return !oculto(r); });
    return {
      tipos: BN_TIPOS, tiposDesc: BN_TIPOS_DESC, subniveles: bnSubniveles(c), asignaturas: bnAsignaturas(c), herramientas: c.recursos,
      momentos: BN_MOMENTOS, duraciones: BN_DURACIONES, motivos: BN_MOTIVOS, depto: !!ctx.depto,
      total: pub.length, oficiales: pub.filter(function (r) { return r.oficial === 'sí'; }).length,
      mios: l.filter(function (r) { return propio(ctx, r); }).sort(orden).map(paraMi(ctx)),
      reportes: ctx.depto ? abiertos().length : 0
    };
  };

  // Todo lo publicado, más lo propio oculto (y, para el Departamento, todo lo oculto).
  B.lista = function (ctx) {
    var l = vivos().filter(function (r) { return visible(ctx, r); }).sort(orden);
    return { total: l.length, limite: BN_LIMITE_LISTA, recursos: l.slice(0, BN_LIMITE_LISTA).map(paraMi(ctx)) };
  };

  B.detalle = function (ctx, p) {
    var r = porId(p && p.id);
    if (!r || !visible(ctx, r)) err('Ese recurso ya no está en el banco.');
    return publica(completaDe(r), ctx);
  };

  B.guardar = function (ctx, p) {
    p = p || {};
    var c = db.catalogo(), previo = null, fullPrevio = null;
    if (p.id) {
      previo = porId(p.id);
      if (!previo) err('No encontramos ese recurso. Quizá fue eliminado.');
      if (!propio(ctx, previo) && !ctx.depto) err('Solo quien compartió el recurso (o el Departamento) puede editarlo.');
      fullPrevio = completaDe(previo);
    }
    var titulo = txt(p.titulo, 120);
    if (titulo.length < 3) err('Escribe el título del recurso.');
    var tipo = String(p.tipo || '');
    if (!BN_TIPOS[tipo]) err('Elige qué tipo de aporte es.');
    var paraQue = txt(p.paraQue, 300);
    if (paraQue.length < 10) err('Escribe para qué sirve en clase: qué aprenden o logran los estudiantes.');
    var asigOk = bnAsignaturas(c), asigAntes = fullPrevio ? partes(fullPrevio.asignaturas) : [];
    var asignaturas = lista(p.asignaturas, 80);
    if (!asignaturas.length) err('Elige al menos una asignatura (o «Transversal» si sirve para cualquiera).');
    asignaturas.forEach(function (a) { if (asigOk.indexOf(a) < 0 && asigAntes.indexOf(a) < 0) err('La asignatura «' + a + '» no está en la lista.'); });
    if (asignaturas.length > 8) err('Elige como máximo 8 asignaturas. Si sirve para cualquiera, elige «Transversal».');
    var subOk = bnSubniveles(c).map(function (x) { return x.v; }), subAntes = fullPrevio ? partes(fullPrevio.subniveles) : [];
    var subniveles = lista(p.subniveles, 40);
    if (!subniveles.length) err('Elige al menos un subnivel.');
    subniveles.forEach(function (s) { if (subOk.indexOf(s) < 0 && subAntes.indexOf(s) < 0) err('El subnivel «' + s + '» no está en la lista.'); });
    var herrAntes = fullPrevio ? partes(fullPrevio.herramientas) : [];
    var herramientas = lista(p.herramientas, 60);
    herramientas.forEach(function (h) { if (c.recursos.indexOf(h) < 0 && herrAntes.indexOf(h) < 0) err('La herramienta «' + h + '» no está en la lista.'); });
    var momentos = lista(p.momentos, 20);
    momentos.forEach(function (m) { if (BN_MOMENTOS.indexOf(m) < 0) err('El momento de la clase «' + m + '» no es válido.'); });
    var duracion = String(p.duracion || '');
    if (duracion && BN_DURACIONES.indexOf(duracion) < 0) err('Elige la duración de la lista.');
    var comoUsar = txt(p.comoUsar, 3000);
    if ((tipo === 'idea' || tipo === 'proyecto') && comoUsar.length < 20) err('Cuenta cómo se usa en clase (los pasos principales), para que otro docente pueda hacerlo.');
    var huellaId = txt(p.huella, 40), huellaAntes = fullPrevio ? String(fullPrevio.huella_id || '') : '';
    if (huellaId && huellaId !== huellaAntes && !db.huellaPropia(ctx.email, huellaId)) err('Esa huella de clase no es tuya o ya no existe.');
    var previos = fullPrevio ? json(fullPrevio.archivos, []) : [];
    var archivos = huValidarAdjuntos(db, ctx, p.archivos, previos, 'recurso');
    if ((tipo === 'plantilla' || tipo === 'material') && !archivos.length) err('Adjunta la plantilla o el material: un archivo o un enlace.');
    if (!fullPrevio && p.derechos !== true) err('Confirma que el material es tuyo o que tienes derecho a compartirlo.');
    // Solo el Departamento decide qué es oficial; lo que publica es oficial salvo que lo desmarque.
    var oficial = fullPrevio ? fullPrevio.oficial === 'sí' : false;
    if (ctx.depto) oficial = p.oficial === undefined ? (fullPrevio ? oficial : true) : !!p.oficial;

    var obj = fullPrevio || { id: db.uuid(), creado: db.ahora(), actualizado: '', email: ctx.email, autor: ctx.nombre || ctx.email, estado: 'publicado',
      derechos: db.ahora(), editado_por: '', motivo_oculto: '', oculto_por: '', oculto_en: '', eliminado: '' };
    if (fullPrevio && propio(ctx, fullPrevio) && ctx.nombre) obj.autor = ctx.nombre;
    obj.oficial = oficial ? 'sí' : 'no'; obj.tipo = tipo; obj.titulo = titulo; obj.para_que = paraQue;
    obj.asignaturas = asignaturas.join(', '); obj.subniveles = enOrden(subniveles, BN_SUBNIVELES).join(', ');
    obj.herramientas = herramientas.join(', '); obj.momentos = enOrden(momentos, BN_MOMENTOS).join(', '); obj.duracion = duracion; obj.dua = p.dua ? 'sí' : '';
    obj.como_usar = comoUsar; obj.archivos = JSON.stringify(archivos); obj.n_archivos = archivos.length;
    obj.formatos = unicos(archivos.map(bnFormato)).join(', '); obj.huella_id = huellaId;
    if (fullPrevio) { obj.actualizado = db.ahora(); obj.editado_por = ctx.email; db.actualizarRecurso(obj); } else db.insertarRecurso(obj);
    // Archivos nuevos: a la carpeta del banco, marcados y compartidos con el colegio. Los que se quitaron, a la papelera.
    var es = function (l, e) { return l.some(function (x) { return x.t === 'a' && x.id === e.id; }); };
    archivos.forEach(function (e) { if (e.t === 'a' && !es(previos, e)) db.publicarArchivo(e.id, 'bn-' + obj.id, ctx.email, !oculto(obj)); });
    previos.forEach(function (e) { if (e.t === 'a' && !es(archivos, e)) db.aPapelera(e.id); });
    return { recurso: paraMi(ctx)(obj), detalle: publica(obj, ctx) };
  };

  B.eliminar = function (ctx, p) {
    var r = porId(p && p.id);
    if (!r) err('No encontramos ese recurso. Quizá ya fue eliminado.');
    if (!propio(ctx, r)) err('Solo quien compartió el recurso puede eliminarlo. El Departamento puede ocultarlo.');
    var full = completaDe(r);
    full.eliminado = db.ahora();
    db.actualizarRecurso(full);
    json(full.archivos, []).forEach(function (e) { if (e.t === 'a') db.aPapelera(e.id); });
    cerrarReportes(full.id, 'eliminado', ctx.email);
    return { ok: true, id: String(full.id) };
  };

  // El Departamento oculta un recurso con un motivo: deja de verse en el banco y sus archivos dejan de estar
  // compartidos con el colegio. A quien lo compartió le llega el motivo por correo.
  B.ocultar = function (ctx, p) {
    soloDepto(ctx);
    var r = porId(p && p.id);
    if (!r) err('No encontramos ese recurso. Quizá fue eliminado.');
    if (oculto(r)) err('Ese recurso ya está oculto.');
    var motivo = txt(p.motivo, 500);
    if (motivo.length < 5) err('Escribe el motivo: le llega por correo a quien lo compartió.');
    var full = completaDe(r);
    full.estado = 'oculto'; full.motivo_oculto = motivo; full.oculto_por = ctx.email; full.oculto_en = db.ahora();
    db.actualizarRecurso(full);
    json(full.archivos, []).forEach(function (e) { if (e.t === 'a') db.compartirArchivo(e.id, false); });
    cerrarReportes(full.id, 'ocultado', ctx.email);
    if (!propio(ctx, full)) db.avisar({ evento: 'oculto', para: String(full.email), nombre: String(full.autor), titulo: String(full.titulo), motivo: motivo });
    return { recurso: ligera(full), detalle: publica(full, ctx) };
  };

  B.restaurar = function (ctx, p) {
    soloDepto(ctx);
    var r = porId(p && p.id);
    if (!r) err('No encontramos ese recurso. Quizá fue eliminado.');
    if (!oculto(r)) err('Ese recurso ya está publicado.');
    var full = completaDe(r);
    full.estado = 'publicado'; full.motivo_oculto = ''; full.oculto_por = ''; full.oculto_en = '';
    db.actualizarRecurso(full);
    json(full.archivos, []).forEach(function (e) { if (e.t === 'a') db.compartirArchivo(e.id, true); });
    if (!propio(ctx, full)) db.avisar({ evento: 'restaurado', para: String(full.email), nombre: String(full.autor), titulo: String(full.titulo) });
    return { recurso: ligera(full), detalle: publica(full, ctx) };
  };

  // Cualquier docente puede avisar al Departamento de un problema (sin ocultar nada por sí mismo).
  B.reportar = function (ctx, p) {
    p = p || {};
    var r = porId(p.id);
    if (!r || oculto(r)) err('Ese recurso ya no está publicado.');
    if (propio(ctx, r)) err('Es un recurso tuyo: puedes editarlo o eliminarlo.');
    var motivo = String(p.motivo || '');
    if (!BN_MOTIVOS[motivo]) err('Elige el motivo del reporte.');
    var nota = txt(p.nota, 500);
    if (motivo === 'otro' && nota.length < 5) err('Cuéntanos el motivo en la nota.');
    if (abiertos().some(function (x) { return String(x.recurso_id) === String(r.id) && low(x.email) === ctx.email; })) err('Ya reportaste este recurso: el Departamento lo está revisando.');
    var o = { id: db.uuid(), creado: db.ahora(), recurso_id: String(r.id), titulo: String(r.titulo), email: ctx.email, nombre: ctx.nombre || ctx.email,
      motivo: motivo, nota: nota, estado: 'abierto', resuelto_por: '', resuelto_en: '', resolucion: '' };
    db.insertarReporte(o);
    db.avisar({ evento: 'reporte', id: String(r.id), titulo: String(r.titulo), autor: String(r.autor), motivo: BN_MOTIVOS[motivo], nota: nota, por: o.nombre });
    return { ok: true };
  };

  // Moderación: reportes abiertos y recursos ocultos.
  B.reportes = function (ctx) {
    soloDepto(ctx);
    var todos = vivos(), porRec = {};
    todos.forEach(function (r) { porRec[String(r.id)] = r; });
    var abiertosL = abiertos().filter(function (x) { return porRec[String(x.recurso_id)]; }).sort(function (a, b) { return String(b.creado) < String(a.creado) ? -1 : 1; })
      .map(function (x) {
        var r = porRec[String(x.recurso_id)];
        return { id: String(x.id), creado: String(x.creado), recursoId: String(r.id), titulo: String(r.titulo), autor: String(r.autor), oficial: r.oficial === 'sí',
          motivo: BN_MOTIVOS[x.motivo] || String(x.motivo), nota: String(x.nota || ''), por: String(x.nombre || x.email), porEmail: String(x.email) };
      });
    var ocultos = todos.filter(oculto).sort(function (a, b) { return String(b.oculto_en) < String(a.oculto_en) ? -1 : 1; }).map(function (r) {
      var o = ligera(r); o.motivoOculto = String(r.motivo_oculto || ''); o.ocultoEn = String(r.oculto_en || ''); o.ocultoPor = String(r.oculto_por || '');
      // Corregido: quien lo compartió lo editó después de que se ocultara.
      o.corregido = !!(r.actualizado && String(r.actualizado) >= String(r.oculto_en) && low(r.editado_por) === low(r.email)); return o;
    });
    return { abiertos: abiertosL, ocultos: ocultos };
  };

  B.descartar = function (ctx, p) {
    soloDepto(ctx);
    var x = abiertos().filter(function (y) { return String(y.id) === String(p && p.id || ''); })[0];
    if (!x) err('Ese reporte ya se atendió.');
    x.estado = 'resuelto'; x.resolucion = 'descartado'; x.resuelto_por = ctx.email; x.resuelto_en = db.ahora();
    db.actualizarReporte(x);
    return { ok: true };
  };

  // Un archivo se abre solo si quien lo pide puede ver el recurso. publico: el recurso está publicado.
  B.archivo = function (ctx, p) {
    var d = B.detalle(ctx, { id: p && p.recurso });
    var e = d.archivos.filter(function (x) { return x.t === 'a' && x.id === String(p.archivo || ''); })[0];
    if (!e) err('Ese archivo ya no está en el recurso.');
    return { id: e.id, n: e.n, publico: d.estado === 'publicado' };
  };

  // Para Pedir un recurso: las plantillas listas son los recursos oficiales publicados.
  B.oficiales = function () {
    return vivos().filter(function (r) { return !oculto(r) && r.oficial === 'sí'; })
      .sort(function (a, b) { return String(a.titulo).localeCompare(String(b.titulo), 'es'); })
      .map(function (r) { return { id: String(r.id), titulo: String(r.titulo), descripcion: String(r.para_que || ''), tipo: String(r.tipo), herramientas: partes(r.herramientas) }; });
  };
  // Recurso de base de una solicitud de adaptación.
  B.referencia = function (ctx, id) {
    var r = porId(id);
    return r && !oculto(r) ? { id: String(r.id), titulo: String(r.titulo) } : null;
  };

  return B;
}
if (typeof module !== 'undefined') module.exports = { crearServicioBanco: crearServicioBanco, bnSubnivelDe: bnSubnivelDe, bnFormato: bnFormato, bnCopiaGoogle: bnCopiaGoogle, BN_TIPOS: BN_TIPOS };

/* EA Conecta · módulos del portal. El portal los conecta con window.HU_MODULO(EA). */
window.HU_MODULO = function (EA) {
  'use strict';
  /* EA Conecta · Estado del módulo, utilidades compartidas, sede e Inicio del portal. */
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
    clip: svg('<path d="m21 11-8.5 8.5a5 5 0 0 1-7-7L14 4a3.5 3.5 0 0 1 5 5l-8.5 8.5a2 2 0 0 1-3-3L15 7"/>'),
    banco: svg('<path d="M9 18h6M10 21.5h4"/><path d="M12 2.5a6.5 6.5 0 0 0-3.8 11.8c.5.4.8 1 .8 1.7v.5h6V16c0-.7.3-1.3.8-1.7A6.5 6.5 0 0 0 12 2.5z"/>')
  };
  var H, R, T, B;
  function reiniciar() {
    R = { form: null, formKey: '', recuperado: false, errores: [], guardando: false, det: {}, origen: 'reMias', confirmar: '', bandeja: null, tab: 'atender',
      filtro: { herr: '', sede: '', q: '' } };
    T = { form: null, formKey: '', recuperado: false, errores: [], guardando: false, det: {}, origen: 'tbMias', confirmar: false, recien: '',
      deHuella: null, forzarHuella: false, copiando: {}, banco: null, bancoTab: 'materia', bancoPide: 0, bancoErr: '',
      filtro: { sede: '', asignatura: '', docente: '', tipo: '', herramienta: '', q: '' } };
    B = { lista: null, listaT: 0, listaErr: '', pide: 0, ver: 48, filtro: { q: '', asignatura: '', subnivel: '', tipo: '', herramienta: '', origen: '' },
      det: {}, origen: 'banco', origenId: '', form: null, formKey: '', recuperado: false, conflicto: false, errores: [], guardando: false, confirmar: false,
      recien: '', recienNuevo: false, deHuella: null, forzarHuella: false, copiando: {}, reportar: false, repMotivo: '', ocultar: false, mod: null };
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
  function lunes() { var d = new Date(); d.setDate(d.getDate() - (d.getDay() + 6) % 7); return EA.iso(d); }
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
  function reStat() {
    var l = S.re.mias, listas = l.filter(function (s) { return s.estado === 'lista'; }).length, curso = l.filter(function (s) { return s.estado === 'recibida' || s.estado === 'proceso'; }).length;
    if (!listas && !curso) return '<p class="stat">Pídelo con ' + S.re.plazo + ' días hábiles de anticipación</p>';
    return '<p class="stat">' + (listas ? '<b>' + listas + '</b> ' + (listas === 1 ? 'listo' : 'listos') + (curso ? ' · ' : '') : '') + (curso ? '<b>' + curso + '</b> en curso' : '') + '</p>';
  }
  function vInicio() {
    var semana = S.hu.mias.filter(function (h) { return h.fecha >= lunes(); }).length, pend = porContinuar().length;
    var h = EA.tb('Portal de Recursos Institucionales · ' + esc(U().sede), 'Hola, ' + esc(primerNombre()), '', '¿Qué vas a hacer hoy?');
    h += '<div class="opciones">' +
      tarjeta('c1', ICO.huella, 'Huella de clases', 'Registra los contenidos que impartiste, lo que hicieron tus estudiantes y la evidencia de la clase.',
        '<p class="stat"><b>' + semana + '</b> ' + (semana === 1 ? 'registro' : 'registros') + ' esta semana' + (pend ? ' · <b>' + pend + '</b> por continuar' : '') + '</p>',
        '<button class="btn" type="button" data-go="huella">Registrar huella</button><button class="btn ghost" type="button" data-go="huMias">Mis huellas</button>') +
      (S.re ? tarjeta('c2', ICO.recurso, 'Pedir un recurso', 'Un recurso a medida, acompañamiento o capacitación para iPad, MAXHUB, metaverso, aula inmersiva y podcast.',
        reStat(), '<button class="btn" type="button" data-go="recurso">Pedir un recurso</button><button class="btn ghost" type="button" data-go="reMias">Mis solicitudes</button>')
        : pronto('c2', ICO.recurso, 'Pedir un recurso', 'Plantillas para podcast, aula inmersiva y metaverso, o recursos digitales para tu clase.')) +
      (S.tb ? tarjeta('c3', ICO.trabajos, 'Trabajos de mis estudiantes', 'Sube los podcasts, videos, presentaciones, modelos y productos que crearon tus estudiantes.',
        '<p class="stat"><b>' + S.tb.mios.length + '</b> ' + (S.tb.mios.length === 1 ? 'trabajo subido' : 'trabajos subidos') + ' este año</p>',
        '<button class="btn" type="button" data-go="trabajo">Subir trabajo</button><button class="btn ghost" type="button" data-go="tbMias">Mis trabajos</button>')
        : pronto('c3', ICO.trabajos, 'Trabajos de mis estudiantes', 'Sube los trabajos que crearon tus estudiantes.')) +
      '</div>';
    if (S.bn) {
      var bn = S.bn;
      h += '<section class="op bn-op"><span class="ico c6">' + ICO.banco + '</span><div class="bn-op-t"><h2>Banco de ideas</h2>' +
        '<p>Recursos e ideas para diseñar tus clases: lo oficial del Departamento, listo para usar, y lo que comparten tus colegas para adaptarlo.</p>' +
        '<p class="stat"><b>' + bn.total + '</b> ' + (bn.total === 1 ? 'recurso' : 'recursos') + ' · <b>' + bn.oficiales + '</b> ' + (bn.oficiales === 1 ? 'oficial' : 'oficiales') +
        (bn.depto && bn.reportes ? ' · <b>' + bn.reportes + '</b> por revisar' : '') + '</p></div>' +
        '<div class="acts"><button class="btn" type="button" data-go="banco">Explorar el banco</button><button class="btn ghost" type="button" data-go="bnAportar">Compartir un recurso</button></div></section>';
    }
    var extra = [], p = S.hu.permisos;
    if (S.re && S.re.depto) {
      extra.push(tarjeta('c4', ICO.recurso, 'Solicitudes de recursos', 'Bandeja del Departamento: lo que piden los docentes, ordenado por la fecha en que lo usarán.',
        '<p class="stat"><b>' + S.re.porAtender + '</b> por atender</p>', '<button class="btn ghost" type="button" data-go="reBandeja">Abrir bandeja</button>'));
    }
    if (S.tb && S.tb.banco) {
      extra.push(tarjeta('c3', ICO.trabajos, 'Banco de trabajos estudiantiles', 'Los trabajos de los estudiantes por materia y por el docente que los acompañó, con exportación a Excel.', '',
        '<button class="btn ghost" type="button" data-go="tbBanco">Abrir banco</button>'));
    }
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

  /* EA Conecta · Piezas compartidas por los formularios (Huella, Pedir un recurso, Trabajos, Banco de ideas): borradores, curso y subida de archivos. */
  /* ---------------- formularios: cuál está abierto ---------------- */
  // Huella, Pedir un recurso y Trabajos comparten curso, adjuntos y borradores. Cada formulario se marca
  // (_re = solicitud, _tb = trabajo; sin marca = huella) y estas funciones eligen el que está en pantalla.
  var VISTA_FORM = { huella: 'hu', huEditar: 'hu', recurso: 're', trabajo: 'tb', tbEditar: 'tb', bnAportar: 'bn', bnEditar: 'bn' };
  function claveBorrador(id) { return 'hu_borrador:' + U().email + (id ? ':' + id : ''); }
  function claveDe(f) {
    if (f && f._re) return 're_borrador:' + U().email;
    if (f && f._tb) return 'tb_borrador:' + U().email + (f.id ? ':' + f.id : '');
    if (f && f._bn) return 'bn_borrador:' + U().email + (f.id ? ':' + f.id : '');
    return claveBorrador(f ? f.id : '');
  }
  function formActivo() { var k = VISTA_FORM[S.view]; return k === 're' ? R.form : k === 'tb' ? T.form : k === 'bn' ? B.form : H.form; }
  function repintar() { var k = VISTA_FORM[S.view]; if (k === 're') vRecurso(); else if (k === 'tb') vTrabajo(); else if (k === 'bn') vBnForm(); else vForm(); }
  function queEs(f) { return f._re ? 'solicitud' : f._tb ? 'trabajo' : f._bn ? 'recurso' : 'huella'; }
  var borradorT;
  function guardarBorrador(f) {
    f = f || formActivo(); if (!f) return;
    if (f === H.form) actualizarErrores(); else if (f === R.form) actualizarErroresRe(); else if (f === T.form) actualizarErroresTb(); else if (f === B.form) actualizarErroresBn();
    clearTimeout(borradorT);
    borradorT = setTimeout(function () { EA.store(claveDe(f), f); }, 300);
  }
  // Abre un archivo de Drive tras comprobar el permiso en el servidor (evidencia, material o trabajo).
  // La pestaña se abre ANTES de la llamada: Safari en iPad bloquea las ventanas abiertas después de esperar.
  function abrirArchivo(boton, accion, datos) {
    if (EA.DEMO) { EA.toast('En el portal publicado, el archivo se abre en Google Drive con tu cuenta.'); return; }
    var w = null;
    try { w = window.open('', '_blank'); if (w) w.opener = null; } catch (e) { w = null; }
    boton.disabled = true;
    EA.api(accion, datos).then(function (r) {
      boton.disabled = false;
      if (w && !w.closed) { w.location.href = r.url; return; }
      var a = document.createElement('a'); a.href = r.url; a.target = '_blank'; a.rel = 'noopener'; a.className = 'btn sm'; a.textContent = 'Abrir ' + (r.nombre || 'archivo');
      boton.replaceWith(a); EA.toast('Toca «Abrir» para ver el archivo.');
    }).catch(function (e) { boton.disabled = false; if (w) w.close(); EA.toast(e.message, true); });
  }
  function opcionesCurso(sel) {
    var c = cat(), mia = U().sede, otra = HU_SEDES.filter(function (s) { return s !== mia; })[0];
    var h = '<option value="">Elige el curso</option>';
    h += '<optgroup label="' + esc(mia) + '">' + (c.cursos[mia] || []).map(function (x) { return opcion(x, x, sel); }).join('') + '</optgroup>';
    if (otra && (c.cursos[otra] || []).length) h += '<optgroup label="' + esc(otra) + ' (otra sede)">' + c.cursos[otra].map(function (x) { return opcion(x, x, sel); }).join('') + '</optgroup>';
    if (sel && !sedeDe(sel)) h += opcion(sel, sel, sel);
    return h;
  }
  function listaEvidencias() {
    var f = formActivo(), out = '';
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
  function subiendo(f) { return H.subidas.filter(function (s) { return s.form === (f || formActivo()) && s.estado === 'subiendo'; }).length; }
  // Mientras sube un archivo, la pantalla del iPad no se apaga (si se apaga, iPadOS corta la subida).
  var pantalla = null;
  function mantenerPantalla() {
    var activas = H.subidas.some(function (s) { return s.estado === 'subiendo'; });
    try {
      if (activas && !pantalla && navigator.wakeLock && document.visibilityState === 'visible') {
        pantalla = 'pidiendo';
        navigator.wakeLock.request('screen').then(function (w) { pantalla = w; w.addEventListener('release', function () { pantalla = null; }); }).catch(function () { pantalla = null; });
      } else if (!activas && pantalla && pantalla.release) { pantalla.release(); pantalla = null; }
    } catch (e) { pantalla = null; }
  }
  document.addEventListener('visibilitychange', function () { if (document.visibilityState === 'visible') mantenerPantalla(); });
  function textoEstado() {
    var n = subiendo();
    if (n) return 'Subiendo ' + n + (n === 1 ? ' archivo' : ' archivos') + '… Mantén esta pantalla abierta; puedes seguir escribiendo.';
    return 'Mientras escribes, se guarda un borrador en este dispositivo.';
  }
  function pintarEvs() { mantenerPantalla(); var el = $('#huEvs'); if (el) el.innerHTML = listaEvidencias(); var t = $('#huEstadoForm'); if (t) t.textContent = textoEstado(); }

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
    var f = formActivo(), lim = S.hu.limites, que = queEs(f);
    Array.prototype.forEach.call(files || [], function (file) {
      var x = huExtension(file.name);
      if (!HU_TIPOS[x]) { EA.toast('No se aceptan archivos .' + (x || 'sin extensión') + '. Expórtalo a PDF, video, audio o imagen, o comprímelo en .zip.', true); return; }
      if (!file.size) { EA.toast('«' + file.name + '» está vacío.', true); return; }
      if (file.size > lim.maxMb * 1048576) { EA.toast('«' + file.name + '» pesa ' + fTam(file.size) + '. El límite es ' + lim.maxMb + ' MB: compártelo como enlace.', true); return; }
      var usados = f.evidencias.filter(function (e) { return e.t === 'a'; }).length + H.subidas.filter(function (s) { return s.form === f; }).length;
      if (usados >= lim.maxArchivos) { EA.toast('Puedes adjuntar hasta ' + lim.maxArchivos + ' archivos por ' + que + '.', true); return; }
      var s = { k: ++H.seq, file: file, n: file.name, s: file.size, x: x, pct: 0, estado: 'subiendo', form: f };
      H.subidas.push(s);
      H.cola = H.cola.then(function () { return subirUno(s); });
    });
    pintarEvs();
  }
  // «Reintentar» continúa la misma sesión de Drive desde lo que ya llegó (auditoría B4); si la sesión
  // expiró, empieza de nuevo.
  function subirUno(s) {
    if (s.cancelado) return null;
    s.estado = 'subiendo'; s.msg = '';
    var sesion = s.sesion ? Promise.resolve(s.sesion) : conReintentos(function () { return EA.api('subidaIniciar', { nombre: s.n, tam: s.s, tipo: s.file.type || '' }); }, 0);
    return sesion.then(function (r) {
      s.sesion = r; s.off = s.off || 0;
      function paso() {
        if (s.cancelado) return null;
        return leerB64(s.file.slice(s.off, Math.min(s.off + r.parte, s.s))).then(function (b64) {
          return conReintentos(function () { return EA.api('subidaParte', { sid: r.sid, inicio: s.off, datos: b64 }, { tiempo: 180000 }); }, 0);
        }).then(function (r2) {
          if (r2.archivo) return r2.archivo;
          s.off = r2.sig; s.pct = Math.min(99, Math.floor(s.off / s.s * 100)); barra(s);
          return paso();
        });
      }
      return paso().catch(function (e) {
        if (/expiró/.test(e.message || '')) { s.sesion = null; s.off = 0; s.pct = 0; }   // la próxima vez, sesión nueva
        throw e;
      });
    }).then(function (archivo) {
      if (!archivo) return;
      if (s.cancelado) { EA.api('evidenciaDescartar', { id: archivo.id }).catch(function () { }); return; }
      H.subidas = H.subidas.filter(function (x) { return x !== s; });
      s.form.evidencias.push(archivo);
      EA.store(claveDe(s.form), s.form);
      if (s.form === formActivo()) pintarEvs(); else mantenerPantalla();
    }).catch(function (e) {
      s.estado = 'error'; s.msg = e.message || 'No se pudo subir.';
      if (s.form === formActivo()) pintarEvs(); else mantenerPantalla();
    });
  }
  function quitarEvidencia(i) {
    var f = formActivo(), e = f.evidencias[i];
    if (!e) return;
    f.evidencias.splice(i, 1);
    // Un archivo subido en este borrador (y no guardado antes) se manda a la papelera.
    if (e.t === 'a' && (f.guardadas || []).indexOf(e.id) < 0) EA.api('evidenciaDescartar', { id: e.id }).catch(function () { });
    guardarBorrador(); pintarEvs();
  }
  window.addEventListener('beforeunload', function (ev) {
    if (H.subidas.some(function (s) { return s.estado === 'subiendo'; })) { ev.preventDefault(); ev.returnValue = ''; }
  });

  /* EA Conecta · Huella de clases: formulario, detalle, Mis huellas, Huellas de mis cursos y Registros. */
  function nuevoForm() {
    return { id: '', fecha: EA.hoy(), curso: '', paralelos: [], asignatura: '', otraAsig: false, asigTexto: '', tema: '', contenidos: '', actividades: '',
      recursos: [], otroOn: false, recursoOtro: '', metodologia: '', estado: '', pendiente: '', evidencias: [], guardadas: [], solicitud: '' };
  }
  function conContenido(f) { return !!(f && (f.curso || f.tema || f.contenidos || f.actividades || (f.evidencias || []).length)); }
  function desdeDetalle(d) {
    var f = nuevoForm(), sede = sedeDe(d.curso), lista = (cat().asignaturas[sede || U().sede] || []);
    f.id = d.id; f.fecha = d.fecha; f.curso = d.curso; f.paralelos = d.paralelos.slice();
    if (lista.indexOf(d.asignatura) >= 0) f.asignatura = d.asignatura; else { f.otraAsig = true; f.asigTexto = d.asignatura; }
    f.tema = d.tema; f.contenidos = d.contenidos; f.actividades = d.actividades; f.recursos = d.recursos.slice();
    f.otroOn = !!d.recursoOtro; f.recursoOtro = d.recursoOtro; f.metodologia = d.metodologia; f.estado = d.estado; f.pendiente = d.pendiente;
    f.evidencias = d.evidencias.slice(); f.guardadas = d.evidencias.filter(function (e) { return e.t === 'a'; }).map(function (e) { return e.id; });
    f.solicitud = d.solicitud || '';
    return f;
  }
  // Después de un intento fallido, la lista de lo que falta se actualiza mientras la persona corrige.
  function actualizarErrores() {
    if (!H.errores.length || !H.form) return;
    H.errores = validar(H.form);
    var box = $('#huErr');
    if (!box) return;
    if (!H.errores.length) { box.remove(); return; }
    box.querySelector('ul').innerHTML = H.errores.map(function (e) { return '<li>' + esc(e) + '</li>'; }).join('');
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
  function pendienteAnterior() {
    var f = H.form, asig = f.otraAsig ? f.asigTexto : f.asignatura;
    if (!f.curso || !asig) return '';
    var prev = S.hu.mias.filter(function (h) { return h.id !== f.id && h.curso === f.curso && h.asignatura === asig && (!f.paralelos.length || solapan(h, f)); })[0];
    if (!prev || prev.estado === 'completo') return '';
    return '<div class="callout"><span class="strip amber">Quedó pendiente</span><p><b>' + esc(EA.fFechaLarga(prev.fecha)) + ' · ' + esc(prev.tema) + '.</b> ' + esc(prev.pendiente) + '</p></div>';
  }
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
      solicitudHuella(f) +
      '<label class="f"><span>Metodología <em>· opcional</em></span><input type="text" id="huMet" maxlength="1000" value="' + esc(f.metodologia) + '" placeholder="Ej.: aprendizaje basado en proyectos, trabajo cooperativo"></label>' +
      '<fieldset class="fg"><legend class="lbl">Estado del contenido</legend><div class="estados">' +
      Object.keys(S.hu.estados).map(function (k) {
        return '<label class="' + (f.estado === k ? 'on' : '') + '"><input type="radio" name="huEstado" value="' + k + '"' + (f.estado === k ? ' checked' : '') + '>' + esc(S.hu.estados[k]) + '</label>';
      }).join('') + '</div></fieldset>' +
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
  // Vínculo opcional con un recurso pedido: solo los propios ya listos o entregados que no estén en otra huella.
  function solicitudHuella(f) {
    if (!S.re) return '';
    var l = S.re.mias.filter(function (s) { return s.id === f.solicitud || ((s.estado === 'lista' || s.estado === 'entregada') && (!s.huellaId || s.huellaId === f.id)); });
    if (!l.length) return '';
    return '<label class="f"><span>¿Usaste un recurso que pediste? <em>· opcional</em></span><select id="huSol">' + opcion('', 'No, esta clase no usó un recurso pedido', f.solicitud) +
      l.map(function (s) { return opcion(s.id, pedidoTxt(s) + ' · ' + s.curso + ' · ' + EA.fFecha(s.fechaUso), f.solicitud); }).join('') + '</select></label>';
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
      metodologia: f.metodologia, estado: f.estado, pendiente: f.estado === 'completo' ? '' : f.pendiente, evidencias: f.evidencias, solicitud: f.solicitud || '' };
    EA.api('huGuardar', datos).then(function (r) {
      H.guardando = false;
      clearTimeout(borradorT); EA.store(claveBorrador(f.id));
      var i = S.hu.mias.map(function (x) { return x.id; }).indexOf(r.huella.id);
      if (i >= 0) S.hu.mias[i] = r.huella; else S.hu.mias.unshift(r.huella);
      S.hu.mias.sort(function (a, b) { var x = b.fecha + b.creado, y = a.fecha + a.creado; return x < y ? -1 : x > y ? 1 : 0; });
      if (S.re) EA.api('reInicio').then(function (re) { S.re = re; R.det = {}; }).catch(function () { });
      H.det[r.huella.id] = r.detalle; H.form = null; H.formKey = ''; H.recien = r.huella.id; H.origen = 'huMias';
      EA.go('huellaVer', r.huella.id);
      EA.toast(f.id ? 'Cambios guardados.' : 'Huella guardada.');
    }).catch(function (e) {
      H.guardando = false; H.errores = [e.message];
      if (S.view === 'huella' || S.view === 'huEditar') { vForm(); var box = $('#huErr'); if (box) box.scrollIntoView({ block: 'center' }); }
      else EA.toast(e.message, true);
    });
  }

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
    var acts = '<button class="btn ghost" type="button" data-go="' + esc(volver) + '"' + (H.origenId ? ' data-id="' + esc(H.origenId) + '"' : '') + '>Volver</button>' + (d.propia ? '<button class="btn" type="button" data-go="huEditar" data-id="' + esc(d.id) + '">Editar</button>' : '');
    var h = EA.tb('Huella de clases · ' + esc(EA.fFechaLarga(d.fecha)), esc(d.tema), acts, esc(cursoTxt(d) + ' · ' + d.asignatura + ' · ' + d.sede) + (d.propia ? '' : ' · ' + esc(d.docente)));
    if (H.recien === d.id) {
      h += '<div class="card teal row" style="justify-content:space-between"><span><b>Huella guardada.</b> ¿Registras otra clase?</span><button class="btn sm" type="button" data-go="huella">Registrar otra</button></div>';
      H.recien = '';
    }
    h += '<div class="grid2">' + bloque('Contenidos desarrollados', d.contenidos, 'blue') + bloque('Actividades de los estudiantes', d.actividades, 'green') + '</div>';
    var recs = d.recursos.concat(d.recursoOtro ? [d.recursoOtro] : []);
    h += '<div class="grid2"><section class="card stack" style="gap:10px"><span class="strip">Recursos y metodología</span>' +
      (recs.length ? '<div class="tags">' + recs.map(function (r) { return '<span class="chip">' + esc(r) + '</span>'; }).join('') + '</div>' : '<p class="muted small">Sin recursos registrados.</p>') +
      (d.metodologia ? '<p class="texto"><b>Metodología:</b> ' + esc(d.metodologia) + '</p>' : '') +
      (d.solicitud && d.propia && S.re ? '<div><button class="btn ghost sm" type="button" data-go="solicitudVer" data-id="' + esc(d.solicitud) + '">Ver el recurso que pediste</button></div>' : '') + '</section>' +
      '<section class="card stack" style="gap:10px"><span class="strip pink">Estado del contenido</span><div class="row">' + chipEstado(d.estado) + '<b>' + esc(S.hu.estados[d.estado] || d.estado) + '</b></div>' +
      (d.pendiente ? '<p class="texto"><b>Quedó pendiente:</b> ' + esc(d.pendiente) + '</p>' : '') + '</section></div>';
    h += '<section class="card stack" style="gap:10px"><span class="strip sky">Evidencia de la clase</span>' +
      (d.evidencias.length ? '<div class="evs">' + d.evidencias.map(evVer).join('') + '</div>' : '<p class="muted">Sin evidencia adjunta.</p>') + '</section>';
    // Lo que produjeron los estudiantes en esta clase se registra como trabajo, sin volver a escribir ni a subir nada.
    if (d.propia && S.tb) {
      var hechos = S.tb.mios.filter(function (t) { return t.fecha === d.fecha && t.curso === d.curso && t.asignatura === d.asignatura; }).length;
      h += '<div class="card cream row" style="justify-content:space-between;gap:12px"><span><b>¿Tus estudiantes crearon algo en esta clase?</b> ' +
        (hechos ? 'Ya subiste ' + hechos + (hechos === 1 ? ' trabajo' : ' trabajos') + ' de esta clase.' : 'Súbelo como trabajo: curso, asignatura y evidencias se toman de esta huella.') + '</span>' +
        '<button class="btn sm" type="button" data-hu="tbDesdeHuella">Registrar trabajo de estudiantes</button></div>';
    }
    if (d.propia && S.bn) {
      var compartida = S.bn.mios.some(function (r) { return r.huellaId === d.id; });
      h += '<div class="card sky row" style="justify-content:space-between;gap:12px"><span><b>¿Esta clase le serviría a un colega?</b> ' +
        (compartida ? 'Ya compartiste un recurso del banco a partir de esta clase.' : 'Compártela en el Banco de ideas: el tema, la asignatura, las actividades y las evidencias se toman de esta huella.') + '</span>' +
        '<button class="btn ghost sm" type="button" data-hu="bnDesdeHuella">Compartir en el Banco de ideas</button></div>';
    }
    h += '<p class="small muted">Registrada por ' + esc(d.docente) + ' (' + esc(d.email) + ') el ' + esc(EA.fFechaLarga(d.creado)) + (d.editado ? ' · editada el ' + esc(EA.fFechaLarga(d.editado)) : '') + '.</p>';
    if (d.propia) {
      h += H.confirmar
        ? '<div class="confirm">¿Eliminar esta huella? Sus archivos irán a la papelera de Drive.<button class="btn coral sm" type="button" data-hu="eliminarSi">Sí, eliminar</button><button class="btn ghost sm" type="button" data-hu="eliminarNo">Cancelar</button></div>'
        : '<div><button class="btn ghost sm" type="button" data-hu="eliminarPedir">Eliminar esta huella</button></div>';
    }
    $('#view').innerHTML = h;
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
    EA.api('huExportar', filtrosRegistro(), { tiempo: 180000 }).then(function (r) {
      var filas = [['Fecha', 'Sede', 'Curso', 'Paralelos', 'Asignatura', 'Docente', 'Correo', 'Tema', 'Contenidos desarrollados', 'Actividades de los estudiantes',
        'Recursos', 'Otro recurso', 'Metodología', 'Estado', 'Quedó pendiente', 'Evidencias', 'Registrada', 'Editada']].concat(r.filas.map(function (x) {
        return [x.fecha, x.sede, x.curso, x.paralelos.join(', '), x.asignatura, x.docente, x.email, x.tema, x.contenidos, x.actividades, x.recursos.join(', '), x.recursoOtro,
          x.metodologia, S.hu.estados[x.estado] || x.estado, x.pendiente, x.evidencias.length, String(x.creado).replace('T', ' '), String(x.editado || '').replace('T', ' ')];
      }));
      EA.descargar('huellas-de-clase-' + EA.hoy() + '.csv', EA.csv(filas));
      EA.toast('Archivo descargado: ábrelo con Excel o Numbers.');
    }).catch(function (e) { EA.toast(e.message, true); })
      .then(function () { var b2 = document.querySelector('[data-hu="regCsv"]'); if (b2) { b2.disabled = false; b2.textContent = 'Exportar a Excel (CSV)'; } });
  }

  /* EA Conecta · Pedir un recurso: formulario, catálogo, Mis solicitudes, detalle y bandeja del Departamento. */
  /* ---------------- Pedir un recurso ---------------- */
  var RE_CORTO = { recibida: 'Recibida', proceso: 'En proceso', lista: 'Lista', entregada: 'Entregada', cancelada: 'Cancelada' };
  function chipRe(e) { return '<span class="chip re-' + esc(e) + '"><span class="dot"></span>' + esc(RE_CORTO[e] || e) + '</span>'; }
  function nombreHerr(h) { return h === 'Por recomendar' ? 'Herramienta por recomendar' : h; }
  function pedidoTxt(s) { return (S.re.tipos[s.tipo] || s.tipo) + ' · ' + nombreHerr(s.herramienta); }
  function minimoPlazo() { return reSumarHabiles(EA.hoy(), S.re.plazo); }
  function cuandoUso(s) {
    var hoy = EA.hoy();
    if (s.fechaUso < hoy) return 'Ya pasó';
    if (s.fechaUso === hoy) return 'Hoy';
    var n = reDiasHabiles(hoy, s.fechaUso);
    return n <= 1 ? 'Mañana o el próximo día hábil' : 'En ' + n + ' días hábiles';
  }
  function abiertas(l) { return l.filter(function (s) { return s.estado === 'recibida' || s.estado === 'proceso'; }); }
  function tabsRe(actual) {
    var items = [['recurso', 'Nueva solicitud', null, 'Nueva'], ['reMias', 'Mis solicitudes', S.re.mias.length, 'Mías']];
    return '<nav class="tabs" aria-label="Pedir un recurso">' + items.map(function (t) {
      return '<button type="button" data-go="' + t[0] + '"' + (t[0] === actual ? ' aria-current="page"' : '') + ' aria-label="' + t[1] + '"><span class="largo">' + t[1] + '</span><span class="corto" aria-hidden="true">' + t[3] + '</span>' +
        (t[2] != null ? ' <span class="n">' + t[2] + '</span>' : '') + '</button>';
    }).join('') + '</nav>';
  }
  function nuevoRe() {
    return { _re: 1, tipo: '', herramienta: '', fechaUso: '', curso: '', paralelos: [], asignatura: '', otraAsig: false, asigTexto: '', periodos: 1,
      reserva: '', logro: '', actividad: '', evidenciaLogro: '', evidencias: [], guardadas: [], banco: null };
  }
  function prepararRe() {
    if (R.formKey === 'recurso' && R.form) return;
    var g = EA.load(claveDe({ _re: 1 }));
    R.recuperado = !!(g && g._re && (g.tipo || g.logro || g.actividad || g.banco || (g.evidencias || []).length));
    R.form = R.recuperado ? g : nuevoRe();
    R.errores = []; R.guardando = false; R.formKey = 'recurso';
  }
  function radios(nombre, opciones, valor, clase) {
    return '<div class="' + clase + '">' + opciones.map(function (o) {
      return '<label class="' + (valor === o[0] ? 'on' : '') + '"><input type="radio" name="' + nombre + '" value="' + esc(o[0]) + '"' + (valor === o[0] ? ' checked' : '') + '>' +
        '<span><b>' + esc(o[1]) + '</b>' + (o[2] ? '<small>' + esc(o[2]) + '</small>' : '') + '</span></label>';
    }).join('') + '</div>';
  }
  // Las plantillas listas son los recursos oficiales del Banco de ideas.
  function catalogoPlantillas(herr) {
    var l = S.re.plantillas.filter(function (p) { return !herr || herr === 'Por recomendar' || (p.herramientas || []).indexOf(herr) >= 0; });
    var banco = S.bn ? '<button class="btn ghost sm" type="button" data-hu="reBancoOficiales">Explorar el Banco de ideas</button>' : '';
    if (!l.length) {
      return '<div class="card cream stack" style="gap:8px"><b>Todavía no hay recursos oficiales' + (herr && herr !== 'Por recomendar' ? ' para ' + esc(herr) : '') + ' en el Banco de ideas.</b>' +
        '<p class="small" style="margin:0">Pide un recurso a medida: el Departamento lo prepara para tu clase.</p><div class="row"><button class="btn sm" type="button" data-hu="reAMedida">Pedir un recurso a medida</button>' + banco + '</div></div>';
    }
    return '<p class="hint" style="margin:0">Oficiales del Departamento en el Banco de ideas: listos para usar tal cual. Si necesitas ajustarlo, pide una adaptación desde el recurso.</p>' +
      '<div class="plantillas">' + l.map(function (p) {
        return '<button class="plantilla" type="button" data-go="bnVer" data-id="' + esc(p.id) + '"><span class="bn-sello">' + svg('<path d="m5 12 4 4 10-10"/>') + 'Oficial</span><b>' + esc(p.titulo) + '</b>' +
          (p.descripcion ? '<span class="small muted">' + esc(p.descripcion) + '</span>' : '') + '<span class="abrir">Ver recurso</span></button>';
      }).join('') + '</div>' + (banco ? '<div>' + banco + '</div>' : '');
  }
  function vRecurso() {
    if (!S.re) return EA.go('inicio');
    prepararRe();
    var f = R.form, re = S.re, c = cat(), sede = sedeDe(f.curso) || U().sede, asigs = c.asignaturas[sede] || [], lim = S.hu.limites;
    if (f.asignatura && asigs.indexOf(f.asignatura) < 0 && !f.otraAsig) { f.otraAsig = true; f.asigTexto = f.asignatura; f.asignatura = ''; }
    var h = EA.tb('Pedir un recurso', 'Solicitud de recurso', '', 'Pídelo con al menos ' + re.plazo + ' días hábiles de anticipación. Lo atiende el Departamento de Experiencias de Aprendizaje.');
    h += tabsRe('recurso');
    if (R.recuperado) h += '<div class="card cream row" style="justify-content:space-between"><span><b>Recuperamos lo que estabas escribiendo</b> en este dispositivo.</span><button class="btn ghost sm" type="button" data-hu="descartarBorrador">Empezar de cero</button></div>';
    h += '<form id="reForm" class="stack" novalidate>';
    if (R.errores.length) h += '<div class="err" id="reErr" tabindex="-1" role="alert"><b>Revisa esto antes de enviar:</b><ul>' + R.errores.map(function (e) { return '<li>' + esc(e) + '</li>'; }).join('') + '</ul></div>';
    // 1. ¿Qué necesitas?
    h += '<section class="card stack sec"><div class="sec-h"><h2><span class="num n1">1</span>¿Qué necesitas?</h2></div>' +
      '<fieldset class="fg"><legend class="lbl">Tipo de apoyo</legend>' + radios('reTipo', Object.keys(re.tipos).map(function (k) { return [k, re.tipos[k], re.tiposDesc[k]]; }), f.tipo, 'tipos') + '</fieldset>' +
      '<fieldset class="fg"><legend class="lbl">Herramienta</legend>' + radios('reHerr', re.herramientas.map(function (x) { return [x, x === 'Por recomendar' ? 'No sé cuál conviene: recomiéndenme' : x]; }), f.herramienta, 'pills') + '</fieldset></section>';
    if (f.tipo === 'plantilla') {
      h += '<section class="card stack sec"><div class="sec-h"><h2><span class="num n2">2</span>Catálogo de plantillas</h2></div>' + catalogoPlantillas(f.herramienta) + '</section></form>';
      $('#view').innerHTML = h; return;
    }
    // 2. La clase
    var minimo = minimoPlazo(), fuera = f.fechaUso && f.fechaUso < minimo;
    h += '<section class="card stack sec"><div class="sec-h"><h2><span class="num n2">2</span>La clase</h2>' +
      (S.hu.mias.length ? '<button class="btn ghost sm" type="button" data-hu="repetir">Repetir el último curso</button>' : '') + '</div>' +
      '<div class="form"><label class="f"><span>Fecha en que lo usarás</span><input type="date" id="reFecha" min="' + EA.hoy() + '" value="' + esc(f.fechaUso) + '"></label>' +
      '<label class="f"><span>Curso</span><select id="huCurso">' + opcionesCurso(f.curso) + '</select></label>' +
      '<label class="f"><span>Duración</span><select id="rePer">' + [1, 2, 3, 4, 5, 6].map(function (n) { return opcion(n, n + (n === 1 ? ' periodo' : ' periodos') + ' de 40 min', f.periodos); }).join('') + '</select></label></div>' +
      '<p class="hint" id="rePlazo" style="margin:0">' + (fuera ? '' : 'Con el plazo de ' + re.plazo + ' días hábiles, puedes pedirlo para el ' + esc(EA.fFechaLarga(minimo)) + ' o después.') + '</p>' +
      (fuera ? '<div class="err" style="margin:0"><b>Fuera de plazo.</b> Lo pides con menos de ' + re.plazo + ' días hábiles: el Departamento hará lo posible, pero no se garantiza para esa fecha. La solicitud queda marcada como fuera de plazo.</div>' : '') +
      '<div class="fg" role="group" aria-labelledby="reParL"><span class="lbl" id="reParL">Paralelo <em>· puedes marcar varios</em></span><div class="seg">' +
      (f.curso ? (c.paralelos[sede] || []).map(function (p) { return '<button type="button" data-hu="par" data-v="' + esc(p) + '" aria-pressed="' + (f.paralelos.indexOf(p) >= 0) + '">' + esc(p) + '</button>'; }).join('') : '<span class="hint">Primero elige el curso.</span>') + '</div></div>' +
      '<div class="form"><label class="f"><span>Asignatura</span><select id="huAsig"><option value="">Elige la asignatura</option>' +
      asigs.map(function (a) { return opcion(a, a, f.otraAsig ? '' : f.asignatura); }).join('') + '<option value="__otra"' + (f.otraAsig ? ' selected' : '') + '>Otra (escríbela)</option></select></label>' +
      (f.otraAsig ? '<label class="f"><span>¿Cuál asignatura?</span><input type="text" id="huAsigOtra" maxlength="80" value="' + esc(f.asigTexto) + '"></label>' : '') + '</div>';
    if (re.conReserva.indexOf(f.herramienta) >= 0) {
      h += '<fieldset class="fg"><legend class="lbl">¿Ya reservaste el espacio?</legend>' + radios('reReserva', [['sí', 'Sí, ya lo reservé'], ['no', 'Todavía no']], f.reserva, 'pills') + '</fieldset>' +
        '<div class="callout"><span class="strip amber">Recuerda hacer la reserva del espacio</span><p>' + esc(f.herramienta) + ' se reserva en el sistema de reservas del colegio. Esta solicitud no reserva el espacio.</p>' +
        (re.reservasUrl ? '<p><a class="btn sm" href="' + esc(re.reservasUrl) + '" target="_blank" rel="noopener noreferrer">Ir al sistema de reservas</a></p>' : '') + '</div>';
    }
    h += '</section>';
    // 3. El propósito
    h += '<section class="card stack sec"><div class="sec-h"><h2><span class="num n3">3</span>El propósito</h2></div>' +
      (f.banco ? '<div class="callout bn-base"><span class="strip sky">Adaptación de un recurso del Banco de ideas</span><p><b>' + esc(f.banco.titulo) + '</b></p>' +
        '<p class="small">Va como referencia. Cuéntanos qué quieres ajustar en «¿Qué harán tus estudiantes con el recurso?».</p>' +
        '<div class="row"><button class="btn ghost sm" type="button" data-go="bnVer" data-id="' + esc(f.banco.id) + '">Ver el recurso</button><button class="btn ghost sm" type="button" data-hu="reQuitarBanco">Quitar</button></div></div>' : '') +
      '<label class="f"><span>¿Qué deben lograr tus estudiantes?</span><textarea id="reLogro" maxlength="1000" placeholder="Ej.: Explicar el recorrido de los alimentos por el sistema digestivo.">' + esc(f.logro) + '</textarea></label>' +
      '<label class="f"><span>¿Qué harán tus estudiantes con el recurso?</span><textarea id="reAct" maxlength="1500" placeholder="Ej.: Recorren el sistema digestivo en el aula inmersiva y narran cada etapa en equipos.">' + esc(f.actividad) + '</textarea></label>' +
      '<label class="f"><span>¿Cómo sabrás que lo lograron? <em>· opcional</em></span><textarea id="reEvid" maxlength="1000" placeholder="Ej.: Cada equipo entrega un mapa narrado en Keynote.">' + esc(f.evidenciaLogro) + '</textarea></label>' +
      '<div class="fg"><span class="lbl">Material de referencia' + (f.banco ? ' <em>· opcional</em>' : '') + '</span><p class="hint" style="margin:0">' +
      (f.banco ? 'El recurso del banco ya es tu referencia. Si quieres, agrega tu planificación o un ejemplo.' : 'Obligatorio: tu planificación, un ejemplo, un boceto o un enlace. Nos muestra exactamente qué buscas.') + '</p>' +
      '<label class="drop" id="huDrop"><input type="file" id="huArchivos" multiple accept="' + ACCEPT + '">' + ICO.subir +
      '<b>Adjuntar material</b><span>Documento, imagen, video, audio, presentación o página web</span>' +
      '<span class="hint">Hasta ' + lim.maxArchivos + ' archivos de ' + lim.maxMb + ' MB cada uno.</span></label>' +
      '<div class="enlace-row"><label class="f"><span>O agrega un enlace</span><input type="url" id="huUrl" inputmode="url" placeholder="https://…" autocomplete="off"></label><button class="btn ghost" type="button" data-hu="agregarEnlace">Agregar</button></div>' +
      '<div class="evs" id="huEvs">' + listaEvidencias() + '</div></div></section>';
    h += '<div class="dock"><div class="card"><span class="hint" id="huEstadoForm" aria-live="polite">' + esc(textoEstado()) + '</span>' +
      '<button class="btn" type="submit" id="reEnviar"' + (R.guardando ? ' disabled' : '') + '>' + (R.guardando ? 'Enviando…' : 'Enviar solicitud') + '</button></div></div></form>';
    $('#view').innerHTML = h;
  }
  function validarRe(f) {
    var e = [], re = S.re;
    if (!f.tipo) e.push('Elige el tipo de apoyo.');
    if (!f.herramienta) e.push('Elige la herramienta.');
    if (!f.fechaUso) e.push('Elige la fecha en que usarás el recurso.'); else if (f.fechaUso < EA.hoy()) e.push('La fecha de uso no puede ser pasada.');
    if (!f.curso) e.push('Elige el curso.');
    if (f.curso && !f.paralelos.length) e.push('Marca al menos un paralelo.');
    if (f.otraAsig ? f.asigTexto.trim().length < 2 : !f.asignatura) e.push('Elige la asignatura.');
    if (re.conReserva.indexOf(f.herramienta) >= 0 && !f.reserva) e.push('Indica si ya reservaste el espacio.');
    if (f.logro.trim().length < 3) e.push('Escribe qué deben lograr tus estudiantes.');
    if (f.actividad.trim().length < 3) e.push('Escribe qué harán tus estudiantes con el recurso.');
    if (!f.evidencias.length && !f.banco) e.push('Adjunta el material de referencia (archivo o enlace).');
    return e;
  }
  function actualizarErroresRe() {
    if (!R.errores.length || !R.form) return;
    R.errores = validarRe(R.form);
    var box = $('#reErr');
    if (!box) return;
    if (!R.errores.length) { box.remove(); return; }
    box.querySelector('ul').innerHTML = R.errores.map(function (e) { return '<li>' + esc(e) + '</li>'; }).join('');
  }
  function enviarRe() {
    var f = R.form;
    if (!f || R.guardando) return;
    if (subiendo(f)) { EA.toast('Espera a que terminen de subir los archivos.', true); return; }
    if (H.subidas.some(function (s) { return s.form === f && s.estado === 'error'; })) { EA.toast('Un archivo no se subió: reintenta o quítalo antes de enviar.', true); return; }
    R.errores = validarRe(f);
    if (R.errores.length) { vRecurso(); var box = $('#reErr'); if (box) { box.scrollIntoView({ block: 'center' }); box.focus({ preventScroll: true }); } return; }
    R.guardando = true;
    var b = $('#reEnviar'); if (b) { b.disabled = true; b.textContent = 'Enviando…'; }
    EA.api('reGuardar', { tipo: f.tipo, herramienta: f.herramienta, fechaUso: f.fechaUso, curso: f.curso, paralelos: f.paralelos,
      asignatura: f.otraAsig ? f.asigTexto.trim() : f.asignatura, asignaturaOtra: !!f.otraAsig, periodos: Number(f.periodos) || 1,
      reserva: S.re.conReserva.indexOf(f.herramienta) >= 0 ? f.reserva : '', logro: f.logro, actividad: f.actividad, evidenciaLogro: f.evidenciaLogro, material: f.evidencias,
      banco: f.banco ? f.banco.id : ''
    }).then(function (r) {
      R.guardando = false; clearTimeout(borradorT); EA.store(claveDe(f));
      S.re.mias.unshift(r.solicitud); R.det[r.solicitud.id] = r.solicitud;
      R.form = null; R.formKey = ''; R.origen = 'reMias'; R.recien = r.solicitud.id;
      EA.go('solicitudVer', r.solicitud.id); EA.toast('Solicitud enviada al Departamento.');
    }).catch(function (e) {
      R.guardando = false; R.errores = [e.message];
      if (S.view === 'recurso') { vRecurso(); var box = $('#reErr'); if (box) box.scrollIntoView({ block: 'center' }); } else EA.toast(e.message, true);
    });
  }
  function itemSolicitud(s, conDocente) {
    return '<button class="hitem" type="button" data-go="solicitudVer" data-id="' + esc(s.id) + '">' +
      '<div class="when">' + EA.fFecha(s.fechaUso) + '<span>' + esc(cuandoUso(s)) + '</span></div>' +
      '<div class="main"><b>' + esc(pedidoTxt(s)) + '</b><span>' + esc(s.curso + ' ' + s.paralelos.join(', ') + ' · ' + s.asignatura + (conDocente ? ' · ' + s.docente : '')) + '</span></div>' +
      '<div class="side">' + chipRe(s.estado) + (s.fueraPlazo ? '<span class="chip fuera">Fuera de plazo</span>' : '') + '</div></button>';
  }
  function vReMias(sinRecargar) {
    if (!sinRecargar) EA.api('reInicio').then(function (re) { var antes = JSON.stringify(S.re.mias); S.re = re; if (S.view === 'reMias' && JSON.stringify(re.mias) !== antes) vReMias(true); }).catch(function () { });
    var l = S.re.mias, listas = l.filter(function (s) { return s.estado === 'lista'; });
    var h = EA.tb('Pedir un recurso', 'Mis solicitudes', '<button class="btn" type="button" data-go="recurso">Nueva solicitud</button>', '');
    h += tabsRe('reMias');
    if (listas.length) h += '<div class="card teal"><b>' + listas.length + (listas.length === 1 ? ' recurso listo' : ' recursos listos') + '.</b> Ábrelo y confirma que lo recibiste.</div>';
    if (!l.length) h += '<div class="card empty-state"><span class="strip blue">Sin solicitudes</span><h2>Todavía no pides ningún recurso</h2><p class="muted">Pide una plantilla, un recurso a medida, acompañamiento o una capacitación corta.</p><p><button class="btn" type="button" data-go="recurso">Pedir un recurso</button></p></div>';
    else h += '<div class="list">' + l.map(function (s) { return itemSolicitud(s, false); }).join('') + '</div>';
    $('#view').innerHTML = h;
  }
  function pasosRe(s) {
    if (s.estado === 'cancelada') return '<div class="steps"><span class="step done"><i>✓</i>Recibida · ' + esc(EA.fFecha(s.fechas.recibida)) + '</span><span class="step now"><i>×</i>Cancelada · ' + esc(EA.fFecha(s.fechas.cancelada)) + '</span></div>';
    var orden = ['recibida', 'proceso', 'lista', 'entregada'], i = orden.indexOf(s.estado);
    return '<div class="steps">' + orden.map(function (k, j) {
      var f = s.fechas[k];
      return '<span class="step ' + (j < i || (j === i && k === 'entregada') ? 'done' : j === i ? 'now' : '') + '"><i>' + (j <= i && f ? '✓' : j + 1) + '</i>' + RE_CORTO[k] + (f ? ' · ' + esc(EA.fFecha(f)) : '') + '</span>';
    }).join('') + '</div>';
  }
  function matVer(s, e) {
    if (e.t === 'e') return '<a class="ev-item ev-link" href="' + esc(e.u) + '" target="_blank" rel="noopener noreferrer"><span class="tipo">' + ICO.enlace + '</span><div class="mid"><span class="nom">' + esc(e.n) + '</span><span class="ev-sub">' + esc(e.u) + '</span></div><span class="abrir">Abrir</span></a>';
    return '<button type="button" class="ev-item ev-link" data-hu="abrirMat" data-a="' + esc(e.id) + '"><span class="tipo">' + esc(String(e.x || '').slice(0, 4)) + '</span><div class="mid"><span class="nom">' + esc(e.n) + '</span><span class="ev-sub">' + fTam(e.s) + ' · se abre en Google Drive</span></div><span class="abrir">Abrir</span></button>';
  }

  function vSolicitud() {
    var id = S.id;
    R.confirmar = '';
    // Se pinta lo que ya se tiene y se trae la versión al día (el Departamento pudo cambiar el estado).
    var previa = R.det[id] || S.re.mias.filter(function (x) { return x.id === id; })[0];
    if (previa) { R.det[id] = previa; pintarSolicitud(); } else EA.loading('Abriendo la solicitud…');
    EA.api('reDetalle', { id: id }).then(function (d) {
      var cambio = JSON.stringify(d) !== JSON.stringify(R.det[id]);
      if (cambio) actualizarSolicitud(d);
    }).catch(function (e) { if (!previa && S.view === 'solicitudVer' && S.id === id) $('#view').innerHTML = '<div class="err">' + esc(e.message) + '</div><p><button class="btn ghost" type="button" data-go="' + esc(R.origen) + '">Volver</button></p>'; });
  }
  function pintarSolicitud() {
    var s = R.det[S.id], depto = S.re.depto, abierta = s.estado === 'recibida' || s.estado === 'proceso';
    var h = EA.tb('Solicitud de recurso · ' + esc(RE_CORTO[s.estado] || s.estado), esc(pedidoTxt(s)), '<button class="btn ghost" type="button" data-go="' + esc(R.origen || 'reMias') + '">Volver</button>',
      esc(s.curso + ' ' + s.paralelos.join(', ') + ' · ' + s.asignatura + ' · para el ' + EA.fFechaLarga(s.fechaUso)) + (s.propia ? '' : ' · ' + esc(s.docente)));
    if (R.recien === s.id) { h += '<div class="card teal"><b>Solicitud enviada.</b> El Departamento la verá en su bandeja. Aquí sigues cada paso con su fecha.</div>'; R.recien = ''; }
    h += '<div class="row" style="justify-content:space-between">' + pasosRe(s) + '<div class="tags">' + (s.fueraPlazo ? '<span class="chip fuera">Fuera de plazo</span>' : '') +
      (s.huellaId ? '<span class="chip hu-completo">Usado en una huella</span>' : '') + '</div></div>';
    if (s.estado === 'lista' || s.estado === 'entregada' || (s.estado === 'cancelada' && s.respuestaNota)) {
      h += '<section class="card ' + (s.estado === 'cancelada' ? 'coral' : 'teal') + ' stack" style="gap:10px"><span class="strip">' + (s.estado === 'cancelada' ? 'Motivo' : 'Respuesta del Departamento') + '</span>' +
        (s.respuestaEnlace ? '<div><a class="btn" href="' + esc(s.respuestaEnlace) + '" target="_blank" rel="noopener noreferrer">Abrir el recurso</a></div>' : '') +
        (s.respuestaNota ? '<p class="texto">' + esc(s.respuestaNota) + '</p>' : '') +
        (s.propia && s.estado === 'lista' ? '<div><button class="btn" type="button" data-hu="reRecibido">Confirmar que lo recibí</button></div>' : '') + '</section>';
    }
    if (depto && abierta) {
      h += '<section class="card cream stack" style="gap:10px"><span class="strip amber">Atender (Departamento)</span>' +
        (s.estado === 'recibida' ? '<div><button class="btn ghost" type="button" data-hu="reProceso">Marcar «En proceso»</button></div>' : '') +
        '<form id="reListaForm" class="stack" style="gap:10px" novalidate><div class="form"><label class="f"><span>Enlace del recurso <em>· si aplica</em></span><input type="url" id="reRespEnlace" placeholder="https://…"></label></div>' +
        '<label class="f"><span>Nota para el docente <em>· obligatoria si no hay enlace (por ejemplo, día y hora del acompañamiento)</em></span><textarea id="reRespNota" maxlength="1500"></textarea></label>' +
        '<div class="row"><button class="btn" type="submit">Marcar como lista y avisar al docente</button><button class="btn ghost" type="button" data-hu="reNoProcede">No procede</button></div></form></section>';
    }
    h += '<div class="grid2"><section class="card stack" style="gap:8px"><span class="strip blue">La clase</span>' +
      '<p class="texto"><b>Fecha de uso:</b> ' + esc(EA.fFechaLarga(s.fechaUso)) + ' (' + esc(cuandoUso(s).toLowerCase()) + ')<br><b>Duración:</b> ' + s.periodos + (s.periodos === 1 ? ' periodo' : ' periodos') + ' de 40 min<br><b>Curso:</b> ' + esc(s.curso + ' ' + s.paralelos.join(', ') + ' · ' + s.sede) + '<br><b>Asignatura:</b> ' + esc(s.asignatura) +
      (s.reserva !== 'no aplica' ? '<br><b>Espacio reservado:</b> ' + (s.reserva === 'sí' ? 'sí' : 'todavía no') : '') + '</p></section>' +
      '<section class="card stack" style="gap:8px"><span class="strip green">El propósito</span><p class="texto"><b>Deben lograr:</b> ' + esc(s.logro) + '</p><p class="texto"><b>Harán con el recurso:</b> ' + esc(s.actividad) + '</p>' +
      (s.evidenciaLogro ? '<p class="texto"><b>Sabrán que lo lograron por:</b> ' + esc(s.evidenciaLogro) + '</p>' : '') + '</section></div>';
    var base = s.bancoId ? '<button type="button" class="ev-item ev-link" data-go="bnVer" data-id="' + esc(s.bancoId) + '"><span class="tipo">' + ICO.banco + '</span><div class="mid"><span class="nom">' + esc(s.bancoTitulo || 'Recurso del Banco de ideas') + '</span><span class="ev-sub">Recurso de base · Banco de ideas</span></div><span class="abrir">Ver</span></button>' : '';
    if (base || s.material.length) h += '<section class="card stack" style="gap:10px"><span class="strip sky">Material de referencia</span><div class="evs">' + base + s.material.map(function (e) { return matVer(s, e); }).join('') + '</div></section>';
    h += '<p class="small muted">Pedida por ' + esc(s.docente) + ' (' + esc(s.email) + ') el ' + esc(EA.fFechaLarga(s.creado)) + (s.atendidoPor ? ' · atiende ' + esc(s.atendidoPor) : '') + '.</p>';
    if (s.propia && s.estado === 'recibida') {
      h += R.confirmar === 'cancelar' ? '<div class="confirm">¿Cancelar esta solicitud?<button class="btn coral sm" type="button" data-hu="reCancelarSi">Sí, cancelar</button><button class="btn ghost sm" type="button" data-hu="reNo">No</button></div>'
        : '<div><button class="btn ghost sm" type="button" data-hu="reCancelar">Cancelar solicitud</button></div>';
    }
    $('#view').innerHTML = h;
  }
  function actualizarSolicitud(sol, msg) {
    R.det[sol.id] = sol;
    var i = S.re.mias.map(function (x) { return x.id; }).indexOf(sol.id);
    if (i >= 0) S.re.mias[i] = sol;
    if (R.bandeja) { var j = R.bandeja.solicitudes.map(function (x) { return x.id; }).indexOf(sol.id); if (j >= 0) R.bandeja.solicitudes[j] = sol; }
    if (S.view === 'solicitudVer' && S.id === sol.id) pintarSolicitud();
    if (msg) EA.toast(msg);
  }
  function accionRe(boton, accion, datos, msg) {
    if (boton) boton.disabled = true;
    var antes = R.det[datos.id] ? R.det[datos.id].estado : '';
    return EA.api(accion, datos).then(function (r) {
      var abierta = function (e) { return e === 'recibida' || e === 'proceso'; };
      if (S.re.depto && abierta(antes) && !abierta(r.solicitud.estado)) S.re.porAtender = Math.max(0, S.re.porAtender - 1);
      R.confirmar = '';
      actualizarSolicitud(r.solicitud, msg);
    }).catch(function (e) { if (boton) boton.disabled = false; EA.toast(e.message, true); });
  }
  /* ---- bandeja del Departamento ---- */
  function vBandeja() {
    if (!S.re || !S.re.depto) return EA.go('inicio');
    var h = EA.tb('Departamento de Experiencias de Aprendizaje', 'Solicitudes de recursos', '<button class="btn ghost" type="button" data-hu="reRecargar">Actualizar</button>',
      'Ordenadas por la fecha en que el docente usará el recurso.');
    h += '<div id="reKpis"></div><nav class="tabs" aria-label="Bandeja">' + [['atender', 'Por atender'], ['listas', 'Listas'], ['cerradas', 'Cerradas'], ['resumen', 'Resumen por docente']].map(function (t) {
      return '<button type="button" data-hu="reTab" data-v="' + t[0] + '"' + (R.tab === t[0] ? ' aria-current="page"' : '') + '>' + t[1] + '</button>';
    }).join('') + '</nav>';
    h += '<div class="filters"><label class="f q"><span>Buscar</span><input type="search" id="reQ" value="' + esc(R.filtro.q) + '" placeholder="Docente, curso o asignatura" autocomplete="off"></label>' +
      '<label class="f"><span>Herramienta</span><select id="reFHerr">' + opcion('', 'Todas', R.filtro.herr) + S.re.herramientas.map(function (x) { return opcion(x, nombreHerr(x), R.filtro.herr); }).join('') + '</select></label>' +
      '<label class="f"><span>Sede</span><select id="reFSede">' + opcion('', 'Las dos', R.filtro.sede) + HU_SEDES.map(function (x) { return opcion(x, x, R.filtro.sede); }).join('') + '</select></label></div>';
    h += '<div id="reLista"><div class="loading"><span class="spin"></span>Cargando solicitudes…</div></div>';
    $('#view').innerHTML = h;
    if (R.bandeja) pintarBandeja();
    EA.api('reBandeja').then(function (b) { R.bandeja = b; S.re.porAtender = abiertas(b.solicitudes).length; if (S.view === 'reBandeja') pintarBandeja(); })
      .catch(function (e) { if (S.view === 'reBandeja') { var l = $('#reLista'); if (l) l.innerHTML = '<div class="err">' + esc(e.message) + '</div>'; } });
  }
  function pintarBandeja() {
    var b = R.bandeja, f = R.filtro, q = f.q.trim().toLowerCase(), k = $('#reKpis'), l = $('#reLista');
    if (!b || !k || !l) return;
    var todas = b.solicitudes.filter(function (s) {
      if (f.herr && s.herramienta !== f.herr) return false;
      if (f.sede && s.sede !== f.sede) return false;
      if (q && [s.docente, s.email, s.curso, s.asignatura, s.paralelos.join(' ')].join(' ').toLowerCase().indexOf(q) < 0) return false;
      return true;
    });
    var ab = abiertas(todas), entregadas = todas.filter(function (s) { return s.estado === 'entregada'; });
    k.innerHTML = '<div class="tiles"><div class="tile"><b>' + ab.length + '</b><span>Por atender</span></div>' +
      '<div class="tile"><b>' + ab.filter(function (s) { return s.fueraPlazo; }).length + '</b><span>Por atender fuera de plazo</span></div>' +
      '<div class="tile"><b>' + entregadas.length + '</b><span>Entregadas</span></div>' +
      '<div class="tile"><b>' + todas.filter(function (s) { return s.huellaId; }).length + '</b><span>Usadas en una huella</span></div></div>';
    if (R.tab === 'resumen') return pintarResumen(todas, l);
    var lista = R.tab === 'atender' ? ab.slice().sort(function (x, y) { return x.fechaUso < y.fechaUso ? -1 : x.fechaUso > y.fechaUso ? 1 : 0; })
      : todas.filter(function (s) { return R.tab === 'listas' ? s.estado === 'lista' : s.estado === 'entregada' || s.estado === 'cancelada'; });
    if (!lista.length) { l.innerHTML = '<div class="empty"><b>' + (R.tab === 'atender' ? 'Nada por atender' : 'Sin solicitudes aquí') + '</b>' + (R.tab === 'atender' ? 'Las solicitudes nuevas aparecen aquí.' : 'Cambia de pestaña o quita los filtros.') + '</div>'; return; }
    var hoy = EA.hoy();
    l.innerHTML = '<div class="tbl-wrap regs-wrap"><table class="tbl regs hu-regs"><thead><tr><th>Uso</th><th>Docente</th><th>Pedido</th><th>Curso</th><th>Estado</th></tr></thead><tbody>' + lista.map(function (s) {
      var urgente = (s.estado === 'recibida' || s.estado === 'proceso') && reDiasHabiles(hoy, s.fechaUso) <= 2;
      return '<tr class="click' + (urgente ? ' flag' : '') + '" data-go="solicitudVer" data-id="' + esc(s.id) + '" tabindex="0">' +
        '<td data-l="Uso" class="n">' + esc(EA.fFecha(s.fechaUso)) + '<span class="sub2">' + esc(cuandoUso(s)) + '</span></td>' +
        '<td data-l="Docente" class="doc"><b>' + esc(s.docente) + '</b><span class="sub2">' + esc(s.email) + '</span></td>' +
        '<td data-l="Pedido"><b>' + esc(S.re.tipos[s.tipo] || s.tipo) + '</b><span class="sub2">' + esc(nombreHerr(s.herramienta)) + '</span></td>' +
        '<td data-l="Curso"><span class="chip">' + esc(s.sede) + '</span><span class="sub2">' + esc(s.curso + ' ' + s.paralelos.join(', ') + ' · ' + s.asignatura) + '</span></td>' +
        '<td data-l="Estado"><div class="tags">' + chipRe(s.estado) + (s.fueraPlazo ? '<span class="chip fuera">Fuera de plazo</span>' : '') + '</div></td></tr>';
    }).join('') + '</tbody></table></div>';
  }
  function pintarResumen(todas, l) {
    var por = {};
    todas.forEach(function (s) {
      var d = por[s.email] = por[s.email] || { docente: s.docente, email: s.email, n: 0, entregadas: 0, usadas: 0, fuera: 0, herr: {} };
      d.n++; if (s.estado === 'entregada') d.entregadas++; if (s.huellaId) d.usadas++; if (s.fueraPlazo) d.fuera++; d.herr[s.herramienta] = 1;
    });
    var filas = Object.keys(por).map(function (k) { return por[k]; }).sort(function (a, b) { return b.n - a.n || a.docente.localeCompare(b.docente, 'es'); });
    if (!filas.length) { l.innerHTML = '<div class="empty"><b>Todavía no hay solicitudes</b>El resumen aparece con la primera.</div>'; return; }
    l.innerHTML = '<div class="scroll"><table class="tbl"><thead><tr><th>Docente</th><th class="c">Solicitudes</th><th class="c">Entregadas</th><th class="c">Usadas en clase</th><th class="c">Fuera de plazo</th><th>Herramientas</th></tr></thead><tbody>' +
      filas.map(function (d) {
        return '<tr><td><b>' + esc(d.docente) + '</b><div class="small muted">' + esc(d.email) + '</div></td><td class="c n">' + d.n + '</td><td class="c n">' + d.entregadas + '</td><td class="c n">' + d.usadas + '</td><td class="c n">' + d.fuera + '</td>' +
          '<td><div class="tags">' + Object.keys(d.herr).map(function (x) { return '<span class="chip">' + esc(nombreHerr(x)) + '</span>'; }).join('') + '</div></td></tr>';
      }).join('') + '</tbody></table></div><p class="small muted">«Usadas en clase» cuenta las solicitudes que el docente vinculó al registrar la huella de esa clase.</p>';
  }

  /* EA Conecta · Trabajos de mis estudiantes: subir, Mis trabajos, detalle y Banco de trabajos (por materia y docente). */
  var TB_AUT_DESC = { individual: 'Lo hizo un estudiante', equipo: 'Lo hizo un grupo de estudiantes', curso: 'Lo hicieron todos juntos' };
  function tabsTb(actual) {
    var items = [['trabajo', 'Subir trabajo', null, 'Subir'], ['tbMias', 'Mis trabajos', S.tb.mios.length, 'Míos']];
    return '<nav class="tabs" aria-label="Trabajos de mis estudiantes">' + items.map(function (t) {
      return '<button type="button" data-go="' + t[0] + '"' + (t[0] === actual ? ' aria-current="page"' : '') + ' aria-label="' + t[1] + '"><span class="largo">' + t[1] + '</span><span class="corto" aria-hidden="true">' + t[3] + '</span>' +
        (t[2] != null ? ' <span class="n">' + t[2] + '</span>' : '') + '</button>';
    }).join('') + '</nav>';
  }
  function lineasTb(s) { return String(s || '').split('\n').map(function (x) { return x.trim(); }).filter(Boolean); }
  function autoriaTxt(t) { return (S.tb.autorias[t.autoria] || '') + (t.nEstudiantes ? ' · ' + t.nEstudiantes + (t.nEstudiantes === 1 ? ' estudiante' : ' estudiantes') : ''); }
  function itemTrabajo(t, conDocente) {
    return '<button class="hitem" type="button" data-go="trabajoVer" data-id="' + esc(t.id) + '">' +
      '<div class="when">' + EA.fFecha(t.fecha) + '<span>' + esc(String(t.fecha).slice(0, 4)) + '</span></div>' +
      '<div class="main"><b>' + esc(t.titulo) + '</b><span>' + esc(t.tipo + ' · ' + cursoTxt(t) + ' · ' + t.asignatura + (conDocente ? ' · ' + t.docente : '')) + '</span></div>' +
      '<div class="side"><span class="chip">' + esc(S.tb.autorias[t.autoria] || '') + '</span>' + (t.nArchivos ? '<span class="evn">' + ICO.clip + t.nArchivos + '</span>' : '') + '</div></button>';
  }

  /* ---------------- formulario ---------------- */
  function nuevoTb() {
    return { _tb: 1, id: '', titulo: '', tipo: '', fecha: EA.hoy(), curso: '', paralelos: [], asignatura: '', otraAsig: false, asigTexto: '',
      autoria: '', estudiantes: '', herramientas: [], descripcion: '', evidencias: [], guardadas: [], huella: '', deHuella: null, usadas: [] };
  }
  function conContenidoTb(f) { return !!(f && (f.titulo || f.curso || f.tipo || f.estudiantes || f.descripcion || (f.evidencias || []).length)); }
  function ponerAsignatura(f, asignatura, curso) {
    var lista = cat().asignaturas[sedeDe(curso) || U().sede] || [];
    if (!asignatura || lista.indexOf(asignatura) >= 0) { f.asignatura = asignatura || ''; f.otraAsig = false; f.asigTexto = ''; }
    else { f.asignatura = ''; f.otraAsig = true; f.asigTexto = asignatura; }
  }
  // Un trabajo que nace de una huella: la clase, las herramientas y las evidencias vienen de ahí.
  function desdeHuellaTb(d) {
    var f = nuevoTb();
    f.fecha = d.fecha; f.curso = d.curso; f.paralelos = d.paralelos.slice(); ponerAsignatura(f, d.asignatura, d.curso);
    f.herramientas = (d.recursos || []).filter(function (r) { return S.tb.herramientas.indexOf(r) >= 0; });
    f.huella = d.id;
    f.deHuella = { id: d.id, tema: d.tema, fecha: d.fecha, evidencias: (d.evidencias || []).slice() };
    return f;
  }
  function desdeDetalleTb(d) {
    var f = nuevoTb();
    f.id = d.id; f.titulo = d.titulo; f.tipo = d.tipo; f.fecha = d.fecha; f.curso = d.curso; f.paralelos = d.paralelos.slice();
    ponerAsignatura(f, d.asignatura, d.curso);
    f.autoria = d.autoria; f.estudiantes = d.estudiantes.join('\n'); f.herramientas = d.herramientas.slice(); f.descripcion = d.descripcion;
    f.evidencias = d.archivos.slice(); f.guardadas = d.archivos.filter(function (e) { return e.t === 'a'; }).map(function (e) { return e.id; });
    f.huella = d.huellaId;
    return f;
  }
  // Borradores que se descartan: sus archivos subidos (y nunca guardados) van a la papelera.
  function descartarArchivos(f) {
    (f && f.evidencias || []).forEach(function (e) { if (e.t === 'a' && (f.guardadas || []).indexOf(e.id) < 0) EA.api('evidenciaDescartar', { id: e.id }).catch(function () { }); });
  }
  function prepararTb() {
    var clave = S.view + ':' + (S.id || '');
    if (T.formKey === clave && T.form) return true;
    T.errores = []; T.guardando = false; T.recuperado = false; T.conflicto = false;
    if (S.view === 'tbEditar') {
      var d = T.det[S.id];
      if (!d) {
        var id = S.id;
        EA.loading('Abriendo el trabajo…');
        EA.api('tbDetalle', { id: id }).then(function (x) { T.det[id] = x; if (S.view === 'tbEditar' && S.id === id) vTrabajo(); })
          .catch(function (e) { if (S.view === 'tbEditar') $('#view').innerHTML = '<div class="err">' + esc(e.message) + '</div>'; });
        return false;
      }
      if (!d.propio) { EA.go('trabajoVer', S.id); return false; }
      var b = EA.load(claveDe({ _tb: 1, id: d.id }));
      T.recuperado = !!(b && b._tb && b.id === d.id);
      T.form = T.recuperado ? b : desdeDetalleTb(d);
    } else {
      var g = EA.load(claveDe({ _tb: 1 })), hay = !!(g && g._tb && !g.id && conContenidoTb(g));
      if (T.deHuella && hay && !T.forzarHuella) { T.form = g; T.recuperado = true; T.conflicto = true; }   // la persona elige
      else if (T.deHuella) {
        if (hay) descartarArchivos(g);
        T.form = desdeHuellaTb(T.deHuella); T.deHuella = null; T.forzarHuella = false;
        EA.store(claveDe(T.form), T.form);
      } else { T.form = hay ? g : nuevoTb(); T.recuperado = hay; }
    }
    T.formKey = clave;
    return true;
  }
  function deLaHuella(f) {
    var dh = f.deHuella;
    if (!dh || !dh.evidencias.length) return '';
    var lim = S.hu.limites;
    return '<div class="fg"><span class="lbl">De tu huella del ' + esc(EA.fFechaLarga(dh.fecha)) + (dh.tema ? ' · ' + esc(dh.tema) : '') + '</span>' +
      '<p class="hint" style="margin:0">Elige lo que crearon tus estudiantes. Se copia sin volver a subirlo; la huella no cambia.</p><div class="evs">' +
      dh.evidencias.map(function (e) {
        if (e.t === 'e') {
          var ya = f.evidencias.some(function (x) { return x.u === e.u; });
          return '<div class="ev-item"><span class="tipo">' + ICO.enlace + '</span><div class="mid"><span class="nom">' + esc(e.n) + '</span><span class="ev-sub">' + esc(e.u) + '</span></div>' +
            (ya ? '<span class="chip hu-completo">Agregado</span>' : '<button type="button" class="btn ghost sm" data-hu="tbUsarEnlace" data-u="' + esc(e.u) + '">Usar este enlace</button>') + '</div>';
        }
        var usado = f.usadas.indexOf(e.id) >= 0, copiando = T.copiando[e.id];
        return '<div class="ev-item"><span class="tipo">' + esc(String(e.x || huExtension(e.n) || 'arch').slice(0, 4)) + '</span><div class="mid"><span class="nom">' + esc(e.n) + '</span><span class="ev-sub">' + fTam(e.s) + '</span></div>' +
          (usado ? '<span class="chip hu-completo">Agregado</span>' : '<button type="button" class="btn ghost sm" data-hu="tbUsarEv" data-a="' + esc(e.id) + '"' + (copiando ? ' disabled' : '') + '>' + (copiando ? 'Copiando…' : 'Usar este archivo') + '</button>') + '</div>';
      }).join('') + '</div><p class="hint" style="margin:0">Hasta ' + lim.maxArchivos + ' archivos por trabajo, contando los que subas.</p></div>';
  }
  function vTrabajo() {
    if (!S.tb) return EA.go('inicio');
    if (!prepararTb()) return;
    var f = T.form, c = cat(), editar = !!f.id, sede = sedeDe(f.curso) || U().sede, lim = S.hu.limites, tb = S.tb;
    var asigs = c.asignaturas[sede] || [];
    if (f.asignatura && asigs.indexOf(f.asignatura) < 0 && !f.otraAsig) { f.otraAsig = true; f.asigTexto = f.asignatura; f.asignatura = ''; }
    var h = EA.tb('Trabajos de mis estudiantes', editar ? 'Editar trabajo' : 'Subir un trabajo',
      editar ? '<button class="btn ghost" type="button" data-go="trabajoVer" data-id="' + esc(f.id) + '">Cancelar</button>' : '',
      editar ? 'Los cambios quedan registrados con la fecha de edición.' : 'Lo que crearon tus estudiantes: un podcast, un video, una presentación, un modelo o un producto.');
    if (!editar) h += tabsTb('trabajo');
    if (T.conflicto) {
      h += '<div class="card cream stack" style="gap:10px"><b>Tienes un trabajo sin terminar en este dispositivo.</b><span>¿Sigues con ese o empiezas uno nuevo desde la huella? Los archivos del borrador se descartan si empiezas de nuevo.</span>' +
        '<div class="row"><button class="btn sm" type="button" data-hu="tbSeguirBorrador">Seguir con el borrador</button><button class="btn ghost sm" type="button" data-hu="tbEmpezarHuella">Empezar desde la huella</button></div></div>';
    } else if (T.recuperado) {
      h += '<div class="card cream row" style="justify-content:space-between"><span><b>Recuperamos lo que estabas escribiendo</b> en este dispositivo.</span><button class="btn ghost sm" type="button" data-hu="descartarBorrador">' + (editar ? 'Descartar cambios' : 'Empezar de cero') + '</button></div>';
    }
    h += '<form id="tbForm" class="stack" novalidate>';
    if (T.errores.length) h += '<div class="err" id="tbErr" tabindex="-1" role="alert"><b>Revisa esto antes de guardar:</b><ul>' + T.errores.map(function (e) { return '<li>' + esc(e) + '</li>'; }).join('') + '</ul></div>';
    // 1. El trabajo
    h += '<section class="card stack sec"><div class="sec-h"><h2><span class="num n1">1</span>El trabajo</h2></div>' +
      '<div class="form"><label class="f full"><span>Título</span><input type="text" id="tbTitulo" maxlength="120" value="' + esc(f.titulo) + '" placeholder="Ej.: Leyendas de Quito contadas en podcast"></label>' +
      '<label class="f"><span>Fecha en que lo hicieron</span><input type="date" id="tbFecha" max="' + EA.hoy() + '" value="' + esc(f.fecha) + '"></label></div>' +
      '<fieldset class="fg"><legend class="lbl">Tipo de trabajo</legend>' + radios('tbTipo', tb.tipos.map(function (x) { return [x, x]; }), f.tipo, 'pills') + '</fieldset></section>';
    // 2. La clase
    h += '<section class="card stack sec"><div class="sec-h"><h2><span class="num n2">2</span>La clase</h2>' +
      ((tb.mios.length || S.hu.mias.length) && !editar && !f.huella ? '<button class="btn ghost sm" type="button" data-hu="repetir">Repetir el último curso</button>' : '') + '</div>' +
      (f.huella && !editar ? '<p class="hint" style="margin:0">Tomado de tu huella. Puedes cambiarlo.</p>' : '') +
      '<div class="form"><label class="f"><span>Curso</span><select id="huCurso">' + opcionesCurso(f.curso) + '</select></label>' +
      '<label class="f"><span>Asignatura</span><select id="huAsig"><option value="">Elige la asignatura</option>' +
      asigs.map(function (a) { return opcion(a, a, f.otraAsig ? '' : f.asignatura); }).join('') + '<option value="__otra"' + (f.otraAsig ? ' selected' : '') + '>Otra (escríbela)</option></select></label>' +
      (f.otraAsig ? '<label class="f"><span>¿Cuál asignatura?</span><input type="text" id="huAsigOtra" maxlength="80" value="' + esc(f.asigTexto) + '"></label>' : '') + '</div>' +
      '<div class="fg" role="group" aria-labelledby="tbParL"><span class="lbl" id="tbParL">Paralelo <em>· puedes marcar varios</em></span><div class="seg">' +
      (f.curso ? (c.paralelos[sede] || []).concat(f.paralelos.filter(function (p) { return (c.paralelos[sede] || []).indexOf(p) < 0; })).map(function (p) {
        return '<button type="button" data-hu="par" data-v="' + esc(p) + '" aria-pressed="' + (f.paralelos.indexOf(p) >= 0) + '">' + esc(p) + '</button>';
      }).join('') : '<span class="hint">Primero elige el curso.</span>') + '</div></div></section>';
    // 3. Autores
    var nombres = lineasTb(f.estudiantes).length;
    h += '<section class="card stack sec"><div class="sec-h"><h2><span class="num n3">3</span>Autores</h2></div>' +
      '<fieldset class="fg"><legend class="lbl">¿Quién lo hizo?</legend>' + radios('tbAut', Object.keys(tb.autorias).map(function (k) { return [k, tb.autorias[k], TB_AUT_DESC[k]]; }), f.autoria, 'tipos tres') + '</fieldset>' +
      (f.autoria === 'individual' ? '<label class="f"><span>Nombre del estudiante <em>· opcional · nombre y apellido</em></span><input type="text" id="tbEst" maxlength="80" value="' + esc(f.estudiantes) + '" autocomplete="off"></label>' : '') +
      (f.autoria === 'equipo' ? '<label class="f"><span>Nombres de los estudiantes <em>· opcional · uno por línea, nombre y apellido</em></span><textarea id="tbEst" maxlength="4000" placeholder="Ana Torres&#10;Luis Pérez">' + esc(f.estudiantes) + '</textarea>' +
        '<span class="hint" id="tbEstN">' + (nombres ? nombres + (nombres === 1 ? ' nombre' : ' nombres') : 'Hasta ' + tb.maxEstudiantes + ' nombres') + '</span></label>' : '') +
      '</section>';
    // 4. Archivos
    h += '<section class="card stack sec"><div class="sec-h"><h2><span class="num n4">4</span>Archivos del trabajo</h2></div>' + deLaHuella(f) +
      '<div class="fg"><span class="lbl">' + (f.deHuella && f.deHuella.evidencias.length ? 'O sube otros archivos' : 'El trabajo') + '</span>' +
      '<label class="drop" id="huDrop"><input type="file" id="huArchivos" multiple accept="' + ACCEPT + '">' + ICO.subir +
      '<b>Subir el trabajo</b><span>Audio, video, presentación, documento, imagen, modelo 3D o página web</span>' +
      '<span class="hint">Hasta ' + lim.maxArchivos + ' archivos de ' + lim.maxMb + ' MB cada uno. Lo más pesado, compártelo como enlace.</span></label>' +
      '<div class="enlace-row"><label class="f"><span>O agrega un enlace</span><input type="url" id="huUrl" inputmode="url" placeholder="https://…" autocomplete="off"></label><button class="btn ghost" type="button" data-hu="agregarEnlace">Agregar</button></div>' +
      '<div class="evs" id="huEvs">' + listaEvidencias() + '</div></div></section>';
    // 5. Más detalles
    h += '<section class="card stack sec"><div class="sec-h"><h2><span class="num n5">5</span>Más detalles <em class="opc">· opcional</em></h2></div>' +
      '<div class="fg" role="group" aria-labelledby="tbHerrL"><span class="lbl" id="tbHerrL">Herramientas que usaron</span><div class="seg">' +
      tb.herramientas.concat(f.herramientas.filter(function (x) { return tb.herramientas.indexOf(x) < 0; })).map(function (x) {
        return '<button type="button" data-hu="tbHerr" data-v="' + esc(x) + '" aria-pressed="' + (f.herramientas.indexOf(x) >= 0) + '">' + esc(x) + '</button>';
      }).join('') + '</div></div>' +
      '<label class="f"><span>Sobre el trabajo</span><textarea id="tbDesc" maxlength="800" placeholder="Ej.: Cada equipo investigó una leyenda y la narró con efectos de sonido grabados en GarageBand.">' + esc(f.descripcion) + '</textarea></label></section>';
    h += '<div class="dock"><div class="card"><span class="hint" id="huEstadoForm" aria-live="polite">' + esc(textoEstado()) + '</span>' +
      '<button class="btn" type="submit" id="tbGuardar"' + (T.guardando || T.conflicto ? ' disabled' : '') + '>' + (T.guardando ? 'Guardando…' : editar ? 'Guardar cambios' : 'Guardar trabajo') + '</button></div></div></form>';
    $('#view').innerHTML = h;
  }
  function validarTb(f) {
    var e = [];
    if (f.titulo.trim().length < 3) e.push('Escribe el título del trabajo.');
    if (!f.fecha) e.push('Elige la fecha en que lo hicieron.'); else if (f.fecha > EA.hoy()) e.push('La fecha no puede ser futura.');
    if (!f.tipo) e.push('Elige el tipo de trabajo.');
    if (!f.curso) e.push('Elige el curso.');
    if (f.curso && !f.paralelos.length) e.push('Marca al menos un paralelo.');
    if (f.otraAsig ? f.asigTexto.trim().length < 2 : !f.asignatura) e.push('Elige la asignatura.');
    if (!f.autoria) e.push('Indica quién lo hizo: un estudiante, un equipo o todo el curso.');
    var n = f.autoria === 'curso' ? 0 : lineasTb(f.estudiantes).length;
    if (f.autoria === 'individual' && n > 1) e.push('Un trabajo individual lleva un solo nombre. Si lo hicieron varios, elige «En equipo».');
    if (n > S.tb.maxEstudiantes) e.push('Escribe como máximo ' + S.tb.maxEstudiantes + ' nombres.');
    if (!f.evidencias.length) e.push('Adjunta el trabajo: un archivo o un enlace.');
    return e;
  }
  function actualizarErroresTb() {
    if (!T.errores.length || !T.form) return;
    T.errores = validarTb(T.form);
    var box = $('#tbErr');
    if (!box) return;
    if (!T.errores.length) { box.remove(); return; }
    box.querySelector('ul').innerHTML = T.errores.map(function (e) { return '<li>' + esc(e) + '</li>'; }).join('');
  }
  function guardarTrabajo() {
    var f = T.form;
    if (!f || T.guardando || T.conflicto) return;
    if (subiendo(f) || Object.keys(T.copiando).length) { EA.toast('Espera a que terminen de subir o copiarse los archivos.', true); return; }
    if (H.subidas.some(function (s) { return s.form === f && s.estado === 'error'; })) { EA.toast('Un archivo no se subió: reintenta o quítalo antes de guardar.', true); return; }
    T.errores = validarTb(f);
    if (T.errores.length) { vTrabajo(); var box = $('#tbErr'); if (box) { box.scrollIntoView({ block: 'center' }); box.focus({ preventScroll: true }); } return; }
    T.guardando = true;
    var b = $('#tbGuardar'); if (b) { b.disabled = true; b.textContent = 'Guardando…'; }
    EA.api('tbGuardar', { id: f.id, titulo: f.titulo, tipo: f.tipo, fecha: f.fecha, curso: f.curso, paralelos: f.paralelos,
      asignatura: f.otraAsig ? f.asigTexto.trim() : f.asignatura, asignaturaOtra: !!f.otraAsig, autoria: f.autoria,
      estudiantes: f.autoria === 'curso' ? [] : lineasTb(f.estudiantes), herramientas: f.herramientas, descripcion: f.descripcion,
      archivos: f.evidencias, huella: f.huella || ''
    }).then(function (r) {
      T.guardando = false; clearTimeout(borradorT); EA.store(claveDe(f));
      var i = S.tb.mios.map(function (x) { return x.id; }).indexOf(r.trabajo.id);
      if (i >= 0) S.tb.mios[i] = r.trabajo; else S.tb.mios.unshift(r.trabajo);
      S.tb.mios.sort(function (a, b2) { var x = b2.fecha + b2.creado, y = a.fecha + a.creado; return x < y ? -1 : x > y ? 1 : 0; });
      T.det[r.trabajo.id] = r.detalle; T.form = null; T.formKey = ''; T.recien = r.trabajo.id; T.origen = 'tbMias'; T.banco = null;
      EA.go('trabajoVer', r.trabajo.id);
      EA.toast(f.id ? 'Cambios guardados.' : 'Trabajo guardado.');
    }).catch(function (e) {
      T.guardando = false; T.errores = [e.message];
      if (VISTA_FORM[S.view] === 'tb') { vTrabajo(); var box = $('#tbErr'); if (box) box.scrollIntoView({ block: 'center' }); } else EA.toast(e.message, true);
    });
  }
  // Copia una evidencia de la huella en Drive (sin volver a subirla) y la agrega como archivo del trabajo.
  function usarEvidencia(boton, id) {
    var f = T.form, lim = S.hu.limites;
    if (!f || T.copiando[id]) return;
    var usados = f.evidencias.filter(function (e) { return e.t === 'a'; }).length + H.subidas.filter(function (s) { return s.form === f; }).length + Object.keys(T.copiando).length;
    if (usados >= lim.maxArchivos) { EA.toast('Puedes adjuntar hasta ' + lim.maxArchivos + ' archivos por trabajo.', true); return; }
    T.copiando[id] = true; boton.disabled = true; boton.textContent = 'Copiando…';
    EA.api('tbCopiar', { huella: f.huella, archivo: id }, { tiempo: 180000 }).then(function (r) {
      delete T.copiando[id];
      f.evidencias.push(r.archivo); f.usadas.push(id);
      EA.store(claveDe(f), f);
      if (T.form === f && VISTA_FORM[S.view] === 'tb') vTrabajo();
    }).catch(function (e) {
      delete T.copiando[id];
      if (T.form === f && VISTA_FORM[S.view] === 'tb') vTrabajo();
      EA.toast(e.message, true);
    });
  }

  /* ---------------- Mis trabajos ---------------- */
  function vTbMias() {
    if (!S.tb) return EA.go('inicio');
    var l = S.tb.mios;
    var h = EA.tb('Trabajos de mis estudiantes', 'Mis trabajos', '<button class="btn" type="button" data-go="trabajo">Subir trabajo</button>', '');
    h += tabsTb('tbMias');
    if (!l.length) {
      h += '<div class="card empty-state"><span class="strip blue">Sin trabajos</span><h2>Todavía no subes ningún trabajo</h2><p class="muted">Sube lo que crearon tus estudiantes, o regístralo desde el detalle de una huella de clase.</p>' +
        '<p><button class="btn" type="button" data-go="trabajo">Subir un trabajo</button></p></div>';
    } else h += '<div class="list">' + l.map(function (t) { return itemTrabajo(t, false); }).join('') + '</div>';
    $('#view').innerHTML = h;
  }

  /* ---------------- detalle ---------------- */
  function vTrabajoVer() {
    var id = S.id;
    T.confirmar = false;
    if (T.det[id]) return pintarTrabajo();
    EA.loading('Abriendo el trabajo…');
    EA.api('tbDetalle', { id: id }).then(function (d) { T.det[id] = d; if (S.view === 'trabajoVer' && S.id === id) pintarTrabajo(); })
      .catch(function (e) { if (S.view === 'trabajoVer' && S.id === id) $('#view').innerHTML = '<div class="err">' + esc(e.message) + '</div><p><button class="btn ghost" type="button" data-go="' + esc(T.origen) + '">Volver</button></p>'; });
  }
  function archivoVer(e) {
    if (e.t === 'e') return '<a class="ev-item ev-link" href="' + esc(e.u) + '" target="_blank" rel="noopener noreferrer"><span class="tipo">' + ICO.enlace + '</span><div class="mid"><span class="nom">' + esc(e.n) + '</span><span class="ev-sub">' + esc(e.u) + '</span></div><span class="abrir">Abrir</span></a>';
    return '<button type="button" class="ev-item ev-link" data-hu="abrirTb" data-a="' + esc(e.id) + '"><span class="tipo">' + esc(String(e.x || '').slice(0, 4)) + '</span><div class="mid"><span class="nom">' + esc(e.n) + '</span><span class="ev-sub">' + fTam(e.s) + ' · se abre en Google Drive</span></div><span class="abrir">Abrir</span></button>';
  }
  function pintarTrabajo() {
    var d = T.det[S.id];
    var acts = '<button class="btn ghost" type="button" data-go="' + esc(T.origen || 'tbMias') + '">Volver</button>' + (d.propio ? '<button class="btn" type="button" data-go="tbEditar" data-id="' + esc(d.id) + '">Editar</button>' : '');
    var h = EA.tb('Trabajo de estudiantes · ' + esc(d.tipo), esc(d.titulo), acts, esc(cursoTxt(d) + ' · ' + d.asignatura + ' · ' + EA.fFechaLarga(d.fecha)) + (d.propio ? '' : ' · acompañó ' + esc(d.docente)));
    if (T.recien === d.id) { h += '<div class="card teal row" style="justify-content:space-between"><span><b>Trabajo guardado.</b> ¿Subes otro?</span><button class="btn sm" type="button" data-go="trabajo">Subir otro</button></div>'; T.recien = ''; }
    h += '<section class="card stack" style="gap:10px"><span class="strip sky">Archivos del trabajo</span><div class="evs">' + d.archivos.map(archivoVer).join('') + '</div></section>';
    var nombres = d.estudiantes.length ? '<div class="tags">' + d.estudiantes.map(function (x) { return '<span class="chip">' + esc(x) + '</span>'; }).join('') + '</div>'
      : '<p class="muted small" style="margin:0">' + (d.autoria === 'curso' ? 'Lo hizo todo el curso.' : 'Sin nombres registrados.') + '</p>';
    h += '<div class="grid2"><section class="card stack" style="gap:10px"><span class="strip green">Autores · ' + esc(S.tb.autorias[d.autoria] || '') + '</span>' + nombres + '</section>' +
      '<section class="card stack" style="gap:10px"><span class="strip">La clase</span><p class="texto"><b>Curso:</b> ' + esc(cursoTxt(d) + ' · ' + d.sede) + '<br><b>Asignatura:</b> ' + esc(d.asignatura) +
      '<br><b>Docente que acompañó:</b> ' + esc(d.docente) + '</p>' +
      (d.huellaId && d.propio ? '<div><button class="btn ghost sm" type="button" data-go="huellaVer" data-id="' + esc(d.huellaId) + '">Ver la huella de esta clase</button></div>' : '') + '</section></div>';
    h += '<section class="card stack" style="gap:10px"><span class="strip pink">Sobre el trabajo</span>' +
      '<p class="texto"><b>Tipo:</b> ' + esc(d.tipo) + (d.herramientas.length ? '<br><b>Herramientas:</b> ' + esc(d.herramientas.join(', ')) : '') + '</p>' +
      (d.descripcion ? '<p class="texto">' + esc(d.descripcion) + '</p>' : '') + '</section>';
    h += '<p class="small muted">Subido por ' + esc(d.docente) + ' (' + esc(d.email) + ') el ' + esc(EA.fFechaLarga(d.creado)) + (d.editado ? ' · editado el ' + esc(EA.fFechaLarga(d.editado)) : '') + '.</p>';
    if (d.propio) {
      h += T.confirmar
        ? '<div class="confirm">¿Eliminar este trabajo? Sus archivos irán a la papelera de Drive.<button class="btn coral sm" type="button" data-hu="tbEliminarSi">Sí, eliminar</button><button class="btn ghost sm" type="button" data-hu="tbEliminarNo">Cancelar</button></div>'
        : '<div><button class="btn ghost sm" type="button" data-hu="tbEliminarPedir">Eliminar este trabajo</button></div>';
    }
    $('#view').innerHTML = h;
  }
  function eliminarTrabajo(boton) {
    var id = S.id; boton.disabled = true;
    EA.api('tbEliminar', { id: id }).then(function () {
      S.tb.mios = S.tb.mios.filter(function (x) { return x.id !== id; }); delete T.det[id]; T.banco = null;
      EA.go('tbMias'); EA.toast('Trabajo eliminado.');
    }).catch(function (e) { boton.disabled = false; EA.toast(e.message, true); });
  }

  /* ---------------- banco de trabajos ---------------- */
  function sedesBanco() { var p = S.hu.permisos; return p.global ? HU_SEDES.slice() : p.coord.slice(); }
  function vTbBanco() {
    if (!S.tb || !S.tb.banco) return EA.go('inicio');
    var sedes = sedesBanco();
    var h = EA.tb('Experiencias de Aprendizaje' + (sedes.length === 1 ? ' · ' + esc(sedes[0]) : ''), 'Banco de trabajos estudiantiles',
      '<button class="btn ghost" type="button" data-hu="tbCsv">Exportar a Excel (CSV)</button>', 'Lo que crearon los estudiantes, por materia y por el docente que acompañó.');
    h += '<div id="tbKpis"></div><div class="filters" id="tbFiltros"></div><div id="tbBancoTabs"></div><div id="tbBancoCuerpo"><div class="loading"><span class="spin"></span>Cargando trabajos…</div></div>';
    $('#view').innerHTML = h;
    if (T.banco) pintarBanco();
    cargarBanco();
  }
  function filtrosBanco() { var f = T.filtro; return { sede: f.sede, asignatura: f.asignatura, docente: f.docente, tipo: f.tipo, herramienta: f.herramienta, q: f.q }; }
  function cargarBanco() {
    var n = ++T.bancoPide;
    EA.api('tbBanco', filtrosBanco()).then(function (b) {
      if (n !== T.bancoPide) return;   // llegó tarde: ya se pidió otra con otros filtros
      T.banco = b; T.bancoErr = '';
      if (S.view === 'tbBanco') pintarBanco();
    }).catch(function (e) {
      if (n !== T.bancoPide) return;
      T.bancoErr = e.message;
      var c = $('#tbBancoCuerpo'); if (c && S.view === 'tbBanco') c.innerHTML = '<div class="err">' + esc(e.message) + '</div>';
    });
  }
  function pintarBanco() {
    var b = T.banco, f = T.filtro, k = $('#tbKpis'), fl = $('#tbFiltros'), tabsEl = $('#tbBancoTabs'), c = $('#tbBancoCuerpo');
    if (!b || !k || !fl || !c) return;
    k.innerHTML = '<div class="tiles"><div class="tile"><b>' + b.total + '</b><span>Trabajos</span></div><div class="tile"><b>' + b.porMateria.length + '</b><span>Materias</span></div>' +
      '<div class="tile"><b>' + b.porDocente.length + '</b><span>Docentes que acompañaron</span></div><div class="tile"><b>' + b.estudiantes + '</b><span>Estudiantes con nombre</span></div></div>';
    // Los filtros se repintan solo si no hay uno con el foco (no se pierde lo que se escribe en Buscar).
    var a = document.activeElement;
    if (!(a && fl.contains(a))) {
      var sedes = sedesBanco();
      fl.innerHTML = '<label class="f q"><span>Buscar</span><input type="search" id="tbQ" value="' + esc(f.q) + '" placeholder="Título, estudiante, docente o curso" autocomplete="off"></label>' +
        (sedes.length > 1 ? '<label class="f"><span>Sede</span><select id="tbFsede">' + opcion('', 'Las dos', f.sede) + sedes.map(function (s) { return opcion(s, s, f.sede); }).join('') + '</select></label>' : '') +
        '<label class="f"><span>Materia</span><select id="tbFasig">' + opcion('', 'Todas', f.asignatura) + b.opciones.asignaturas.map(function (x) { return opcion(x, x, f.asignatura); }).join('') + '</select></label>' +
        '<label class="f"><span>Docente</span><select id="tbFdoc">' + opcion('', 'Todos', f.docente) + b.opciones.docentes.map(function (x) { return opcion(x.email, x.nombre, f.docente); }).join('') + '</select></label>' +
        '<label class="f"><span>Tipo</span><select id="tbFtipo">' + opcion('', 'Todos', f.tipo) + S.tb.tipos.map(function (x) { return opcion(x, x, f.tipo); }).join('') + '</select></label>' +
        '<label class="f"><span>Herramienta</span><select id="tbFherr">' + opcion('', 'Todas', f.herramienta) + S.tb.herramientas.map(function (x) { return opcion(x, x, f.herramienta); }).join('') + '</select></label>';
    }
    var activos = f.sede || f.asignatura || f.docente || f.tipo || f.herramienta || f.q;
    tabsEl.innerHTML = '<div class="row" style="justify-content:space-between"><nav class="tabs" aria-label="Vista del banco">' + [['materia', 'Por materia'], ['docente', 'Por docente'], ['todos', 'Todos los trabajos']].map(function (t) {
      return '<button type="button" data-hu="tbBancoTab" data-v="' + t[0] + '"' + (T.bancoTab === t[0] ? ' aria-current="page"' : '') + '>' + t[1] + '</button>';
    }).join('') + '</nav>' + (activos ? '<button class="btn ghost sm" type="button" data-hu="tbBancoLimpiar">Quitar filtros</button>' : '') + '</div>';
    if (!b.total) { c.innerHTML = '<div class="empty"><b>' + (activos ? 'Ningún trabajo coincide' : 'Todavía no hay trabajos') + '</b>' + (activos ? 'Cambia o quita los filtros.' : 'Aparecen aquí cuando los docentes los suben.') + '</div>'; return; }
    if (T.bancoTab === 'materia') {
      c.innerHTML = '<div class="scroll"><table class="tbl"><thead><tr><th>Materia</th><th class="c">Trabajos</th><th class="c">Docentes</th><th>Último</th><th></th></tr></thead><tbody>' +
        b.porMateria.map(function (m) {
          return '<tr><td><b>' + esc(m.asignatura) + '</b></td><td class="c n">' + m.trabajos + '</td><td class="c n">' + m.docentes + '</td><td class="n">' + esc(EA.fFecha(m.ultima)) + '</td>' +
            '<td class="c"><button class="btn ghost sm" type="button" data-hu="tbBancoVer" data-k="asignatura" data-v="' + esc(m.asignatura) + '">Ver trabajos</button></td></tr>';
        }).join('') + '</tbody></table></div>';
    } else if (T.bancoTab === 'docente') {
      c.innerHTML = '<div class="scroll"><table class="tbl"><thead><tr><th>Docente que acompañó</th><th class="c">Trabajos</th><th>Materias</th><th>Último</th><th></th></tr></thead><tbody>' +
        b.porDocente.map(function (d) {
          return '<tr><td><b>' + esc(d.docente) + '</b><div class="small muted">' + esc(d.email) + '</div></td><td class="c n">' + d.trabajos + '</td>' +
            '<td><div class="tags">' + d.materias.map(function (x) { return '<span class="chip">' + esc(x) + '</span>'; }).join('') + '</div></td><td class="n">' + esc(EA.fFecha(d.ultima)) + '</td>' +
            '<td class="c"><button class="btn ghost sm" type="button" data-hu="tbBancoVer" data-k="docente" data-v="' + esc(d.email) + '">Ver trabajos</button></td></tr>';
        }).join('') + '</tbody></table></div>';
    } else {
      c.innerHTML = '<div class="tbl-wrap regs-wrap"><table class="tbl regs hu-regs"><thead><tr><th>Fecha</th><th>Trabajo</th><th>Materia</th><th>Curso</th><th>Docente</th><th>Autores</th></tr></thead><tbody>' +
        b.filas.map(function (t) {
          return '<tr class="click" data-go="trabajoVer" data-id="' + esc(t.id) + '" tabindex="0"><td data-l="Fecha" class="n">' + esc(EA.fFecha(t.fecha)) + '</td>' +
            '<td data-l="Trabajo"><b>' + esc(t.titulo) + '</b><span class="sub2">' + esc(t.tipo) + (t.nArchivos ? ' · ' + t.nArchivos + (t.nArchivos === 1 ? ' archivo' : ' archivos') : '') + '</span></td>' +
            '<td data-l="Materia">' + esc(t.asignatura) + '</td><td data-l="Curso"><span class="chip">' + esc(t.sede) + '</span><span class="sub2">' + esc(cursoTxt(t)) + '</span></td>' +
            '<td data-l="Docente" class="doc"><b>' + esc(t.docente) + '</b></td><td data-l="Autores">' + esc(autoriaTxt(t)) + '</td></tr>';
        }).join('') + '</tbody></table></div>' + (b.total > b.filas.length ? '<p class="small muted">Se muestran los ' + b.filas.length + ' más recientes de ' + b.total + '. Usa los filtros o exporta a Excel.</p>' : '');
    }
  }
  function csvBanco(boton) {
    boton.disabled = true; boton.textContent = 'Preparando…';
    EA.api('tbExportar', filtrosBanco(), { tiempo: 180000 }).then(function (r) {
      var filas = [['Fecha', 'Sede', 'Curso', 'Paralelos', 'Materia', 'Docente que acompañó', 'Correo', 'Título', 'Tipo', 'Autoría', 'Estudiantes', 'Herramientas', 'Sobre el trabajo', 'Archivos', 'Enlaces', 'Subido', 'Editado']]
        .concat(r.filas.map(function (t) {
          return [t.fecha, t.sede, t.curso, t.paralelos.join(', '), t.asignatura, t.docente, t.email, t.titulo, t.tipo, S.tb.autorias[t.autoria] || t.autoria,
            t.estudiantes.join(', '), t.herramientas.join(', '), t.descripcion,
            t.archivos.filter(function (e) { return e.t === 'a'; }).map(function (e) { return e.n; }).join(' | '),
            t.archivos.filter(function (e) { return e.t === 'e'; }).map(function (e) { return e.u; }).join(' | '), t.creado, t.editado];
        }));
      EA.descargar('banco-de-trabajos-' + EA.hoy() + '.csv', EA.csv(filas));
      EA.toast(r.total + (r.total === 1 ? ' trabajo exportado.' : ' trabajos exportados.'));
    }).catch(function (e) { EA.toast(e.message, true); })
      .then(function () { boton.disabled = false; boton.textContent = 'Exportar a Excel (CSV)'; });
  }

  /* EA Conecta · Banco de ideas: explorar, detalle (oficial o de un colega), compartir, Mis aportes y moderación del Departamento. */
  var BN_PISTA = {
    Keynote: 'En iPad: descárgalo y se abre en Keynote.', Pages: 'En iPad: descárgalo y se abre en Pages.', Numbers: 'En iPad: descárgalo y se abre en Numbers.',
    Word: 'Se ve en Drive. Para editarlo, descárgalo y ábrelo en Word o Pages.', Excel: 'Se ve en Drive. Para editarlo, descárgalo y ábrelo en Excel o Numbers.',
    PowerPoint: 'Se ve en Drive. Para editarlo, descárgalo y ábrelo en PowerPoint o Keynote.', ZIP: 'Descárgalo y ábrelo en Archivos (por ejemplo, un proyecto de GarageBand).',
    'Keynote (iCloud)': 'Se abre en iCloud con tu cuenta de Apple.', 'Pages (iCloud)': 'Se abre en iCloud con tu cuenta de Apple.', 'Numbers (iCloud)': 'Se abre en iCloud con tu cuenta de Apple.',
    'Freeform (iCloud)': 'Se abre en Freeform con tu cuenta de Apple.', Canva: 'Se abre en Canva; si es un enlace de plantilla, Canva crea tu copia.'
  };
  function bnNorm(s) { return String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase(); }
  // «5.º EGB, 6.º EGB, 7.º EGB» → «5.º a 7.º EGB»
  function cursosCorto(l) {
    var m = l.map(function (c) { return String(c).match(/^(.*?)\s+(EGB|BGU)$/); });
    if (!l.length || m.some(function (x) { return !x || x[2] !== m[0][2]; })) return l.join(', ');
    var suf = ' ' + m[0][2], n = m.map(function (x) { return x[1]; });
    return n.length === 1 ? l[0] : n.length === 2 ? n[0] + ' y ' + n[1] + suf : n[0] + ' a ' + n[n.length - 1] + suf;
  }
  function subnivelTxt(v) { var s = (S.bn.subniveles || []).filter(function (x) { return x.v === v; })[0]; return s ? v + ' · ' + cursosCorto(s.cursos) : v; }
  function sello() { return '<span class="bn-sello">' + svg('<path d="m5 12 4 4 10-10"/>') + 'Oficial</span>'; }
  function tabsBn(actual) {
    var items = [['banco', 'Explorar', null, 'Explorar'], ['bnAportar', 'Compartir un recurso', null, 'Compartir'], ['bnMios', 'Mis aportes', S.bn.mios.length, 'Míos']];
    if (S.bn.depto) items.push(['bnModerar', 'Moderación', S.bn.reportes || null, 'Moderar']);
    return '<nav class="tabs" aria-label="Banco de ideas">' + items.map(function (t) {
      return '<button type="button" data-go="' + t[0] + '"' + (t[0] === actual ? ' aria-current="page"' : '') + ' aria-label="' + t[1] + '"><span class="largo">' + t[1] + '</span><span class="corto" aria-hidden="true">' + t[3] + '</span>' +
        (t[2] != null ? ' <span class="n">' + t[2] + '</span>' : '') + '</button>';
    }).join('') + '</nav>';
  }
  function bnCard(r) {
    var meta = r.asignaturas.join(', ') + ' · ' + r.subniveles.join(', ');
    return '<button class="bn-card t-' + esc(r.tipo) + (r.oficial ? ' oficial' : '') + '" type="button" data-go="bnVer" data-id="' + esc(r.id) + '">' +
      '<span class="bn-top"><span class="bn-tipo">' + esc(S.bn.tipos[r.tipo] || r.tipo) + '</span>' + (r.oficial ? sello() : '') +
      (r.estado === 'oculto' ? '<span class="chip fuera">Oculto</span>' : '') + '</span>' +
      '<b class="bn-tit">' + esc(r.titulo) + '</b><span class="bn-para">' + esc(r.paraQue) + '</span>' +
      '<span class="bn-meta">' + esc(meta) + '</span>' +
      '<span class="bn-pie"><span class="bn-autor">' + esc(r.autor) + '</span>' + (r.formatos.length ? '<span class="bn-fmt">' + esc(r.formatos.slice(0, 2).join(' · ') + (r.formatos.length > 2 ? ' +' + (r.formatos.length - 2) : '')) + '</span>' : '') + '</span></button>';
  }
  // Recurso nuevo o editado: la lista del banco y Mis aportes se actualizan sin volver a pedirlas.
  function ponerEnLista(r) {
    var pon = function (l) { var i = l.map(function (x) { return x.id; }).indexOf(r.id); if (i >= 0) l[i] = r; else l.unshift(r); };
    if (B.lista) pon(B.lista.recursos);
    if (r.email === U().email) pon(S.bn.mios);
    var pub = B.lista ? B.lista.recursos.filter(function (x) { return x.estado !== 'oculto'; }) : null;
    if (pub) { S.bn.total = pub.length; S.bn.oficiales = pub.filter(function (x) { return x.oficial; }).length; }
  }

  /* ---------------- explorar ---------------- */
  function vBanco() {
    if (!S.bn) return EA.go('inicio');
    var h = EA.tb('Banco de ideas', 'Recursos e ideas para diseñar tus clases', '<button class="btn" type="button" data-go="bnAportar">Compartir un recurso</button>',
      'Lo oficial del Departamento está listo para usar. Lo que comparten tus colegas es para copiarlo y ajustarlo a tu clase.');
    h += tabsBn('banco') + '<div class="card bn-filtros" id="bnFiltros"></div><div id="bnCuerpo">' + (B.lista ? '' : '<div class="loading"><span class="spin"></span>Cargando el banco…</div>') + '</div>';
    $('#view').innerHTML = h;
    pintarFiltrosBn();
    if (B.lista) pintarBn();
    if (!B.lista || Date.now() - B.listaT > 60000) cargarBn();
  }
  function cargarBn() {
    var n = ++B.pide;
    return EA.api('bnLista').then(function (l) {
      if (n !== B.pide) return;
      B.lista = l; B.listaT = Date.now(); B.listaErr = '';
      S.bn.mios = l.recursos.filter(function (r) { return r.email === U().email; });
      var pub = l.recursos.filter(function (r) { return r.estado !== 'oculto'; });
      S.bn.total = pub.length; S.bn.oficiales = pub.filter(function (r) { return r.oficial; }).length;
      if (S.view === 'banco') pintarBn();
      if (S.view === 'bnMios') vBnMios();
    }).catch(function (e) {
      if (n !== B.pide) return;
      B.listaErr = e.message;
      var c = $('#bnCuerpo'); if (c && S.view === 'banco' && !B.lista) c.innerHTML = '<div class="err">' + esc(e.message) + '</div><p><button class="btn ghost" type="button" data-hu="bnRecargar">Intentar de nuevo</button></p>';
    });
  }
  function pintarFiltrosBn() {
    var f = B.filtro, bn = S.bn, el = $('#bnFiltros');
    if (!el) return;
    el.innerHTML = '<label class="f q"><span>Buscar</span><input type="search" id="bnQ" value="' + esc(f.q) + '" placeholder="Tema, título, herramienta o docente" autocomplete="off" enterkeyhint="search"></label>' +
      '<label class="f"><span>Asignatura</span><select id="bnFasig">' + opcion('', 'Todas', f.asignatura) + bn.asignaturas.map(function (a) { return opcion(a, a, f.asignatura); }).join('') + '</select></label>' +
      '<label class="f"><span>Subnivel</span><select id="bnFsub">' + opcion('', 'Todos', f.subnivel) + bn.subniveles.map(function (s) { return opcion(s.v, subnivelTxt(s.v), f.subnivel); }).join('') + '</select></label>' +
      '<label class="f"><span>Tipo</span><select id="bnFtipo">' + opcion('', 'Todos', f.tipo) + Object.keys(bn.tipos).map(function (k) { return opcion(k, bn.tipos[k], f.tipo); }).join('') + '</select></label>' +
      '<label class="f"><span>Herramienta</span><select id="bnFherr">' + opcion('', 'Todas', f.herramienta) + bn.herramientas.map(function (x) { return opcion(x, x, f.herramienta); }).join('') + '</select></label>' +
      '<div class="seg bn-origen" role="group" aria-label="Quién lo comparte">' + [['', 'Todo'], ['oficial', 'Oficiales'], ['docentes', 'De docentes']].map(function (o) {
        return '<button type="button" data-hu="bnOrigen" data-v="' + o[0] + '" aria-pressed="' + (f.origen === o[0]) + '">' + o[1] + '</button>';
      }).join('') + '</div>';
  }
  function filtrosActivos() { var f = B.filtro; return !!(f.q.trim() || f.asignatura || f.subnivel || f.tipo || f.herramienta || f.origen); }
  function filtrarBn() {
    var f = B.filtro, palabras = bnNorm(f.q).trim().split(/\s+/).filter(Boolean);
    return B.lista.recursos.filter(function (r) {
      if (r.estado === 'oculto') return false;
      if (f.origen === 'oficial' && !r.oficial) return false;
      if (f.origen === 'docentes' && r.oficial) return false;
      // Lo transversal sirve para cualquier asignatura.
      if (f.asignatura && r.asignaturas.indexOf(f.asignatura) < 0 && r.asignaturas.indexOf('Transversal') < 0) return false;
      if (f.subnivel && r.subniveles.indexOf(f.subnivel) < 0) return false;
      if (f.tipo && r.tipo !== f.tipo) return false;
      if (f.herramienta && r.herramientas.indexOf(f.herramienta) < 0) return false;
      if (palabras.length) {
        var t = bnNorm([r.titulo, r.paraQue, r.autor, r.asignaturas.join(' '), r.herramientas.join(' '), r.formatos.join(' '), S.bn.tipos[r.tipo] || ''].join(' '));
        if (!palabras.every(function (p) { return t.indexOf(p) >= 0; })) return false;
      }
      return true;
    });
  }
  function seccionBn(titulo, sub, l, extra) {
    return '<section class="bn-sec"><div class="bn-sec-h"><div><h2>' + titulo + '</h2><p class="muted small">' + sub + '</p></div>' + (extra || '') + '</div>' +
      '<div class="bn-grid">' + l.map(bnCard).join('') + '</div></section>';
  }
  function verMasBn(total) { return total > B.ver ? '<p class="bn-mas"><button class="btn ghost" type="button" data-hu="bnMas">Ver más (' + (total - B.ver) + ')</button></p>' : ''; }
  function pintarBn() {
    var c = $('#bnCuerpo');
    if (!c || !B.lista) return;
    var pub = B.lista.recursos.filter(function (r) { return r.estado !== 'oculto'; });
    if (!pub.length) {
      c.innerHTML = '<div class="card empty-state"><span class="strip blue">Banco vacío</span><h2>Todavía no hay recursos</h2>' +
        '<p class="muted">Sé la primera persona en compartir una idea, una plantilla o un material que te funcionó en clase.</p>' +
        '<p><button class="btn" type="button" data-go="bnAportar">Compartir un recurso</button></p></div>';
      return;
    }
    if (!filtrosActivos()) {
      var of = pub.filter(function (r) { return r.oficial; }), doc = pub.filter(function (r) { return !r.oficial; }), h = '';
      if (of.length) h += seccionBn('Oficiales del Departamento', 'Listos para usar tal cual.', of.slice(0, 6),
        of.length > 6 ? '<button class="btn ghost sm" type="button" data-hu="bnOrigen" data-v="oficial">Ver los ' + of.length + ' oficiales</button>' : '');
      if (doc.length) h += seccionBn('Lo último de tus colegas', 'Ideas para copiar y ajustar a tu clase.', doc.slice(0, B.ver), '') + verMasBn(doc.length);
      else h += '<div class="card cream row bn-invita"><span><b>Todavía no hay aportes de docentes.</b> ¿Tienes una idea que te funcionó? Compártela: a un colega le puede ahorrar una tarde.</span><button class="btn sm" type="button" data-go="bnAportar">Compartir un recurso</button></div>';
      c.innerHTML = h;
      return;
    }
    var l = filtrarBn();
    if (!l.length) {
      c.innerHTML = '<div class="card empty-state"><span class="strip amber">Sin resultados</span><h2>Ningún recurso coincide</h2>' +
        '<p class="muted">Prueba con otra palabra o quita algún filtro.' + (S.re ? ' Si no existe, el Departamento puede preparártelo.' : '') + '</p>' +
        '<p class="row" style="justify-content:center"><button class="btn ghost" type="button" data-hu="bnLimpiar">Quitar filtros</button>' +
        (S.re ? '<button class="btn" type="button" data-hu="bnPedir">Pedirlo al Departamento</button>' : '') + '</p></div>';
      return;
    }
    c.innerHTML = '<div class="row bn-res" style="justify-content:space-between"><b aria-live="polite">' + l.length + (l.length === 1 ? ' recurso' : ' recursos') + '</b>' +
      '<button class="btn ghost sm" type="button" data-hu="bnLimpiar">Quitar filtros</button></div><div class="bn-grid">' + l.slice(0, B.ver).map(bnCard).join('') + '</div>' + verMasBn(l.length);
  }

  /* ---------------- detalle ---------------- */
  function vBnVer() {
    var id = S.id, previo = B.det[id];
    B.confirmar = false; B.reportar = false; B.ocultar = false;
    if (previo) pintarBnVer(); else EA.loading('Abriendo el recurso…');
    EA.api('bnDetalle', { id: id }).then(function (d) {
      var cambio = JSON.stringify(d) !== JSON.stringify(B.det[id]);
      B.det[id] = d;
      if (cambio && S.view === 'bnVer' && S.id === id) pintarBnVer();
    }).catch(function (e) {
      delete B.det[id];
      if (S.view === 'bnVer' && S.id === id) $('#view').innerHTML = '<div class="err">' + esc(e.message) + '</div><p><button class="btn ghost" type="button" data-go="' + esc(B.origen || 'banco') + '"' + (B.origenId ? ' data-id="' + esc(B.origenId) + '"' : '') + '>Volver</button></p>';
    });
  }
  function archivoBn(e, d) {
    var pista = BN_PISTA[e.f] || '', fmt = '<span class="tipo">' + (e.t === 'e' ? ICO.enlace : esc(String(e.x || '').slice(0, 4))) + '</span>';
    if (e.t === 'e') {
      var acts = e.copia
        ? '<a class="btn sm" href="' + esc(e.copia) + '" target="_blank" rel="noopener noreferrer">Hacer mi copia</a><a class="btn ghost sm" href="' + esc(e.u) + '" target="_blank" rel="noopener noreferrer">Ver</a>'
        : '<a class="btn sm' + (d.oficial ? '' : ' ghost') + '" href="' + esc(e.u) + '" target="_blank" rel="noopener noreferrer">Abrir</a>';
      if (e.copia) pista = 'Se crea una copia en tu Drive para editarla.';
      return '<div class="ev-item bn-arch">' + fmt + '<div class="mid"><span class="nom">' + esc(e.n) + '</span><span class="ev-sub">' + esc(e.f) + (pista ? ' · ' + esc(pista) : '') + '</span></div><div class="bn-acts">' + acts + '</div></div>';
    }
    return '<div class="ev-item bn-arch">' + fmt + '<div class="mid"><span class="nom">' + esc(e.n) + '</span><span class="ev-sub">' + esc(e.f) + ' · ' + fTam(e.s) + (pista ? ' · ' + esc(pista) : '') + '</span></div>' +
      '<div class="bn-acts"><button type="button" class="btn sm' + (d.oficial ? '' : ' ghost') + '" data-hu="bnAbrir" data-a="' + esc(e.id) + '">Ver</button>' +
      '<button type="button" class="btn sm' + (d.oficial ? ' ghost' : '') + '" data-hu="bnBajar" data-a="' + esc(e.id) + '">Descargar</button></div></div>';
  }
  function pintarBnVer() {
    var d = B.det[S.id], bn = S.bn;
    if (!d) return;
    var acts = '<button class="btn ghost" type="button" data-go="' + esc(B.origen || 'banco') + '"' + (B.origenId ? ' data-id="' + esc(B.origenId) + '"' : '') + '>Volver</button>' +
      (d.puedeEditar ? '<button class="btn" type="button" data-go="bnEditar" data-id="' + esc(d.id) + '">Editar</button>' : '');
    var h = EA.tb('Banco de ideas · ' + esc(bn.tipos[d.tipo] || d.tipo), esc(d.titulo), acts,
      esc(d.asignaturas.join(', ') + ' · ' + d.subniveles.join(', ')) + ' · compartido por ' + esc(d.autor));
    if (B.recien === d.id) {
      h += '<div class="card teal row" style="justify-content:space-between"><span><b>' + (B.recienNuevo ? 'Publicado en el banco.' : 'Cambios guardados.') + '</b> ' +
        (d.estado === 'oculto' ? 'Sigue oculto: el Departamento lo revisará para volver a publicarlo.' : 'Ya lo ven todos los docentes del colegio.') + '</span>' +
        '<button class="btn sm" type="button" data-go="bnAportar">Compartir otro</button></div>';
      B.recien = '';
    }
    if (d.estado === 'oculto') {
      h += '<div class="card coral stack" style="gap:6px"><b>Oculto por el Departamento</b>' + (d.motivoOculto ? '<span>Motivo: ' + esc(d.motivoOculto) + '</span>' : '') +
        (d.propio ? '<span class="small">Corrígelo con «Editar»: el Departamento lo revisará para volver a publicarlo.</span>' : '') + '</div>';
    }
    h += d.oficial
      ? '<div class="bn-uso oficial">' + sello() + '<p><b>Listo para usar.</b> Lo preparó o revisó el Departamento: ábrelo o haz tu copia.</p></div>'
      : '<div class="bn-uso"><span class="bn-colega">' + ICO.banco + 'De un colega</span><p><b>Haz tu copia y ajústala a tu clase:</b> tu curso, tu tiempo y tus estudiantes.</p></div>';
    if (d.archivos.length) h += '<section class="card stack" style="gap:10px"><span class="strip sky">' + (d.archivos.length === 1 ? 'Archivo' : 'Archivos y enlaces') + '</span><div class="evs">' + d.archivos.map(function (e) { return archivoBn(e, d); }).join('') + '</div></section>';
    var ficha = '<b>Asignaturas:</b> ' + esc(d.asignaturas.join(', ')) + '<br><b>Subniveles:</b> ' + esc(d.subniveles.map(subnivelTxt).join(' · ')) +
      (d.herramientas.length ? '<br><b>Herramientas:</b> ' + esc(d.herramientas.join(', ')) : '') + (d.momentos.length ? '<br><b>Momento de la clase:</b> ' + esc(d.momentos.join(', ')) : '') +
      (d.duracion ? '<br><b>Duración:</b> ' + esc(d.duracion) : '') + (d.dua ? '<br><b>Inclusión:</b> pensado con DUA' : '');
    h += '<div class="grid2"><section class="card stack" style="gap:10px"><span class="strip green">¿Para qué sirve?</span><p class="texto">' + esc(d.paraQue) + '</p></section>' +
      '<section class="card stack" style="gap:10px"><span class="strip">Ficha</span><p class="texto">' + ficha + '</p></section></div>';
    if (d.comoUsar) h += '<section class="card stack" style="gap:10px"><span class="strip pink">¿Cómo se usa en clase?</span><p class="texto">' + esc(d.comoUsar) + '</p></section>';
    if (S.re && !d.propio && d.estado !== 'oculto') {
      h += '<div class="card cream row bn-adaptar" style="justify-content:space-between;gap:12px"><span><b>' + (d.oficial ? '¿Lo necesitas distinto?' : '¿Prefieres que lo ajusten por ti?') + '</b> ' +
        'Pídele al Departamento una adaptación para tu clase: este recurso va como referencia.</span><button class="btn sm" type="button" data-hu="bnAdaptar">Pedir una adaptación</button></div>';
    }
    if (bn.depto) h += moderacionDetalle(d);
    h += '<p class="small muted">Compartido por ' + esc(d.autor) + ' (' + esc(d.email) + ') el ' + esc(EA.fFechaLarga(d.creado)) + (d.editado ? ' · editado el ' + esc(EA.fFechaLarga(d.editado)) : '') + '.' +
      (d.huellaId ? ' <button class="link" type="button" data-go="huellaVer" data-id="' + esc(d.huellaId) + '">Ver la huella de esta clase</button>' : '') + '</p>';
    if (d.propio) {
      h += B.confirmar
        ? '<div class="confirm">¿Eliminar este recurso del banco? Sus archivos irán a la papelera de Drive.<button class="btn coral sm" type="button" data-hu="bnEliminarSi">Sí, eliminar</button><button class="btn ghost sm" type="button" data-hu="bnEliminarNo">Cancelar</button></div>'
        : '<div><button class="btn ghost sm" type="button" data-hu="bnEliminarPedir">Eliminar este recurso</button></div>';
    } else if (!bn.depto && d.estado !== 'oculto') {
      if (d.reportado) h += '<p class="small muted">Reportaste este recurso: el Departamento lo está revisando.</p>';
      else if (!B.reportar) h += '<div><button class="link" type="button" data-hu="bnReportarPedir">Reportar un problema con este recurso</button></div>';
      else {
        h += '<form id="bnRepForm" class="card stack" style="gap:10px" novalidate><span class="strip amber">Reportar al Departamento</span>' +
          '<fieldset class="fg"><legend class="lbl">¿Qué pasa?</legend>' + radios('bnMotivo', Object.keys(bn.motivos).map(function (k) { return [k, bn.motivos[k]]; }), B.repMotivo, 'pills') + '</fieldset>' +
          '<label class="f"><span>Nota <em>· opcional, obligatoria si es «Otro motivo»</em></span><textarea id="bnRepNota" maxlength="500" placeholder="Ej.: el enlace pide permiso de acceso."></textarea></label>' +
          '<p class="hint" style="margin:0">Solo lo ve el Departamento. El recurso sigue publicado hasta que lo revisen.</p>' +
          '<div class="row"><button class="btn sm" type="submit">Enviar reporte</button><button class="btn ghost sm" type="button" data-hu="bnReportarNo">Cancelar</button></div></form>';
      }
    }
    $('#view').innerHTML = h;
  }
  function moderacionDetalle(d) {
    var h = '<section class="card cream stack" style="gap:10px"><span class="strip amber">Moderación (Departamento)</span>';
    if (d.reportes && d.reportes.length) {
      h += '<div class="stack" style="gap:6px">' + d.reportes.map(function (r) {
        return '<div class="bn-rep"><b>' + esc(r.motivo) + '</b>' + (r.nota ? ' · ' + esc(r.nota) : '') + '<span class="small muted"> · ' + esc(r.por) + ', ' + esc(EA.fFecha(r.creado)) + '</span>' +
          '<button class="btn ghost sm" type="button" data-hu="bnDescartar" data-v="' + esc(r.id) + '">Descartar</button></div>';
      }).join('') + '</div>';
    }
    if (d.estado === 'oculto') {
      h += '<div class="row"><button class="btn sm" type="button" data-hu="bnRestaurar">Volver a publicar</button><span class="small muted">Le avisamos por correo a quien lo compartió.</span></div>';
    } else if (B.ocultar) {
      h += '<label class="f"><span>Motivo para quien lo compartió</span><textarea id="bnMotivoOcultar" maxlength="500" placeholder="Ej.: incluye páginas escaneadas de un libro de texto."></textarea></label>' +
        '<div class="row"><button class="btn coral sm" type="button" data-hu="bnOcultarSi">Ocultar y avisar</button><button class="btn ghost sm" type="button" data-hu="bnOcultarNo">Cancelar</button></div>';
    } else {
      h += '<div class="row"><button class="btn ghost sm" type="button" data-hu="bnOcultarPedir">Ocultar del banco</button><span class="small muted">' + (d.oficial ? 'Es oficial.' : 'Para marcarlo como oficial, usa «Editar».') + '</span></div>';
    }
    return h + '</section>';
  }
  function eliminarBn(boton) {
    var id = S.id; boton.disabled = true;
    EA.api('bnEliminar', { id: id }).then(function () {
      S.bn.mios = S.bn.mios.filter(function (x) { return x.id !== id; });
      if (B.lista) B.lista.recursos = B.lista.recursos.filter(function (x) { return x.id !== id; });
      delete B.det[id];
      var pub = B.lista ? B.lista.recursos.filter(function (x) { return x.estado !== 'oculto'; }) : null;
      if (pub) { S.bn.total = pub.length; S.bn.oficiales = pub.filter(function (x) { return x.oficial; }).length; }
      EA.go('bnMios'); EA.toast('Recurso eliminado del banco.');
    }).catch(function (e) { boton.disabled = false; EA.toast(e.message, true); });
  }
  function moderarBn(boton, accion, datos, msg) {
    boton.disabled = true;
    return EA.api(accion, datos).then(function (r) {
      if (r.detalle) { B.det[r.detalle.id] = r.detalle; ponerEnLista(r.recurso); }
      B.ocultar = false; B.mod = null;
      if (S.view === 'bnVer') { if (r.detalle) pintarBnVer(); else vBnVer(); } else if (S.view === 'bnModerar') vBnModerar();
      EA.toast(msg);
      EA.api('bnInicio').then(function (x) { S.bn.reportes = x.reportes; S.bn.total = x.total; S.bn.oficiales = x.oficiales; }).catch(function () { });
    }).catch(function (e) { boton.disabled = false; EA.toast(e.message, true); });
  }
  function reportarBn() {
    var boton = document.querySelector('#bnRepForm [type="submit"]'), nota = ($('#bnRepNota') || {}).value || '';
    if (!B.repMotivo) { EA.toast('Elige qué pasa con el recurso.', true); return; }
    if (B.repMotivo === 'otro' && nota.trim().length < 5) { EA.toast('Cuéntanos el motivo en la nota.', true); var n = $('#bnRepNota'); if (n) n.focus(); return; }
    if (boton) boton.disabled = true;
    var id = S.id;
    EA.api('bnReportar', { id: id, motivo: B.repMotivo, nota: nota }).then(function () {
      if (B.det[id]) B.det[id].reportado = true;
      B.reportar = false; B.repMotivo = '';
      if (S.view === 'bnVer' && S.id === id) pintarBnVer();
      EA.toast('Gracias: el Departamento lo revisará.');
    }).catch(function (e) { if (boton) boton.disabled = false; EA.toast(e.message, true); });
  }
  // «Pedir una adaptación»: abre Pedir un recurso (a medida) con este recurso como referencia.
  function adaptarBn(d, sinBanco) {
    var f = R.form && R.formKey === 'recurso' ? R.form : EA.load(claveDe({ _re: 1 }));
    var conAlgo = f && f._re && (f.logro || f.actividad || (f.evidencias || []).length);
    if (!conAlgo) f = nuevoRe();
    f.tipo = 'medida';
    if (!sinBanco) f.banco = { id: d.id, titulo: d.titulo };
    var herr = (d.herramientas || []).filter(function (x) { return S.re.herramientas.indexOf(x) >= 0; })[0];
    if (herr && !f.herramienta) f.herramienta = herr;
    var asig = (d.asignaturas || []).filter(function (a) { return a !== 'Transversal'; });
    if (asig.length === 1 && !f.asignatura && !f.otraAsig) {
      var lista = cat().asignaturas[sedeDe(f.curso) || U().sede] || [];
      if (lista.indexOf(asig[0]) >= 0) f.asignatura = asig[0];
    }
    R.form = f; R.formKey = 'recurso'; R.recuperado = !!conAlgo; R.errores = []; R.guardando = false;
    EA.store(claveDe(f), f);
    EA.go('recurso');
    if (conAlgo) EA.toast(sinBanco ? 'Seguimos con tu solicitud en curso.' : 'Agregamos el recurso del banco a tu solicitud en curso.');
  }

  /* ---------------- compartir (formulario) ---------------- */
  function nuevoBn() {
    return { _bn: 1, id: '', titulo: '', tipo: '', paraQue: '', asignaturas: [], subniveles: [], herramientas: [], momentos: [], duracion: '', dua: false,
      comoUsar: '', evidencias: [], guardadas: [], huella: '', deHuella: null, usadas: [], derechos: false, oficial: null };
  }
  function conContenidoBn(f) { return !!(f && (f.titulo || f.tipo || f.paraQue || f.comoUsar || (f.evidencias || []).length)); }
  // Un recurso que nace de una huella: tema, asignatura, subnivel, herramientas, actividades y evidencias vienen de ahí.
  function desdeHuellaBn(d) {
    var f = nuevoBn(), bn = S.bn, sub = bnSubnivelDe(d.curso);
    f.titulo = d.tema; f.tipo = 'idea';
    if (bn.asignaturas.indexOf(d.asignatura) >= 0) f.asignaturas = [d.asignatura];
    if (bn.subniveles.some(function (s) { return s.v === sub; })) f.subniveles = [sub];
    f.herramientas = (d.recursos || []).filter(function (r) { return bn.herramientas.indexOf(r) >= 0; });
    f.comoUsar = d.actividades || '';
    f.huella = d.id;
    f.deHuella = { id: d.id, tema: d.tema, fecha: d.fecha, evidencias: (d.evidencias || []).slice() };
    return f;
  }
  function desdeDetalleBn(d) {
    var f = nuevoBn();
    f.id = d.id; f.titulo = d.titulo; f.tipo = d.tipo; f.paraQue = d.paraQue; f.asignaturas = d.asignaturas.slice(); f.subniveles = d.subniveles.slice();
    f.herramientas = d.herramientas.slice(); f.momentos = d.momentos.slice(); f.duracion = d.duracion; f.dua = d.dua; f.comoUsar = d.comoUsar;
    f.evidencias = d.archivos.map(function (e) { return e.t === 'e' ? { t: 'e', u: e.u, n: e.n } : { t: 'a', id: e.id, n: e.n, s: e.s, x: e.x }; });
    f.guardadas = d.archivos.filter(function (e) { return e.t === 'a'; }).map(function (e) { return e.id; });
    f.huella = d.huellaId; f.oficial = d.oficial; f.derechos = true;
    return f;
  }
  function prepararBn() {
    var clave = S.view + ':' + (S.id || '');
    if (B.formKey === clave && B.form) return true;
    B.errores = []; B.guardando = false; B.recuperado = false; B.conflicto = false;
    if (S.view === 'bnEditar') {
      var d = B.det[S.id];
      if (!d) {
        var id = S.id;
        EA.loading('Abriendo el recurso…');
        EA.api('bnDetalle', { id: id }).then(function (x) { B.det[id] = x; if (S.view === 'bnEditar' && S.id === id) vBnForm(); })
          .catch(function (e) { if (S.view === 'bnEditar') $('#view').innerHTML = '<div class="err">' + esc(e.message) + '</div>'; });
        return false;
      }
      if (!d.puedeEditar) { EA.go('bnVer', S.id); return false; }
      var b = EA.load(claveDe({ _bn: 1, id: d.id }));
      B.recuperado = !!(b && b._bn && b.id === d.id);
      B.form = B.recuperado ? b : desdeDetalleBn(d);
    } else {
      var g = EA.load(claveDe({ _bn: 1 })), hay = !!(g && g._bn && !g.id && conContenidoBn(g));
      if (B.deHuella && hay && !B.forzarHuella) { B.form = g; B.recuperado = true; B.conflicto = true; }
      else if (B.deHuella) {
        if (hay) descartarArchivos(g);
        B.form = desdeHuellaBn(B.deHuella); B.deHuella = null; B.forzarHuella = false;
        EA.store(claveDe(B.form), B.form);
      } else { B.form = hay ? g : nuevoBn(); B.recuperado = hay; }
    }
    B.formKey = clave;
    return true;
  }
  function chipsBn(clave, opciones, f, etiqueta) {
    var sel = f[clave], extra = sel.filter(function (x) { return opciones.map(function (o) { return o[0]; }).indexOf(x) < 0; }).map(function (x) { return [x, x]; });
    return '<div class="seg" role="group" aria-label="' + esc(etiqueta) + '">' + opciones.concat(extra).map(function (o) {
      return '<button type="button" data-hu="bnMulti" data-k="' + clave + '" data-v="' + esc(o[0]) + '" aria-pressed="' + (sel.indexOf(o[0]) >= 0) + '">' + esc(o[1]) + '</button>';
    }).join('') + '</div>';
  }
  function deLaHuellaBn(f) {
    var dh = f.deHuella;
    if (!dh || !dh.evidencias.length) return '';
    return '<div class="fg"><span class="lbl">De tu huella del ' + esc(EA.fFechaLarga(dh.fecha)) + (dh.tema ? ' · ' + esc(dh.tema) : '') + '</span>' +
      '<p class="hint" style="margin:0">Elige lo que quieres compartir. Se copia sin volver a subirlo; la huella no cambia.</p><div class="evs">' +
      dh.evidencias.map(function (e) {
        if (e.t === 'e') {
          var ya = f.evidencias.some(function (x) { return x.u === e.u; });
          return '<div class="ev-item"><span class="tipo">' + ICO.enlace + '</span><div class="mid"><span class="nom">' + esc(e.n) + '</span><span class="ev-sub">' + esc(e.u) + '</span></div>' +
            (ya ? '<span class="chip hu-completo">Agregado</span>' : '<button type="button" class="btn ghost sm" data-hu="bnUsarEnlace" data-u="' + esc(e.u) + '">Usar este enlace</button>') + '</div>';
        }
        var usado = f.usadas.indexOf(e.id) >= 0, copiando = B.copiando[e.id];
        return '<div class="ev-item"><span class="tipo">' + esc(String(e.x || huExtension(e.n) || 'arch').slice(0, 4)) + '</span><div class="mid"><span class="nom">' + esc(e.n) + '</span><span class="ev-sub">' + fTam(e.s) + '</span></div>' +
          (usado ? '<span class="chip hu-completo">Agregado</span>' : '<button type="button" class="btn ghost sm" data-hu="bnUsarEv" data-a="' + esc(e.id) + '"' + (copiando ? ' disabled' : '') + '>' + (copiando ? 'Copiando…' : 'Usar este archivo') + '</button>') + '</div>';
      }).join('') + '</div></div>';
  }
  function vBnForm() {
    if (!S.bn) return EA.go('inicio');
    if (!prepararBn()) return;
    var f = B.form, bn = S.bn, editar = !!f.id, lim = S.hu.limites, d = editar ? B.det[f.id] : null, ajeno = d && !d.propio;
    var pideComo = f.tipo === 'idea' || f.tipo === 'proyecto', pideArch = f.tipo === 'plantilla' || f.tipo === 'material';
    var h = EA.tb('Banco de ideas', editar ? 'Editar recurso' : 'Compartir un recurso',
      editar ? '<button class="btn ghost" type="button" data-go="bnVer" data-id="' + esc(f.id) + '">Cancelar</button>' : '',
      editar ? (ajeno ? 'Editas como Departamento: la autoría sigue siendo de ' + esc(d.autor) + '.' : 'Los cambios se ven al instante en el banco.')
        : 'Una idea, una plantilla o un material que te funcionó. Se publica al instante para todos los docentes del colegio.');
    if (!editar) h += tabsBn('bnAportar');
    if (B.conflicto) {
      h += '<div class="card cream stack" style="gap:10px"><b>Tienes un recurso sin terminar en este dispositivo.</b><span>¿Sigues con ese o empiezas uno nuevo desde la huella? Los archivos del borrador se descartan si empiezas de nuevo.</span>' +
        '<div class="row"><button class="btn sm" type="button" data-hu="bnSeguirBorrador">Seguir con el borrador</button><button class="btn ghost sm" type="button" data-hu="bnEmpezarHuella">Empezar desde la huella</button></div></div>';
    } else if (B.recuperado) {
      h += '<div class="card cream row" style="justify-content:space-between"><span><b>Recuperamos lo que estabas escribiendo</b> en este dispositivo.</span><button class="btn ghost sm" type="button" data-hu="descartarBorrador">' + (editar ? 'Descartar cambios' : 'Empezar de cero') + '</button></div>';
    }
    h += '<form id="bnForm" class="stack" novalidate>';
    if (B.errores.length) h += '<div class="err" id="bnErr" tabindex="-1" role="alert"><b>Revisa esto antes de publicar:</b><ul>' + B.errores.map(function (e) { return '<li>' + esc(e) + '</li>'; }).join('') + '</ul></div>';
    // 1. El recurso
    h += '<section class="card stack sec"><div class="sec-h"><h2><span class="num n1">1</span>El recurso</h2></div>' +
      (f.huella && !editar ? '<p class="hint" style="margin:0">Tomado de tu huella. Ajusta lo que quieras.</p>' : '') +
      '<label class="f"><span>Título</span><input type="text" id="bnTitulo" maxlength="120" value="' + esc(f.titulo) + '" placeholder="Ej.: Línea de tiempo narrada en Keynote"></label>' +
      '<fieldset class="fg"><legend class="lbl">¿Qué compartes?</legend>' + radios('bnTipo', Object.keys(bn.tipos).map(function (k) { return [k, bn.tipos[k], bn.tiposDesc[k]]; }), f.tipo, 'tipos') + '</fieldset>' +
      '<label class="f"><span>¿Para qué sirve? <em>· qué aprenden o logran tus estudiantes, en una o dos líneas</em></span><textarea id="bnPara" class="corta" maxlength="300" placeholder="Ej.: Ordenar los hechos de la Independencia y explicar sus causas.">' + esc(f.paraQue) + '</textarea></label></section>';
    // 2. ¿Para quién?
    h += '<section class="card stack sec"><div class="sec-h"><h2><span class="num n2">2</span>¿Para quién?</h2></div>' +
      '<div class="fg"><span class="lbl">Asignaturas <em>· puedes marcar varias; «Transversal» si sirve para cualquiera</em></span>' + chipsBn('asignaturas', bn.asignaturas.map(function (a) { return [a, a]; }), f, 'Asignaturas') + '</div>' +
      '<div class="fg"><span class="lbl">Subniveles <em>· puedes marcar varios</em></span>' + chipsBn('subniveles', bn.subniveles.map(function (s) { return [s.v, subnivelTxt(s.v)]; }), f, 'Subniveles') + '</div></section>';
    // 3. Cómo se usa
    h += '<section class="card stack sec"><div class="sec-h"><h2><span class="num n3">3</span>¿Cómo se usa en clase?' + (pideComo ? '' : ' <em class="opc">· opcional</em>') + '</h2></div>' +
      '<label class="f"><span>Los pasos principales, para que otro docente pueda hacerlo' + (pideComo ? '' : ' <em>· opcional</em>') + '</span><textarea id="bnComo" maxlength="3000" placeholder="Ej.: 1. Inicio: pregunta disparadora (5 min). 2. Cada equipo graba la narración de un hecho. 3. Cierre: exposición de la línea de tiempo.">' + esc(f.comoUsar) + '</textarea></label>' +
      '<div class="fg"><span class="lbl">Momento de la clase <em>· opcional</em></span>' + chipsBn('momentos', bn.momentos.map(function (m) { return [m, m]; }), f, 'Momento de la clase') + '</div>' +
      '<div class="form"><label class="f"><span>Duración <em>· opcional</em></span><select id="bnDur">' + opcion('', 'Sin indicar', f.duracion) + bn.duraciones.map(function (x) { return opcion(x, x, f.duracion); }).join('') + '</select></label></div>' +
      '<div class="fg"><span class="lbl">Herramientas <em>· opcional</em></span>' + chipsBn('herramientas', bn.herramientas.map(function (x) { return [x, x]; }), f, 'Herramientas') + '</div>' +
      '<label class="check"><input type="checkbox" id="bnDua"' + (f.dua ? ' checked' : '') + '><span><b>Pensado para la inclusión (DUA)</b><small>Ofrece varias formas de acceder, participar o demostrar lo aprendido.</small></span></label></section>';
    // 4. Archivos y enlaces
    h += '<section class="card stack sec"><div class="sec-h"><h2><span class="num n4">4</span>Archivos y enlaces' + (pideArch ? '' : ' <em class="opc">· opcional</em>') + '</h2></div>' + deLaHuellaBn(f) +
      '<div class="fg"><label class="drop" id="huDrop"><input type="file" id="huArchivos" multiple accept="' + ACCEPT + '">' + ICO.subir +
      '<b>Subir archivos</b><span>Keynote, Pages, Numbers, Word, Excel, PowerPoint, PDF, imagen, audio, video o .zip</span>' +
      '<span class="hint">Hasta ' + lim.maxArchivos + ' archivos de ' + lim.maxMb + ' MB cada uno. Lo más pesado, compártelo como enlace.</span></label>' +
      '<div class="enlace-row"><label class="f"><span>O agrega un enlace <em>· Documentos de Google, Canva, iCloud, YouTube…</em></span><input type="url" id="huUrl" inputmode="url" placeholder="https://…" autocomplete="off"></label><button class="btn ghost" type="button" data-hu="agregarEnlace">Agregar</button></div>' +
      '<div class="evs" id="huEvs">' + listaEvidencias() + '</div>' +
      '<details class="bn-ayuda"><summary>¿Cómo comparto algo de Freeform, GarageBand, iMovie o Canva?</summary><ul>' +
      '<li><b>Freeform:</b> exporta el tablero como PDF y súbelo, o pega el enlace de iCloud.</li>' +
      '<li><b>GarageBand:</b> exporta la canción en audio para escucharla; para compartir el proyecto editable, comprímelo en Archivos (mantén pulsado → Comprimir) y sube el .zip.</li>' +
      '<li><b>iMovie:</b> exporta el video. Si pesa más de ' + lim.maxMb + ' MB, súbelo a Drive o YouTube y pega el enlace.</li>' +
      '<li><b>Canva:</b> Compartir → Más → Enlace de plantilla: así cada docente abre su propia copia.</li>' +
      '<li><b>Documentos, Presentaciones u Hojas de Google:</b> pega el enlace; en el banco aparece «Hacer mi copia».</li></ul></details></div></section>';
    // 5. Antes de publicar
    var mostrarOficial = bn.depto;
    if (!editar || mostrarOficial) {
      h += '<section class="card stack sec"><div class="sec-h"><h2><span class="num n5">5</span>Antes de publicar</h2></div>' +
        (!editar ? '<label class="check"><input type="checkbox" id="bnDerechos"' + (f.derechos ? ' checked' : '') + '><span><b>Es de mi autoría o tengo derecho a compartirlo</b><small>No incluye libros de texto, páginas escaneadas ni material comprado. Se comparte para uso interno de Eight Academy, citando a quien lo creó.</small></span></label>' : '') +
        (mostrarOficial ? '<label class="check"><input type="checkbox" id="bnOficial"' + (f.oficial !== false ? ' checked' : '') + '><span><b>Recurso oficial del Departamento</b><small>Listo para usar tal cual. Aparece en «Oficiales» y en las plantillas de Pedir un recurso.</small></span></label>' : '') +
        '</section>';
    }
    h += '<div class="dock"><div class="card"><span class="hint" id="huEstadoForm" aria-live="polite">' + esc(textoEstado()) + '</span>' +
      '<button class="btn" type="submit" id="bnGuardar"' + (B.guardando || B.conflicto ? ' disabled' : '') + '>' + (B.guardando ? 'Publicando…' : editar ? 'Guardar cambios' : 'Publicar en el banco') + '</button></div></div></form>';
    $('#view').innerHTML = h;
  }
  function validarBn(f) {
    var e = [];
    if (f.titulo.trim().length < 3) e.push('Escribe el título del recurso.');
    if (!f.tipo) e.push('Elige qué compartes: idea, plantilla, material o proyecto.');
    if (f.paraQue.trim().length < 10) e.push('Escribe para qué sirve en clase: qué aprenden o logran los estudiantes.');
    if (!f.asignaturas.length) e.push('Elige al menos una asignatura (o «Transversal»).');
    if (f.asignaturas.length > 8) e.push('Elige como máximo 8 asignaturas. Si sirve para cualquiera, elige «Transversal».');
    if (!f.subniveles.length) e.push('Elige al menos un subnivel.');
    if ((f.tipo === 'idea' || f.tipo === 'proyecto') && f.comoUsar.trim().length < 20) e.push('Cuenta cómo se usa en clase (los pasos principales).');
    if ((f.tipo === 'plantilla' || f.tipo === 'material') && !f.evidencias.length) e.push('Adjunta la plantilla o el material: un archivo o un enlace.');
    if (!f.id && !f.derechos) e.push('Confirma que es tuyo o que tienes derecho a compartirlo.');
    return e;
  }
  function actualizarErroresBn() {
    if (!B.errores.length || !B.form) return;
    B.errores = validarBn(B.form);
    var box = $('#bnErr');
    if (!box) return;
    if (!B.errores.length) { box.remove(); return; }
    box.querySelector('ul').innerHTML = B.errores.map(function (e) { return '<li>' + esc(e) + '</li>'; }).join('');
  }
  function guardarBn() {
    var f = B.form;
    if (!f || B.guardando || B.conflicto) return;
    if (subiendo(f) || Object.keys(B.copiando).length) { EA.toast('Espera a que terminen de subir o copiarse los archivos.', true); return; }
    if (H.subidas.some(function (s) { return s.form === f && s.estado === 'error'; })) { EA.toast('Un archivo no se subió: reintenta o quítalo antes de publicar.', true); return; }
    B.errores = validarBn(f);
    if (B.errores.length) { vBnForm(); var box = $('#bnErr'); if (box) { box.scrollIntoView({ block: 'center' }); box.focus({ preventScroll: true }); } return; }
    B.guardando = true;
    var b = $('#bnGuardar'); if (b) { b.disabled = true; b.textContent = 'Publicando…'; }
    var datos = { id: f.id, titulo: f.titulo, tipo: f.tipo, paraQue: f.paraQue, asignaturas: f.asignaturas, subniveles: f.subniveles, herramientas: f.herramientas,
      momentos: f.momentos, duracion: f.duracion, dua: !!f.dua, comoUsar: f.comoUsar, archivos: f.evidencias, huella: f.huella || '', derechos: !!f.derechos };
    if (S.bn.depto) datos.oficial = f.oficial !== false;
    EA.api('bnGuardar', datos).then(function (r) {
      B.guardando = false; clearTimeout(borradorT); EA.store(claveDe(f));
      ponerEnLista(r.recurso);
      B.det[r.recurso.id] = r.detalle; B.form = null; B.formKey = ''; B.recien = r.recurso.id; B.recienNuevo = !f.id; if (!f.id) { B.origen = 'bnMios'; B.origenId = ''; }
      EA.go('bnVer', r.recurso.id);
      EA.toast(f.id ? 'Cambios guardados.' : 'Publicado en el Banco de ideas.');
    }).catch(function (e) {
      B.guardando = false; B.errores = [e.message];
      if (VISTA_FORM[S.view] === 'bn') { vBnForm(); var box = $('#bnErr'); if (box) box.scrollIntoView({ block: 'center' }); } else EA.toast(e.message, true);
    });
  }
  function usarEvidenciaBn(boton, id) {
    var f = B.form, lim = S.hu.limites;
    if (!f || B.copiando[id]) return;
    var usados = f.evidencias.filter(function (e) { return e.t === 'a'; }).length + H.subidas.filter(function (s) { return s.form === f; }).length + Object.keys(B.copiando).length;
    if (usados >= lim.maxArchivos) { EA.toast('Puedes adjuntar hasta ' + lim.maxArchivos + ' archivos por recurso.', true); return; }
    B.copiando[id] = true; boton.disabled = true; boton.textContent = 'Copiando…';
    EA.api('bnCopiar', { huella: f.huella, archivo: id }, { tiempo: 180000 }).then(function (r) {
      delete B.copiando[id];
      f.evidencias.push(r.archivo); f.usadas.push(id);
      EA.store(claveDe(f), f);
      if (B.form === f && VISTA_FORM[S.view] === 'bn') vBnForm();
    }).catch(function (e) {
      delete B.copiando[id];
      if (B.form === f && VISTA_FORM[S.view] === 'bn') vBnForm();
      EA.toast(e.message, true);
    });
  }

  /* ---------------- Mis aportes ---------------- */
  function vBnMios() {
    if (!S.bn) return EA.go('inicio');
    var l = S.bn.mios;
    var h = EA.tb('Banco de ideas', 'Mis aportes', '<button class="btn" type="button" data-go="bnAportar">Compartir un recurso</button>', '');
    h += tabsBn('bnMios');
    var ocultos = l.filter(function (r) { return r.estado === 'oculto'; }).length;
    if (ocultos) h += '<div class="card coral"><b>' + (ocultos === 1 ? 'Un aporte está oculto' : ocultos + ' aportes están ocultos') + ' por el Departamento.</b> Ábrelo para ver el motivo y corregirlo.</div>';
    if (!l.length) {
      h += '<div class="card empty-state"><span class="strip blue">Sin aportes</span><h2>Todavía no compartes ningún recurso</h2>' +
        '<p class="muted">Comparte una idea que te funcionó, o hazlo desde el detalle de una huella de clase: el tema, la asignatura y las evidencias se toman de ahí.</p>' +
        '<p><button class="btn" type="button" data-go="bnAportar">Compartir un recurso</button></p></div>';
    } else {
      h += '<div class="list">' + l.map(function (r) {
        return '<button class="hitem" type="button" data-go="bnVer" data-id="' + esc(r.id) + '"><div class="when">' + EA.fFecha(r.creado) + '<span>' + esc(String(r.creado).slice(0, 4)) + '</span></div>' +
          '<div class="main"><b>' + esc(r.titulo) + '</b><span>' + esc((S.bn.tipos[r.tipo] || r.tipo) + ' · ' + r.asignaturas.join(', ') + ' · ' + r.subniveles.join(', ')) + '</span></div>' +
          '<div class="side">' + (r.estado === 'oculto' ? '<span class="chip fuera">Oculto</span>' : r.oficial ? sello() : '<span class="chip hu-completo">Publicado</span>') + '</div></button>';
      }).join('') + '</div>';
    }
    $('#view').innerHTML = h;
  }

  /* ---------------- moderación (Departamento) ---------------- */
  function vBnModerar() {
    if (!S.bn || !S.bn.depto) return EA.go('banco');
    var h = EA.tb('Banco de ideas · Departamento', 'Moderación', '', 'Reportes de los docentes y recursos ocultos. Para ocultar un recurso, ábrelo desde el banco.');
    h += tabsBn('bnModerar') + '<div id="bnMod">' + (B.mod ? '' : '<div class="loading"><span class="spin"></span>Cargando…</div>') + '</div>';
    $('#view').innerHTML = h;
    if (B.mod) pintarModeracion();
    EA.api('bnReportes').then(function (m) {
      B.mod = m; S.bn.reportes = m.abiertos.length;
      if (S.view === 'bnModerar') pintarModeracion();
    }).catch(function (e) { var c = $('#bnMod'); if (c && S.view === 'bnModerar') c.innerHTML = '<div class="err">' + esc(e.message) + '</div>'; });
  }
  function pintarModeracion() {
    var m = B.mod, c = $('#bnMod');
    if (!m || !c) return;
    var h = '<section class="stack bn-sec"><div class="bn-sec-h"><h2>Reportes por revisar' + (m.abiertos.length ? ' (' + m.abiertos.length + ')' : '') + '</h2></div>';
    h += m.abiertos.length ? '<div class="list">' + m.abiertos.map(function (r) {
      return '<div class="card bn-modi"><div class="main"><b>' + esc(r.titulo) + '</b>' + (r.oficial ? ' ' + sello() : '') + '<span class="small muted">de ' + esc(r.autor) + '</span>' +
        '<p class="texto"><b>' + esc(r.motivo) + '</b>' + (r.nota ? ' · ' + esc(r.nota) : '') + '</p><span class="small muted">Reportó ' + esc(r.por) + ' · ' + esc(EA.fFecha(r.creado)) + '</span></div>' +
        '<div class="bn-acts"><button class="btn sm" type="button" data-go="bnVer" data-id="' + esc(r.recursoId) + '">Revisar</button><button class="btn ghost sm" type="button" data-hu="bnDescartar" data-v="' + esc(r.id) + '">Descartar</button></div></div>';
    }).join('') + '</div>' : '<div class="empty"><b>Nada por revisar</b>Cuando un docente reporte un recurso, aparece aquí y te llega un correo.</div>';
    h += '</section><section class="stack bn-sec"><div class="bn-sec-h"><h2>Ocultos' + (m.ocultos.length ? ' (' + m.ocultos.length + ')' : '') + '</h2></div>';
    h += m.ocultos.length ? '<div class="list">' + m.ocultos.map(function (r) {
      return '<div class="card bn-modi"><div class="main"><b>' + esc(r.titulo) + '</b><span class="small muted">de ' + esc(r.autor) + ' · oculto el ' + esc(EA.fFecha(r.ocultoEn)) + '</span>' +
        '<p class="texto">Motivo: ' + esc(r.motivoOculto) + '</p>' + (r.corregido ? '<span class="chip hu-completo">Corregido por quien lo compartió</span>' : '') + '</div>' +
        '<div class="bn-acts"><button class="btn ghost sm" type="button" data-go="bnVer" data-id="' + esc(r.id) + '">Ver</button><button class="btn sm" type="button" data-hu="bnRestaurarId" data-v="' + esc(r.id) + '">Volver a publicar</button></div></div>';
    }).join('') + '</div>' : '<div class="empty"><b>Ningún recurso oculto</b>Los recursos que ocultes quedan aquí hasta que los vuelvas a publicar.</div>';
    c.innerHTML = h + '</section>';
  }

  /* EA Conecta · Eventos (clic, escritura, cambios, envío), navegación y lo que el módulo entrega al portal. */
  /* ---------------- eventos ---------------- */
  function alternar(lista, v) { var i = lista.indexOf(v); if (i >= 0) lista.splice(i, 1); else lista.push(v); }
  function click(ev) {
    var g = ev.target.closest('[data-go]');
    var CON_ID = { huellaVer: 1, solicitudVer: 1, trabajoVer: 1, bnVer: 1 };
    if (g && g.dataset.go === 'huellaVer' && S.view !== 'huellaVer') { H.origen = S.view; H.origenId = CON_ID[S.view] ? S.id : ''; }
    // Volver desde un recurso del banco lleva a donde estaba la persona (el banco, Mis aportes, una solicitud…).
    if (g && g.dataset.go === 'bnVer' && S.view !== 'bnVer' && S.view !== 'bnEditar' && S.view !== 'bnAportar') { B.origen = S.view; B.origenId = CON_ID[S.view] ? S.id : ''; }
    if (g && g.dataset.go === 'bnAportar' && S.view !== 'huellaVer') B.deHuella = null;   // «Compartir un recurso» desde el menú empieza sin huella
    if (g && g.dataset.go === 'solicitudVer' && S.view !== 'solicitudVer') R.origen = S.view === 'huellaVer' ? 'reMias' : S.view;
    if (g && g.dataset.go === 'trabajoVer' && S.view !== 'trabajoVer') T.origen = S.view === 'tbBanco' ? 'tbBanco' : 'tbMias';
    if (g && g.dataset.go === 'trabajo' && S.view !== 'huellaVer') T.deHuella = null;   // «Subir trabajo» desde el menú empieza sin huella
    var a = ev.target.closest('[data-hu]');
    if (!a) return false;
    var act = a.dataset.hu, v = a.dataset.v, f = formActivo();
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
    if (act === 'repetir') {
      // En Trabajos se copia el último trabajo (o, si no hay, la última huella); en los demás, la última huella.
      var u = (VISTA_FORM[S.view] === 'tb' && S.tb && S.tb.mios[0]) || S.hu.mias[0]; if (!u) return true;
      var sede = sedeDe(u.curso) || U().sede, lista = cat().asignaturas[sede] || [];
      f.curso = u.curso; f.paralelos = u.paralelos.slice();
      if (lista.indexOf(u.asignatura) >= 0) { f.asignatura = u.asignatura; f.otraAsig = false; f.asigTexto = ''; } else { f.asignatura = ''; f.otraAsig = true; f.asigTexto = u.asignatura; }
      guardarBorrador(); repintar(); EA.toast('Copiamos curso, paralelos y asignatura de tu último registro.');
      return true;
    }
    if (act === 'descartarBorrador') {
      if (f) f.evidencias.forEach(function (e) { if (e.t === 'a' && (f.guardadas || []).indexOf(e.id) < 0) EA.api('evidenciaDescartar', { id: e.id }).catch(function () { }); });
      H.subidas.forEach(function (s) { if (s.form === f) s.cancelado = true; });
      H.subidas = H.subidas.filter(function (s) { return s.form !== f; });
      clearTimeout(borradorT); EA.store(claveDe(f));
      var k = VISTA_FORM[S.view];
      if (k === 're') { R.form = null; R.formKey = ''; } else if (k === 'tb') { T.form = null; T.formKey = ''; T.deHuella = null; } else { H.form = null; H.formKey = ''; }
      repintar();
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
      if (s2) { s2.estado = 'subiendo'; pintarEvs(); H.cola = H.cola.then(function () { return subirUno(s2); }); }
      return true;
    }
    if (act === 'abrirEv') { abrirArchivo(a, 'evidenciaAbrir', { huella: S.id, archivo: a.dataset.a }); return true; }
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
    // Pedir un recurso
    if (act === 'reAMedida') { R.form.tipo = 'medida'; guardarBorrador(R.form); vRecurso(); return true; }
    if (act === 'abrirMat') { abrirArchivo(a, 'materialAbrir', { solicitud: S.id, archivo: a.dataset.a }); return true; }
    if (act === 'reProceso') { accionRe(a, 'reEstado', { id: S.id, estado: 'proceso' }, 'Solicitud en proceso.'); return true; }
    if (act === 'reNoProcede') {
      var nota = ($('#reRespNota') || {}).value || '';
      if (nota.trim().length < 3) { EA.toast('Escribe en la nota el motivo para el docente.', true); var n = $('#reRespNota'); if (n) n.focus(); return true; }
      accionRe(a, 'reCancelar', { id: S.id, nota: nota }, 'Solicitud cerrada: el docente verá el motivo.'); return true;
    }
    if (act === 'reRecibido') { accionRe(a, 'reRecibido', { id: S.id }, 'Confirmado: recurso entregado.'); return true; }
    if (act === 'reCancelar') { R.confirmar = 'cancelar'; pintarSolicitud(); return true; }
    if (act === 'reNo') { R.confirmar = ''; pintarSolicitud(); return true; }
    if (act === 'reCancelarSi') { accionRe(a, 'reCancelar', { id: S.id }, 'Solicitud cancelada.'); return true; }
    if (act === 'reTab') {
      R.tab = v;
      Array.prototype.forEach.call(document.querySelectorAll('[data-hu="reTab"]'), function (b) { if (b.dataset.v === v) b.setAttribute('aria-current', 'page'); else b.removeAttribute('aria-current'); });
      pintarBandeja(); return true;
    }
    if (act === 'reRecargar') { vBandeja(); return true; }
    // Trabajos de mis estudiantes
    if (act === 'tbHerr') { alternar(f.herramientas, v); a.setAttribute('aria-pressed', f.herramientas.indexOf(v) >= 0); guardarBorrador(); return true; }
    if (act === 'tbUsarEv') { usarEvidencia(a, a.dataset.a); return true; }
    if (act === 'tbUsarEnlace') {
      var ue = (T.form.deHuella && T.form.deHuella.evidencias || []).filter(function (x) { return x.t === 'e' && x.u === a.dataset.u; })[0];
      if (ue && !T.form.evidencias.some(function (x) { return x.u === ue.u; })) T.form.evidencias.push({ t: 'e', u: ue.u, n: ue.n });
      guardarBorrador(); vTrabajo(); return true;
    }
    if (act === 'tbSeguirBorrador') { T.deHuella = null; vTrabajo(); return true; }
    if (act === 'tbEmpezarHuella') { T.form = null; T.formKey = ''; T.forzarHuella = true; vTrabajo(); return true; }
    if (act === 'tbDesdeHuella') { T.deHuella = H.det[S.id]; T.form = null; T.formKey = ''; EA.go('trabajo'); return true; }
    if (act === 'abrirTb') { abrirArchivo(a, 'trabajoAbrir', { trabajo: S.id, archivo: a.dataset.a }); return true; }
    if (act === 'tbEliminarPedir') { T.confirmar = true; pintarTrabajo(); return true; }
    if (act === 'tbEliminarNo') { T.confirmar = false; pintarTrabajo(); return true; }
    if (act === 'tbEliminarSi') { eliminarTrabajo(a); return true; }
    if (act === 'tbBancoTab') { T.bancoTab = v; pintarBanco(); return true; }
    if (act === 'tbBancoVer') { T.filtro[a.dataset.k] = v; T.bancoTab = 'todos'; cargarBanco(); return true; }
    if (act === 'tbBancoLimpiar') { T.filtro = { sede: '', asignatura: '', docente: '', tipo: '', herramienta: '', q: '' }; vTbBanco(); return true; }
    if (act === 'tbCsv') { csvBanco(a); return true; }
    // Banco de ideas
    if (act === 'bnOrigen') { B.filtro.origen = v; B.ver = 48; pintarFiltrosBn(); pintarBn(); return true; }
    if (act === 'bnLimpiar') { B.filtro = { q: '', asignatura: '', subnivel: '', tipo: '', herramienta: '', origen: '' }; B.ver = 48; pintarFiltrosBn(); pintarBn(); return true; }
    if (act === 'bnMas') { B.ver += 48; pintarBn(); return true; }
    if (act === 'bnRecargar') { cargarBn(); return true; }
    if (act === 'bnPedir') { adaptarBn({ herramientas: [B.filtro.herramienta].filter(Boolean), asignaturas: [B.filtro.asignatura].filter(Boolean) }, true); return true; }
    if (act === 'bnAbrir') { abrirArchivo(a, 'bnAbrir', { recurso: S.id, archivo: a.dataset.a }); return true; }
    if (act === 'bnBajar') { abrirArchivo(a, 'bnAbrir', { recurso: S.id, archivo: a.dataset.a, descargar: true }); return true; }
    if (act === 'bnAdaptar') { if (B.det[S.id]) adaptarBn(B.det[S.id]); return true; }
    if (act === 'bnEliminarPedir') { B.confirmar = true; pintarBnVer(); return true; }
    if (act === 'bnEliminarNo') { B.confirmar = false; pintarBnVer(); return true; }
    if (act === 'bnEliminarSi') { eliminarBn(a); return true; }
    if (act === 'bnReportarPedir') { B.reportar = true; B.repMotivo = ''; pintarBnVer(); var r0 = document.querySelector('input[name="bnMotivo"]'); if (r0) r0.focus(); return true; }
    if (act === 'bnReportarNo') { B.reportar = false; pintarBnVer(); return true; }
    if (act === 'bnOcultarPedir') { B.ocultar = true; pintarBnVer(); var mo = $('#bnMotivoOcultar'); if (mo) mo.focus(); return true; }
    if (act === 'bnOcultarNo') { B.ocultar = false; pintarBnVer(); return true; }
    if (act === 'bnOcultarSi') {
      var motivo = ($('#bnMotivoOcultar') || {}).value || '';
      if (motivo.trim().length < 5) { EA.toast('Escribe el motivo: le llega por correo a quien lo compartió.', true); var m2 = $('#bnMotivoOcultar'); if (m2) m2.focus(); return true; }
      moderarBn(a, 'bnOcultar', { id: S.id, motivo: motivo }, 'Recurso oculto: le avisamos por correo a quien lo compartió.'); return true;
    }
    if (act === 'bnRestaurar') { moderarBn(a, 'bnRestaurar', { id: S.id }, 'Publicado de nuevo en el banco.'); return true; }
    if (act === 'bnRestaurarId') { moderarBn(a, 'bnRestaurar', { id: v }, 'Publicado de nuevo en el banco.'); return true; }
    if (act === 'bnDescartar') { moderarBn(a, 'bnDescartar', { id: v }, 'Reporte descartado.'); return true; }
    if (act === 'bnMulti') { var k = a.dataset.k; alternar(f[k], v); a.setAttribute('aria-pressed', f[k].indexOf(v) >= 0); guardarBorrador(); return true; }
    if (act === 'bnUsarEv') { usarEvidenciaBn(a, a.dataset.a); return true; }
    if (act === 'bnUsarEnlace') {
      var be = (B.form.deHuella && B.form.deHuella.evidencias || []).filter(function (x) { return x.t === 'e' && x.u === a.dataset.u; })[0];
      if (be && !B.form.evidencias.some(function (x) { return x.u === be.u; })) B.form.evidencias.push({ t: 'e', u: be.u, n: be.n });
      guardarBorrador(); vBnForm(); return true;
    }
    if (act === 'bnSeguirBorrador') { B.deHuella = null; B.conflicto = false; vBnForm(); return true; }
    if (act === 'bnEmpezarHuella') { B.form = null; B.formKey = ''; B.forzarHuella = true; vBnForm(); return true; }
    if (act === 'bnDesdeHuella') { B.deHuella = H.det[S.id]; B.form = null; B.formKey = ''; EA.go('bnAportar'); return true; }
    if (act === 'reBancoOficiales') {
      var hf = R.form && S.bn && S.bn.herramientas.indexOf(R.form.herramienta) >= 0 ? R.form.herramienta : '';
      B.filtro = { q: '', asignatura: '', subnivel: '', tipo: '', herramienta: hf, origen: 'oficial' }; B.ver = 48; EA.go('banco'); return true;
    }
    if (act === 'reQuitarBanco') { R.form.banco = null; guardarBorrador(R.form); vRecurso(); return true; }
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
  var CAMPOS = { huTema: 'tema', huCont: 'contenidos', huAct: 'actividades', huMet: 'metodologia', huPend: 'pendiente', huAsigOtra: 'asigTexto', huRecOtro: 'recursoOtro',
    reLogro: 'logro', reAct: 'actividad', reEvid: 'evidenciaLogro', tbTitulo: 'titulo', tbEst: 'estudiantes', tbDesc: 'descripcion',
    bnTitulo: 'titulo', bnPara: 'paraQue', bnComo: 'comoUsar' };
  var reQT;
  var regT;
  function input(ev) {
    var t = ev.target;
    var fa = formActivo();
    if (CAMPOS[t.id] && fa) {
      fa[CAMPOS[t.id]] = t.value; guardarBorrador(fa);
      if (t.id === 'huAsigOtra') refrescarPendiente();
      if (t.id === 'tbEst') { var cn = $('#tbEstN'), nn = lineasTb(t.value).length; if (cn) cn.textContent = nn ? nn + (nn === 1 ? ' nombre' : ' nombres') : 'Hasta ' + S.tb.maxEstudiantes + ' nombres'; }
      return true;
    }
    if (t.id === 'huMq') { H.lista.q = t.value; pintarMias(); return true; }
    if (t.id === 'huCq') { H.cursosQ = t.value; pintarCursos(); return true; }
    if (t.id === 'huRq') { H.reg.q = t.value; clearTimeout(regT); regT = setTimeout(cargarRegistros, 350); return true; }
    if (t.id === 'reQ') { R.filtro.q = t.value; clearTimeout(reQT); reQT = setTimeout(pintarBandeja, 200); return true; }
    if (t.id === 'tbQ') { T.filtro.q = t.value; clearTimeout(reQT); reQT = setTimeout(cargarBanco, 350); return true; }
    if (t.id === 'bnQ') { B.filtro.q = t.value; B.ver = 48; clearTimeout(reQT); reQT = setTimeout(pintarBn, 150); return true; }
    return false;
  }
  function change(ev) {
    var t = ev.target, f = formActivo();
    if (t.id === 'huFecha' && f) { f.fecha = t.value; guardarBorrador(); return true; }
    if (t.id === 'huCurso' && f) {
      var antes = sedeDe(f.curso) || U().sede;
      f.curso = t.value;
      var ahora = sedeDe(f.curso) || U().sede, pars = cat().paralelos[ahora] || [];
      f.paralelos = f.paralelos.filter(function (p) { return pars.indexOf(p) >= 0; });
      if (antes !== ahora && f.asignatura && (cat().asignaturas[ahora] || []).indexOf(f.asignatura) < 0) f.asignatura = '';
      guardarBorrador(); repintar(); return true;
    }
    if (t.id === 'huAsig' && f) {
      if (t.value === '__otra') { f.otraAsig = true; f.asignatura = ''; guardarBorrador(); repintar(); var o = $('#huAsigOtra'); if (o) o.focus(); }
      else { var eraOtra = f.otraAsig; f.otraAsig = false; f.asigTexto = ''; f.asignatura = t.value; guardarBorrador(); if (eraOtra) repintar(); else refrescarPendiente(); }
      return true;
    }
    if (t.name === 'huEstado' && f) {
      f.estado = t.value; guardarBorrador(); vForm();
      var sig = t.value !== 'completo' ? $('#huPend') : document.querySelector('input[name="huEstado"][value="completo"]');
      if (sig) sig.focus();
      return true;
    }
    if (t.id === 'huArchivos') { adjuntar(t.files); t.value = ''; return true; }
    if (t.id === 'huSol' && f) { f.solicitud = t.value; guardarBorrador(); return true; }
    if ((t.name === 'reTipo' || t.name === 'reHerr' || t.name === 'reReserva') && f) {
      if (t.name === 'reTipo') f.tipo = t.value;
      if (t.name === 'reHerr') { f.herramienta = t.value; if (S.re.conReserva.indexOf(t.value) < 0) f.reserva = ''; }
      if (t.name === 'reReserva') f.reserva = t.value;
      guardarBorrador(); vRecurso();
      var foco = document.querySelector('input[name="' + t.name + '"][value="' + t.value.replace(/"/g, '') + '"]'); if (foco) foco.focus();
      return true;
    }
    if (t.id === 'reFecha' && f) { f.fechaUso = t.value; guardarBorrador(); vRecurso(); var rf = $('#reFecha'); if (rf) rf.focus(); return true; }
    if (t.id === 'rePer' && f) { f.periodos = Number(t.value) || 1; guardarBorrador(); return true; }
    if ((t.name === 'tbTipo' || t.name === 'tbAut') && f) {
      if (t.name === 'tbTipo') f.tipo = t.value; else f.autoria = t.value;
      guardarBorrador(); vTrabajo();
      var fo = document.querySelector('input[name="' + t.name + '"][value="' + t.value.replace(/"/g, '') + '"]'); if (fo) fo.focus();
      return true;
    }
    if (t.id === 'tbFecha' && f) { f.fecha = t.value; guardarBorrador(); return true; }
    if (t.name === 'bnTipo' && f) {
      f.tipo = t.value; guardarBorrador(); vBnForm();
      var ft = document.querySelector('input[name="bnTipo"][value="' + t.value.replace(/"/g, '') + '"]'); if (ft) ft.focus();
      return true;
    }
    if (t.id === 'bnDur' && f) { f.duracion = t.value; guardarBorrador(); return true; }
    if (t.id === 'bnDua' && f) { f.dua = t.checked; guardarBorrador(); return true; }
    if (t.id === 'bnDerechos' && f) { f.derechos = t.checked; guardarBorrador(); return true; }
    if (t.id === 'bnOficial' && f) { f.oficial = t.checked; guardarBorrador(); return true; }
    var bf = { bnFasig: 'asignatura', bnFsub: 'subnivel', bnFtipo: 'tipo', bnFherr: 'herramienta' }[t.id];
    if (bf) { B.filtro[bf] = t.value; B.ver = 48; pintarBn(); return true; }
    if (t.name === 'bnMotivo') {
      B.repMotivo = t.value;
      Array.prototype.forEach.call(document.querySelectorAll('input[name="bnMotivo"]'), function (i) { i.closest('label').classList.toggle('on', i.checked); });
      return true;
    }
    var tf = { tbFsede: 'sede', tbFasig: 'asignatura', tbFdoc: 'docente', tbFtipo: 'tipo', tbFherr: 'herramienta' }[t.id];
    if (tf) { T.filtro[tf] = t.value; if (tf === 'sede') { T.filtro.asignatura = ''; T.filtro.docente = ''; } cargarBanco(); return true; }
    if (t.id === 'reFHerr') { R.filtro.herr = t.value; pintarBandeja(); return true; }
    if (t.id === 'reFSede') { R.filtro.sede = t.value; pintarBandeja(); return true; }
    if (t.id === 'huMcurso') { H.lista.curso = t.value; pintarMias(); return true; }
    if (t.id === 'huMest') { H.lista.est = t.value; pintarMias(); return true; }
    var rm = { huRsede: 'sede', huRcurso: 'curso', huRasig: 'asig', huRest: 'est' }[t.id];
    if (rm) { H.reg[rm] = t.value; if (rm === 'sede') { H.reg.curso = ''; H.reg.asig = ''; } vRegistros(); return true; }
    return false;
  }
  function submit(ev) {
    var id = ev.target.id;
    if (id === 'huForm') { guardar(); return true; }
    if (id === 'reForm') { enviarRe(); return true; }
    if (id === 'tbForm') { guardarTrabajo(); return true; }
    if (id === 'bnForm') { guardarBn(); return true; }
    if (id === 'bnRepForm') { reportarBn(); return true; }
    if (id === 'reListaForm') {
      var enlace = $('#reRespEnlace').value.trim(), nota = $('#reRespNota').value.trim();
      if (enlace && !/^https:\/\//i.test(enlace)) { EA.toast('El enlace del recurso debe empezar con https://', true); return true; }
      if (!enlace && nota.length < 5) { EA.toast('Agrega el enlace del recurso o una nota (por ejemplo, el día y la hora del acompañamiento).', true); return true; }
      accionRe(ev.target.querySelector('[type="submit"]'), 'reEstado', { id: S.id, estado: 'lista', enlace: enlace, nota: nota }, 'Marcada como lista: le avisamos al docente por correo.');
      return true;
    }
    return false;
  }
  // Arrastrar archivos sobre la zona de evidencia (computadora).
  document.addEventListener('dragover', function (ev) { var d = ev.target.closest && ev.target.closest('#huDrop'); if (d) { ev.preventDefault(); d.classList.add('sobre'); } });
  document.addEventListener('dragleave', function (ev) { var d = ev.target.closest && ev.target.closest('#huDrop'); if (d) d.classList.remove('sobre'); });
  document.addEventListener('drop', function (ev) {
    var d = ev.target.closest && ev.target.closest('#huDrop');
    if (!d) return;
    ev.preventDefault(); d.classList.remove('sobre');
    if (ev.dataTransfer && ev.dataTransfer.files) adjuntar(ev.dataTransfer.files);
  });

  var PADRE = { huella: 'huella', huEditar: 'huella', huMias: 'huella', huCursos: 'huella', huellaVer: 'huella', huRegistros: 'huRegistros', inicio: 'inicio', sede: 'inicio',
    recurso: 'recurso', reMias: 'recurso', solicitudVer: 'recurso', reBandeja: 'reBandeja',
    trabajo: 'trabajo', tbEditar: 'trabajo', tbMias: 'trabajo', trabajoVer: 'trabajo', tbBanco: 'tbBanco',
    banco: 'banco', bnVer: 'banco', bnAportar: 'banco', bnEditar: 'banco', bnMios: 'banco', bnModerar: 'banco' };
  return {
    vistas: { sede: vSede, inicio: vInicio, huella: vForm, huEditar: vForm, huMias: vMias, huCursos: vCursos, huellaVer: vVer, huRegistros: vRegistros,
      recurso: vRecurso, reMias: vReMias, solicitudVer: vSolicitud, reBandeja: vBandeja,
      trabajo: vTrabajo, tbEditar: vTrabajo, tbMias: vTbMias, trabajoVer: vTrabajoVer, tbBanco: vTbBanco,
      banco: vBanco, bnVer: vBnVer, bnAportar: vBnForm, bnEditar: vBnForm, bnMios: vBnMios, bnModerar: vBnModerar },
    nav: function () {
      if (!S.hu.usuario.sede) return [];   // primero la sede (paso 2)
      var items = [['inicio', 'Inicio'], ['huella', 'Huella de clases']];
      if (S.re) items.push(['recurso', 'Pedir un recurso']);
      if (S.tb) items.push(['trabajo', 'Trabajos']);
      if (S.bn) items.push(['banco', 'Banco de ideas']);
      if (S.hu.permisos.registros) items.push(['huRegistros', 'Registros de huellas']);
      if (S.re && S.re.depto) items.push(['reBandeja', 'Solicitudes']);
      if (S.tb && S.tb.banco) items.push(['tbBanco', 'Banco de trabajos']);
      if (S.boot) items.push(['|'], [S.boot.usuario.role === 'evaluador' ? 'visitas' : 'registros', 'Evaluación de clases']);
      return items;
    },
    sinSede: function () { return !S.hu.usuario.sede; },
    padre: function (v) {
      if (v === 'huellaVer' && H.origen === 'huRegistros') return 'huRegistros';
      if (v === 'solicitudVer' && R.origen === 'reBandeja') return 'reBandeja';
      if (v === 'trabajoVer' && T.origen === 'tbBanco') return 'tbBanco';
      return PADRE[v];
    },
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
    regF: { q: '', sub: '', niv: '', est: '', per: '' }, hu: null, re: null, tb: null, huError: '' };

  /* ---------------- utilidades ---------------- */
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function $(sel, root) { return (root || document).querySelector(sel); }
  function $$(sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); }
  // op.tiempo: espera máxima (las partes de una subida y las exportaciones necesitan más de los 45 s por defecto).
  function api(accion, datos, op) {
    if (!DEMO) return window.REA_WEB.llamar(accion, datos || {}, op);
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
  function iso(d) { return d.getFullYear() + '-' + ('0' + (d.getMonth() + 1)).slice(-2) + '-' + ('0' + d.getDate()).slice(-2); }
  function hoy() { return iso(new Date()); }
  function haceDias(n) { var d = new Date(); d.setDate(d.getDate() - n); return iso(d); }
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
  function labClase(n) { return { 'Aula inmersiva': 'lab-inmersiva', 'Metaverso': 'lab-metaverso', 'Podcast': 'lab-podcast' }[n] || ''; }
  // CSV para Excel en español: separador ";" y BOM para que respete tildes y eñes.
  // Un texto que empieza con = + - @ (o tabulador/retorno) llevaría a Excel a ejecutarlo como fórmula:
  // se antepone un apóstrofo (auditoría M2). Los números no se tocan.
  function csv(filas) {
    var celda = function (x) {
      if (typeof x === 'number') return String(x);
      x = x == null ? '' : String(x);
      if (/^[=+\-@\t\r]/.test(x)) x = "'" + x;
      return /[";\n\r]/.test(x) ? '"' + x.replace(/"/g, '""') + '"' : x;
    };
    return '\ufeff' + filas.map(function (r) { return r.map(celda).join(';'); }).join('\r\n');
  }
  function descargar(nombre, texto) {
    var url = URL.createObjectURL(new Blob([texto], { type: 'text/csv;charset=utf-8' }));
    var a = document.createElement('a'); a.href = url; a.download = nombre; document.body.appendChild(a); a.click();
    setTimeout(function () { URL.revokeObjectURL(url); a.remove(); }, 1000);
  }

  /* ---------------- módulos: Huella de clases ---------------- */
  // El portal comparte con cada módulo lo mínimo: estado, utilidades y navegación.
  var EA = { S: S, DEMO: DEMO, esc: esc, $: $, $$: $$, api: api, toast: toast, tb: tb, go: go, loading: loading, fFecha: fFecha, fFechaLarga: fFechaLarga,
    iso: iso, hoy: hoy, haceDias: haceDias, store: store, load: load, csv: csv, descargar: descargar, renderWho: function () { renderWho(); } };
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
      // Servidor todavía en la versión anterior (no responde Huella de clases): se avisa a quien administra.
      (DEMO || S.hu || S.huError || !S.boot ? '' : '<div class="demo-band" role="status"><div class="wrap gut"><b>Huella de clases todavía no está activa.</b><span>El servidor de Apps Script sigue en la versión anterior. En Apps Script: Implementar → Gestionar implementaciones → lápiz → Versión: Nueva versión → Implementar.</span></div></div>') +
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
      '<div class="what row"><span class="chip">' + esc(v.tipoVisita) + '</span><span class="chip ' + labClase(v.espacio) + '">' + esc(v.espacio) + '</span></div>' +
      '<div class="st stack" style="gap:4px">' + chipEstado(v.estado) + '<span class="small muted">' + esc(progresoTxt(v)) + '</span></div>' +
      '<div class="res">' + res + '</div></button>';
  }

  function vNuevaVisita() {
    if (!esEval()) return go('visitas');
    var b = S.boot, f = S.form;
    var tiposVisita = b.catalogos.tipos;
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
      h += '<div class="card empty-state"><span class="strip">Sin experiencias</span><h2>Aún no hay experiencias en el trimestre ' + t + '</h2><p class="muted">' + (ev ? 'Registra cada uso del aula inmersiva, el metaverso o el podcast con el enlace a su carpeta del repositorio.' : 'Aparecen aquí cuando los evaluadores las registran.') + '</p></div>';
    } else {
      h += '<div class="list">' + lista.map(function (e) {
        var d = docente(e.docente_id);
        var res = e.suma != null ? '<span class="cat c' + Math.min(4, Math.max(1, Math.round(e.suma / 3))) + '"><span class="tab-n">' + e.suma + '</span> / 12</span>' : (ev && pendienteMia(e) ? '<span class="chip me">Te toca</span>' : '');
        return '<button class="item" data-go="experiencia" data-id="' + esc(e.id) + '"><div class="when">' + fFecha(e.fecha) + '<span>' + esc(e.curso) + '</span></div>' +
          '<div class="who-d"><b>' + esc(d.nombre) + '</b><span>' + esc(e.tema || 'Sin tema') + '</span></div>' +
          '<div class="what row"><span class="chip ' + labClase(e.laboratorio) + '">' + esc(e.laboratorio) + '</span><span class="chip ' + (e.cuenta ? 'verificada' : '') + '">' + (e.cuenta ? 'Cuenta' : 'No cuenta') + '</span></div>' +
          '<div class="st stack" style="gap:4px">' + chipEstado(e.estado) + '<span class="small muted">' + esc(progresoTxt(e)) + '</span></div><div class="res">' + res + '</div></button>';
      }).join('') + '</div>';
    }
    $('#view').innerHTML = h;
  }
  function vNuevaExperiencia() {
    if (!esEval()) return go('laboratorios');
    var b = S.boot, f = S.form;
    if (!f.inicE) { S.form = f = { inicE: 1, laboratorio: 'Aula inmersiva', trimestre: S.labFiltro.trim || b.config.trimestre, fecha: hoy(), cuenta: true }; }
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
    var est = { abierta: 'Puntuando', revision: 'En revisión', consolidada: 'Por verificar', verificada: 'Verificada' };
    var filas = [['Código', 'Fecha', 'Hora', 'Trimestre', 'Tipo de visita', 'Docente', 'Asignatura', 'Subnivel', 'Curso', 'Espacio', 'Estado', 'Nota (/100)', 'Nivel', 'Autorreflexión']].concat(l.map(function (v) {
      var d = docente(v.docente_id);
      return [codigo(v), v.fecha, v.hora, v.trimestre, v.tipoVisita, d.nombre, v.asignatura || d.asignatura, v.subnivel, v.curso, v.espacio, est[v.estado] || v.estado,
        v.puntaje != null ? num1(v.puntaje) : '', v.categoria ? REA.niveles[v.categoria - 1] : '', v.autoRespondida ? 'Respondida' : v.autoEnviada ? 'Enviada' : ''];
    }));
    return csv(filas);
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
      if (d.parteB) h += '<p class="small" style="margin:0"><b>Condición de entrada:</b> una experiencia en el aula inmersiva, el metaverso o el podcast cuenta solo si su ruta y sus evidencias están en el repositorio dentro de 5 días hábiles.</p>';
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
    if (act === 'recargarPagina') { location.reload(); return; }
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
        S.boot = o.boot || null; S.hu = o.hu || null; S.re = o.re || null; S.tb = o.tb || null; S.bn = o.bn || null;
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
      api('inicio').then(function (o) { S.boot = o.boot || null; S.hu = o.hu || null; S.re = o.re || null; S.tb = o.tb || null; S.bn = o.bn || null; abrir(); }).catch(function (e) {
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
      S.boot = o.boot || null; S.hu = o.hu || null; S.re = o.re || null; S.tb = o.tb || null; S.bn = o.bn || null; S.huError = o.huError || ''; S.v = o.v;
      abrir();
    }).catch(function (e) {
      var otra = e.codigo === 'SINACCESO' || e.codigo === 'DOMINIO';
      $('#app').innerHTML = '<div class="stripe" aria-hidden="true"><i></i><i></i><i></i><i></i><i></i><i></i></div><header class="topbar"><div class="wrap gut"><span class="thumb"><img src="' + REA_LOGO_SYM + '" alt="Eight Academy"></span><div class="t"><b>EA Conecta</b><span>Experiencias de Aprendizaje · Eight Academy</span></div></div></header>' +
        '<div class="wrap gut" style="padding-block:28px 60px;max-width:640px"><div class="tb"><div class="t"><span class="sub">EA Conecta</span><h1>' + (otra ? 'No tienes acceso a este portal' : 'No se pudo abrir el portal') + '</h1></div></div>' +
        '<p class="err" style="margin-top:16px">' + esc(e.message) + '</p><div class="row" style="margin-top:12px">' +
        (otra ? '<button class="btn" type="button" data-act="salir">Usar otra cuenta</button>' : '<button class="btn" type="button" data-act="recargarPagina">Intentar de nuevo</button>') + '</div></div>';
    });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', iniciar); else iniciar();
})();
