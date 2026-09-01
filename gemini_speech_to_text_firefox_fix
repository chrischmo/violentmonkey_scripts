// ==UserScript==
// @name         Gemini Speech-to-Text Firefox Fix
// @namespace    http://tampermonkey.net/
// @version      1.2
// @description  Verhindert DOMException durch doppeltes AudioContext.close() und meldet, wenn Google den Fix integriert hat
// @match        https://gemini.google.com/*
// @run-at       document-start
// @grant        none
// ==/UserScript==

(function () {
  'use strict';

  let deprecationLogged = false;

  function patchContext(ctxProto, name) {
    if (!ctxProto || ctxProto.prototype._closePatched) return;
    const origClose = ctxProto.prototype.close;

    ctxProto.prototype.close = function () {
      const isAlreadyClosed = this.state === 'closed';

      // Original-Aufruf immer testen, um festzustellen, ob Googles Handler/Browser den Fehler noch wirft
      return origClose.apply(this, arguments)
        .then((res) => {
          if (isAlreadyClosed && !deprecationLogged) {
            deprecationLogged = true;
            console.warn(
              `%c[STT-Fix] DEPRECATION NOTICE: ${name}.close() hat bei state 'closed' keinen Fehler mehr geworfen. Google/Firefox hat das Verhalten gefixt. Userscript kann deaktiviert/gelöscht werden.`,
              'background: #2e7d32; color: #fff; padding: 4px 8px; border-radius: 4px; font-weight: bold;'
            );
          }
          return res;
        })
        .catch((err) => {
          const isDoubleCloseError =
            err &&
            (err.name === 'InvalidStateError' ||
             (err.message && err.message.toLowerCase().includes('close')));

          if (isDoubleCloseError) {
            console.debug(`[STT-Fix] Abgefangen: ${err.message} (Patch ist noch aktiv und notwendig)`);
            return Promise.resolve();
          }
          return Promise.reject(err);
        });
    };

    ctxProto.prototype._closePatched = true;
    console.info(`[STT-Fix] ${name} erfolgreich gepatcht.`);
  }

  if (typeof window.AudioContext !== 'undefined') {
    patchContext(window.AudioContext, 'AudioContext');
  }
  if (typeof window.webkitAudioContext !== 'undefined') {
    patchContext(window.webkitAudioContext, 'webkitAudioContext');
  }
})();
