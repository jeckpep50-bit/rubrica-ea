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
/* Rúbrica EA · portal (cliente) */
(function () {
  'use strict';
  // Dos modos: el sitio publicado (habla con el servidor de Apps Script) y la demostración con datos de ejemplo.
  var DEMO = !!window.REA_DEMO;
  var C = RubricaCore;
  var CV = ['C1', 'C2', 'C3', 'C4', 'C5', 'C6'], CE = ['B1', 'B2', 'B3'];
  var MESES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
  var S = { boot: null, view: '', id: null, det: null, filtro: { q: '', estado: '', trim: 0 }, labFiltro: { trim: 0 }, resTrim: 0, res: null, resOrden: 'desc', resQ: '',
    tick: null, confirm: '', draft: null, rev: null, editDoc: null, form: {}, err: '', busy: false,
    v: '', cacheDet: {}, resCache: {}, watch: null, refrescando: false };

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

  /* ---------------- estructura ---------------- */
  var NAV = [['visitas', 'Visitas'], ['laboratorios', 'Laboratorios'], ['resultados', 'Resultados'], ['docentes', 'Docentes'], ['|'], ['rubrica', 'Rúbrica'], ['guia', 'Guía del evaluador'], ['conversacion', 'Conversación 1 a 1'], ['glosario', 'Glosario']];
  function shell() {
    var anio = S.boot ? S.boot.config.anio : '';
    $('#app').innerHTML =
      '<div class="wash" aria-hidden="true"></div>' +
      '<header class="top"><div class="wrap gut">' +
      '<img class="logo full" src="' + REA_LOGO + '" alt="Eight Academy · Unidad Educativa">' +
      '<img class="logo sym" src="' + REA_LOGO_SYM + '" alt="Eight Academy">' +
      '<div class="app"><b>Rúbrica EA</b><span>Experiencias de Aprendizaje · ' + esc(anio) + '</span></div>' +
      '<div class="who" id="who"></div></div></header>' +
      (!DEMO ? '' : '<div class="demo-band"><div class="wrap gut"><b>Demostración con datos de ejemplo.</b><span>Nada se guarda: al recargar vuelve al inicio. Cambia de evaluador arriba para ver cómo trabajan los tres.</span></div></div>') +
      '<div class="navbar"><nav class="nav wrap gut" id="nav" aria-label="Secciones"></nav><div class="stripe" aria-hidden="true"><i></i><i></i><i></i><i></i><i></i><i></i></div></div>' +
      '<main><div class="wrap gut" id="view"></div></main>' +
      '<div id="toast" class="toast" hidden role="status" aria-live="polite"></div>';
  }
  function renderWho() {
    var u = S.boot.usuario;
    var h = '';
    if (DEMO) {
      h += '<label class="demo-sel"><span>Ver como</span><select id="demoUser">' + window.REA_DEMO.usuarios.map(function (x, i) {
        return '<option value="' + i + '"' + (i === window.REA_DEMO.actual ? ' selected' : '') + '>' + esc(x.etiqueta) + '</option>';
      }).join('') + '</select></label>';
    }
    h += '<span class="mail">' + esc(u.email) + '</span><span class="role">' + (u.role === 'evaluador' ? 'Evaluador' : 'Lectura') + '</span>';
    if (!DEMO) h += '<button class="salir" type="button" data-act="salir">Salir</button>';
    $('#who').innerHTML = h;
  }
  function renderNav() {
    $('#nav').innerHTML = NAV.map(function (n) {
      if (n[0] === '|') return '<span class="sep" aria-hidden="true"></span>';
      var cur = S.view === n[0] || (S.view === 'visita' || S.view === 'nuevaVisita') && n[0] === 'visitas' || (S.view === 'experiencia' || S.view === 'nuevaExperiencia') && n[0] === 'laboratorios';
      return '<button data-go="' + n[0] + '"' + (cur ? ' aria-current="page"' : '') + '>' + n[1] + '</button>';
    }).join('');
  }
  function loading(t) { $('#view').innerHTML = '<div class="loading"><span class="spin"></span>' + esc(t || 'Cargando…') + '</div>'; }

  function stopTimers() { clearInterval(S.tick); S.tick = null; }
  function go(view, id) {
    stopTimers();
    S.view = view; S.id = id || null; S.confirm = ''; S.err = ''; S.det = null; S.draft = null; S.rev = null;
    renderNav(); render(); window.scrollTo(0, 0);
  }
  function render() {
    var v = S.view;
    if (v === 'visitas') return vVisitas();
    if (v === 'nuevaVisita') return vNuevaVisita();
    if (v === 'visita') return vDetalle('visita');
    if (v === 'laboratorios') return vLaboratorios();
    if (v === 'nuevaExperiencia') return vNuevaExperiencia();
    if (v === 'experiencia') return vDetalle('experiencia');
    if (v === 'resultados') return vResultados();
    if (v === 'docentes') return vDocentes();
    if (v === 'rubrica') return vRubrica();
    if (v === 'guia') return vGuia();
    if (v === 'conversacion') return vConversacion();
    if (v === 'glosario') return vGlosario();
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
    if (!f.inic) { S.form = f = { inic: 1, espacio: 'Aula', tipo: b.catalogos.tipos[0], trimestre: b.config.trimestre, fecha: hoy(), hora: ahoraHM() }; }
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
      '<label class="f"><span>Tipo de visita</span><select id="nvTipo">' + b.catalogos.tipos.map(function (t) { return '<option' + (f.tipo === t ? ' selected' : '') + '>' + esc(t) + '</option>'; }).join('') + '</select></label>' +
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
    if (DEMO) return;
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
    var h = tb('Trimestre ' + r.trimestre + (r.lineaBase ? ' · línea base' : ''), 'Resultados', '', 'Solo cuentan visitas y experiencias verificadas por los tres evaluadores. Las visitas de calibración no cuentan.');
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
  function vGuia() {
    var h = tb('Los tres evaluadores', 'Guía del evaluador', '', 'Mismo protocolo, mismas reglas de evidencia, misma consolidación.');
    h += '<section class="card stack" style="gap:10px"><span class="strip ink">Protocolo de la visita · 40 minutos</span><p class="small" style="margin:0">Los tres evaluadores entran siempre juntos. Nadie hace una visita individual.</p><div class="scroll"><table class="tbl"><thead><tr><th>Momento</th><th>Qué hacen los evaluadores</th></tr></thead><tbody>' + REA.protocolo.map(function (p) { return '<tr><td style="white-space:nowrap"><b>' + esc(p[0]) + '</b></td><td>' + esc(p[1]) + '</td></tr>'; }).join('') + '</tbody></table></div><p class="small" style="margin:0"><b>Clase no observable:</b> ' + esc(REA.noObservable) + '</p></section>';
    h += '<div class="grid2"><section class="card stack" style="gap:8px"><span class="strip">Registro de evidencia</span><ul class="prose" style="margin:0">' + REA.registro.map(function (r) { return '<li>' + esc(r) + '</li>'; }).join('') + '</ul><h3 style="margin:6px 0 0">Muestreo cada 5 minutos (C2)</h3><p class="small" style="margin:0">' + esc(REA.muestreo) + '</p><h3 style="margin:6px 0 0">Preguntas fijas a estudiantes (C1 y C5)</h3><ol class="prose" style="margin:0"><li>' + esc(REA.preguntasFijas[0]) + '</li><li>' + esc(REA.preguntasFijas[1]) + ' En 3.º y 4.º EGB: «' + esc(REA.preguntaFijaElemental) + '»</li></ol></section>' +
      '<section class="card stack" style="gap:8px"><span class="strip blue">Consolidación</span><ol class="prose" style="margin:0">' + REA.consolidacion.map(function (r) { return '<li>' + esc(r) + '</li>'; }).join('') + '</ol><h3 style="margin:6px 0 0">Objeciones</h3><ul class="prose" style="margin:0">' + REA.objeciones.map(function (r) { return '<li>' + esc(r) + '</li>'; }).join('') + '</ul></section></div>';
    h += '<section class="card stack" style="gap:10px"><span class="strip pink">Rondas y tipos de visita</span><div class="scroll"><table class="tbl"><thead><tr><th>Ronda</th><th class="c">Trimestre</th><th>Tipo</th><th>Para qué</th></tr></thead><tbody>' + REA.rondas.map(function (r) { return '<tr><td><b>' + esc(r[0]) + '</b></td><td class="c n">' + esc(r[1]) + '</td><td>' + esc(r[2]) + '</td><td>' + esc(r[3]) + '</td></tr>'; }).join('') + '</tbody></table></div></section>';
    h += '<section class="card stack" style="gap:10px"><span class="strip green">Cómo se ven los niveles 3 y 4 según el subnivel</span><p class="small muted" style="margin:0">Ejemplos para reconocer evidencia, no recetas. Aquí sí se nombran herramientas y laboratorios; en los descriptores, no.</p><div class="scroll"><table class="tbl" style="min-width:820px"><thead><tr><th>Criterio</th>' + REA.subniveles.map(function (s) { return '<th>' + esc(s) + '</th>'; }).join('') + '</tr></thead><tbody>' + CV.map(function (id) { return '<tr><td><b>' + id + '</b> ' + esc(crit(id).nombre) + '</td>' + REA.ejemplosSubnivel[id].map(function (x) { return '<td class="small">' + esc(x) + '</td>'; }).join('') + '</tr>'; }).join('') + '</tbody></table></div></section>';
    h += '<section class="stack"><div class="grid3">' + REA.laboratorios.map(function (l, i) { return '<div class="card ' + ['blue', 'teal', 'pink'][i] + '"><span class="k">' + esc(l.tipo) + '</span><h2 style="margin:4px 0 6px">' + esc(l.nombre) + '</h2><p class="small" style="margin:0">' + esc(l.texto) + '</p></div>'; }).join('') + '</div><p class="small muted">Referencia para reconocer los niveles 3 y 4 de B2. No es una receta obligatoria.</p></section>';
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
  function vGlosario() {
    var h = tb('Nombres oficiales', 'Glosario', '', 'Todos los documentos del plan usan estos nombres.');
    h += '<div class="scroll"><table class="tbl"><thead><tr><th>Término oficial</th><th>Qué es</th><th>No usar</th></tr></thead><tbody>' + REA.glosario.map(function (g) { return '<tr><td><b>' + esc(g[0]) + '</b></td><td>' + esc(g[1]) + '</td><td class="small muted">' + esc(g[2]) + '</td></tr>'; }).join('') + '</tbody></table></div>';
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

  document.addEventListener('input', function (ev) {
    var t = ev.target;
    if (t.dataset.in === 'evid') { var k = Number(t.dataset.k); S.draft.evidencias[k] = t.value; guardarDraft(); var w = $('[data-warn="' + k + '"]'); if (w) w.hidden = !faltaEvid(k); actualizarDockLigero(); return; }
    if (t.dataset.in === 'resp') { S.draft.respuestas[Number(t.dataset.i)] = t.value; guardarDraft(); return; }
    if (t.dataset.in === 'revNota') { S.rev.notas[Number(t.dataset.k)] = t.value; return; }
    if (t.id === 'fq') { S.filtro.q = t.value; var pos = t.selectionStart; vVisitas(); var n = $('#fq'); n.focus(); try { n.setSelectionRange(pos, pos); } catch (e) { } return; }
    if (t.id === 'rq') { S.resQ = t.value; var p2 = t.selectionStart; pintarResultados(); var r = $('#rq'); r.focus(); try { r.setSelectionRange(p2, p2); } catch (e) { } return; }
  });
  var dockT;
  function actualizarDockLigero() { clearTimeout(dockT); dockT = setTimeout(function () { if (S.confirm !== 'enviar') actualizarDock(); }, 250); }

  document.addEventListener('change', function (ev) {
    var t = ev.target;
    if (t.id === 'ftrim') { S.filtro.trim = Number(t.value); vVisitas(); return; }
    if (t.id === 'ltrim') { S.labFiltro.trim = Number(t.value); vLaboratorios(); return; }
    if (t.id === 'rord') { S.resOrden = t.value; pintarResultados(); return; }
    if (t.id === 'nvDoc') {
      S.form.docente = t.value; var d = docente(t.value);
      if (t.value) { $('#nvAsig').value = d.asignatura || ''; $('#nvSub').value = d.subnivel || ''; }
      return;
    }
    if (t.id === 'demoUser') {
      window.REA_DEMO.actual = Number(t.value);
      S.cacheDet = {}; S.resCache = {};   // lo guardado era desde la vista de otra persona
      refreshBoot().then(function () { renderWho(); var vista = S.view, id = S.id; go(S.boot.usuario.role === 'evaluador' ? vista : (vista === 'nuevaVisita' || vista === 'nuevaExperiencia' ? 'resultados' : vista), id); });
    }
  });

  document.addEventListener('submit', function (ev) {
    ev.preventDefault();
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
  function abrir() { shell(); renderWho(); go(esEval() ? 'visitas' : 'resultados'); vigilar(); }
  function iniciar() {
    if (DEMO) {
      $('#app').innerHTML = '<div class="loading" style="justify-content:center;padding:80px 16px"><span class="spin"></span>Abriendo la Rúbrica EA…</div>';
      refreshBoot().then(abrir).catch(function (e) {
        $('#app').innerHTML = '<div class="wrap gut" style="padding-block:60px"><div class="err">' + esc(e.message) + '</div></div>';
      });
      return;
    }
    window.REA_WEB.iniciar({ alEntrar: cargarInicio });
  }
  // Sitio publicado: un solo viaje trae los datos y, si el navegador no la tiene, la rúbrica.
  function cargarInicio() {
    $('#app').innerHTML = '<div class="loading" style="justify-content:center;padding:80px 16px"><span class="spin"></span>Abriendo la Rúbrica EA…</div>';
    var guardado = null;
    try { guardado = JSON.parse(sessionStorage.getItem('rea_contenido') || 'null'); } catch (e) { guardado = null; }
    api('inicio', { cv: guardado ? guardado.cv : '' }).then(function (o) {
      if (o.contenido) {
        window.REA = o.contenido;
        try { sessionStorage.setItem('rea_contenido', JSON.stringify({ cv: o.cv, c: o.contenido })); } catch (e) { }
      } else window.REA = guardado.c;
      S.boot = o.boot; S.v = o.v;
      abrir();
    }).catch(function (e) {
      var otra = e.codigo === 'SINACCESO' || e.codigo === 'DOMINIO';
      $('#app').innerHTML = '<header class="top"><div class="wrap gut"><img class="logo" src="' + REA_LOGO + '" alt="Eight Academy · Unidad Educativa" style="height:34px"></div></header><div class="stripe" aria-hidden="true"><i></i><i></i><i></i><i></i><i></i><i></i></div>' +
        '<div class="wrap gut" style="padding-block:28px 60px;max-width:640px"><div class="tb"><div class="t"><span class="sub">Rúbrica EA</span><h1>' + (otra ? 'No tienes acceso a este portal' : 'No se pudo abrir el portal') + '</h1></div></div>' +
        '<p class="err" style="margin-top:16px">' + esc(e.message) + '</p><div class="row" style="margin-top:12px">' +
        (otra ? '<button class="btn" type="button" data-act="salir">Usar otra cuenta</button>' : '<button class="btn" type="button" onclick="location.reload()">Intentar de nuevo</button>') + '</div></div>';
    });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', iniciar); else iniciar();
})();
