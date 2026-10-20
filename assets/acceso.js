/* Rúbrica EA · inicio de sesión con Google y conexión con el servidor (sitio en GitHub Pages) */
window.REA_WEB = (function () {
  'use strict';
  var CFG = window.REA_CONFIG || {};
  var CLAVE = 'rea_sesion';
  var sesion = leer();
  var esperando = [];          // llamadas que esperan a que la persona inicie sesión
  var gisListo = false, capa = null, opciones = {}, huboSesion = !!sesion;

  function leer() {
    try { var s = JSON.parse(sessionStorage.getItem(CLAVE) || 'null'); return s && s.t && s.exp ? s : null; } catch (e) { return null; }
  }
  function guardar(s) { try { sessionStorage.setItem(CLAVE, JSON.stringify(s)); } catch (e) { } }
  function borrar() { sesion = null; try { sessionStorage.removeItem(CLAVE); } catch (e) { } }
  function vigente() { return !!(sesion && sesion.exp * 1000 > Date.now() + 90000); }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function decodificar(jwt) {
    var p = String(jwt).split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
    while (p.length % 4) p += '=';
    return JSON.parse(decodeURIComponent(Array.prototype.map.call(atob(p), function (c) { return '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2); }).join('')));
  }

  /* ---------- Google Identity Services ---------- */
  function alCredencial(resp) {
    var p;
    try { p = decodificar(resp.credential); } catch (e) { return; }
    sesion = { t: resp.credential, exp: Number(p.exp), email: String(p.email || '').toLowerCase(), nombre: String(p.name || '') };
    guardar(sesion); huboSesion = true;
    ocultarCapa();
    var cola = esperando; esperando = [];
    cola.forEach(function (f) { f(); });
  }
  function conGis(fn, intentos) {
    intentos = intentos || 0;
    if (window.google && google.accounts && google.accounts.id) {
      if (!gisListo) {
        google.accounts.id.initialize({ client_id: CFG.CLIENT_ID, callback: alCredencial, auto_select: true, cancel_on_tap_outside: false, itp_support: true, use_fedcm_for_prompt: true });
        gisListo = true;
      }
      fn();
    } else if (intentos < 100) {
      setTimeout(function () { conGis(fn, intentos + 1); }, 100);
    } else {
      var m = document.getElementById('accesoMsg');
      if (m) m.innerHTML = '<span class="err">No se pudo cargar el inicio de sesión de Google. Revisa la conexión y recarga la página.</span>';
    }
  }

  /* ---------- pantallas de acceso ---------- */
  // tipo: 'inicio' (pantalla completa) o 'expirada' (capa sobre el portal: no se pierde nada de lo escrito)
  function mostrarCapa(tipo, mensaje) {
    if (!capa) { capa = document.createElement('div'); capa.className = 'acceso'; capa.setAttribute('role', 'dialog'); capa.setAttribute('aria-modal', 'true'); document.body.appendChild(capa); }
    capa.className = 'acceso' + (tipo === 'expirada' ? ' sobre' : '');
    var titulo = tipo === 'expirada' ? 'Tu sesión de Google expiró' : (opciones.titulo || 'Rúbrica EA');
    var texto = tipo === 'expirada'
      ? 'Vuelve a entrar para continuar. Lo que estabas escribiendo sigue guardado en este dispositivo.'
      : (opciones.texto || 'Entra con tu cuenta institucional de Eight Academy.');
    capa.innerHTML = '<div class="acceso-panel">' +
      '<div class="acceso-top"><img class="acceso-logo" src="' + esc(opciones.logo || 'assets/logo.png') + '" alt="Eight Academy · Unidad Educativa"></div>' +
      '<div class="stripe" aria-hidden="true"><i></i><i></i><i></i><i></i><i></i><i></i></div>' +
      '<div class="acceso-cuerpo"><span class="acceso-sub">' + esc(opciones.sub || 'Departamento de Experiencias de Aprendizaje') + '</span>' +
      '<h1>' + esc(titulo) + '</h1><p>' + esc(texto) + '</p>' +
      '<div id="gsiBoton" class="acceso-boton"></div>' +
      '<p id="accesoMsg" class="acceso-msg">' + (mensaje ? '<span class="err">' + esc(mensaje) + '</span>' : 'Solo cuentas @' + esc(CFG.DOMINIO || 'eightacademy.edu.ec') + '.') + '</p></div></div>';
    capa.hidden = false;
    conGis(function () {
      var el = document.getElementById('gsiBoton');
      if (!el) return;
      google.accounts.id.renderButton(el, { type: 'standard', theme: 'filled_blue', size: 'large', text: 'signin_with', shape: 'pill', locale: 'es', width: 280 });
      try { google.accounts.id.prompt(); } catch (e) { }
    });
  }
  function ocultarCapa() { if (capa) { capa.hidden = true; capa.innerHTML = ''; } }
  function pedirSesion(tipo, mensaje) {
    return new Promise(function (res) { esperando.push(res); mostrarCapa(tipo, mensaje); });
  }

  /* ---------- conexión ---------- */
  function errorDeRed() {
    var e = new Error(navigator.onLine === false ? 'Sin conexión a internet. Revisa el wifi e intenta de nuevo.' : 'No se pudo conectar con el servidor. Intenta de nuevo en unos segundos.');
    e.codigo = 'RED';
    return e;
  }
  function enviar(cuerpo) {
    var ctl = typeof AbortController !== 'undefined' ? new AbortController() : null;
    var reloj = ctl ? setTimeout(function () { ctl.abort(); }, 45000) : null;
    return fetch(CFG.API_URL, { method: 'POST', redirect: 'follow', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify(cuerpo), signal: ctl ? ctl.signal : undefined })
      .then(function (r) { if (reloj) clearTimeout(reloj); return r.json(); }, function () { if (reloj) clearTimeout(reloj); throw errorDeRed(); })
      .then(null, function (e) { if (e && e.codigo) throw e; throw errorDeRed(); });
  }
  function llamar(accion, datos) {
    function intento(yaReintentado) {
      var listo = vigente() ? Promise.resolve() : pedirSesion(huboSesion ? 'expirada' : 'inicio');
      return listo.then(function () {
        return enviar({ token: sesion.t, accion: accion, datos: datos || {} });
      }).then(function (j) {
        if (j && j.ok) return j.data;
        if (j && j.codigo === 'AUTH' && !yaReintentado) { borrar(); return intento(true); }
        var e = new Error((j && j.error) || 'El servidor no respondió como se esperaba.');
        e.codigo = (j && j.codigo) || 'ERROR';
        throw e;
      });
    }
    return intento(false);
  }

  return {
    configurado: function () { return !!(CFG.API_URL && CFG.CLIENT_ID); },
    // Arranque: despierta el servidor mientras la persona inicia sesión.
    iniciar: function (op) {
      opciones = op || {};
      if (!this.configurado()) {
        document.body.insertAdjacentHTML('beforeend', '<div class="acceso"><div class="acceso-panel"><div class="acceso-cuerpo"><h1>El portal aún no está configurado</h1><p>Falta completar API_URL y CLIENT_ID en config.js.</p></div></div></div>');
        return;
      }
      try { fetch(CFG.API_URL, { method: 'GET', redirect: 'follow' }).then(null, function () { }); } catch (e) { }
      if (vigente()) { opciones.alEntrar(); return; }
      pedirSesion('inicio').then(function () { opciones.alEntrar(); });
    },
    llamar: llamar,
    usuario: function () { return sesion; },
    salir: function () {
      borrar();
      try { sessionStorage.removeItem('rea_contenido'); } catch (e) { }
      try { google.accounts.id.disableAutoSelect(); } catch (e) { }
      location.reload();
    }
  };
})();
