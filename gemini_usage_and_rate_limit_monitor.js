// ==UserScript==
// @name         Gemini Usage & Rate Limit Monitor
// @namespace    https://gemini.google.com/
// @version      7.0
// @description  Aktives API-Polling, passives Listening + XHR Dumper + ID-Mapping + Reset-Zeiten.
// @author       Christian Schmitt
// @match        https://gemini.google.com/*
// @grant        none
// @inject-into  page
// @run-at       document-idle
// ==/UserScript==

(function () {
    'use strict';

    const style = document.createElement('style');
    style.textContent = `
        #gemini-usage-badge {
            position: fixed;
            bottom: 16px;
            right: 24px;
            z-index: 999999;
            display: flex;
            flex-direction: column;
            align-items: flex-start;
            gap: 2px;
            padding: 6px 12px;
            font-size: 13px;
            font-weight: 500;
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
            background: #1e1f20;
            color: #e3e3e3;
            border: 1px solid #444746;
            border-radius: 12px;
            box-shadow: 0 4px 12px rgba(0,0,0,0.4);
            cursor: pointer;
            user-select: none;
            transition: all 0.2s ease;
            white-space: pre-line;
        }
        #gemini-usage-badge:hover {
            border-color: #a8c7fa;
            background: #282a2c;
        }
        #gemini-usage-badge.warning {
            color: #f28b82;
            border-color: #f28b82;
        }
        #gemini-usage-badge.syncing {
            opacity: 0.6;
        }
    `;
    document.head.appendChild(style);

    let badge;
    let isSyncing = false;
    let lastCurrentPercent = null;
    let lastWeeklyPercent = null;
    let resetTimeCurrent = null;
    let wizUrl = '';
    let wizAt = '';
    let syncInterval;

    function updateBadgeUI() {
        if (!badge) {
            badge = document.createElement('div');
            badge.id = 'gemini-usage-badge';
            badge.title = 'Klicken zum manuellen Synchronisieren';
            badge.addEventListener('click', () => {
                if (!isSyncing && wizUrl && wizAt) fetchQuota();
                else console.info('[Gemini Dumper] Manuelles Sync blockiert. Status:', {isSyncing, hasWizUrl: !!wizUrl, hasWizAt: !!wizAt});
            });
            document.body.appendChild(badge);
        }

        if (isSyncing) {
            badge.classList.add('syncing');
            badge.textContent = lastCurrentPercent !== null ? `Limit: ${lastCurrentPercent}% (Sync...)` : 'Limit: Initialisiere...';
        } else {
            badge.classList.remove('syncing');
            if (lastCurrentPercent !== null) {
                let text = `Limit: ${lastCurrentPercent}%`;
                if (resetTimeCurrent) text += ` (${resetTimeCurrent})`;
                if (lastWeeklyPercent !== null) text += `\nWochenlimit: ${lastWeeklyPercent}%`;

                badge.textContent = text;

                if (lastCurrentPercent >= 80) badge.classList.add('warning');
                else badge.classList.remove('warning');
            } else {
                badge.textContent = 'Limit: Warte auf API...';
            }
        }
    }

    function processQuotaResponse(text, source) {
        try {
            const match = text.match(/"jSf9Qc"\s*,\s*"(\[.*?\])"/);
            if (match && match[1]) {
                const unescaped = match[1].replace(/\\"/g, '"').replace(/\\\\/g, '\\');
                const data = JSON.parse(unescaped);

                const quotas = data[1];
                if (quotas && quotas.length > 0) {
                    quotas.forEach(q => {
                        if (q && q.length > 2) {
                            const val = Math.round(q[1] * 100);
                            let timeStr = null;

                            if (q[3] && q[3][0] && q[3][0][0]) {
                                const date = new Date(q[3][0][0] * 1000);
                                timeStr = date.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });
                            }

                            if (q[2] === 1) {
                                lastCurrentPercent = val;
                                resetTimeCurrent = timeStr;
                            } else if (q[2] === 2) {
                                lastWeeklyPercent = val;
                            }
                        }
                    });

                    if (lastCurrentPercent === null && quotas.length >= 2) {
                        lastWeeklyPercent = Math.round(quotas[0][1] * 100);
                        lastCurrentPercent = Math.round(quotas[1][1] * 100);
                    } else if (lastCurrentPercent === null && quotas.length === 1) {
                        lastCurrentPercent = Math.round(quotas[0][1] * 100);
                    }

                    console.info(`[Gemini Dumper] Quota verarbeitet via ${source}. Aktuell: ${lastCurrentPercent}%, Woche: ${lastWeeklyPercent}%, Reset: ${resetTimeCurrent}`);
                    updateBadgeUI();
                }
            }
        } catch (e) {
            console.error('[Gemini Dumper] Fehler beim Parsen der Quota-Response:', e);
        }
    }

    function fetchQuota() {
        if (!wizUrl || !wizAt || isSyncing) return;
        isSyncing = true;
        updateBadgeUI();

        const reqUrl = wizUrl.replace(/rpcids=[^&]+/, 'rpcids=jSf9Qc');
        const reqBody = 'f.req=' + encodeURIComponent('[[["jSf9Qc","[]",null,"generic"]]]') + '&at=' + wizAt;

        fetch(reqUrl, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8'
            },
            body: reqBody
        })
        .then(res => res.text())
        .then(text => processQuotaResponse(text, 'Active Fetch'))
        .catch(err => console.error('[Gemini Dumper] API Fetch Fehler:', err))
        .finally(() => {
            isSyncing = false;
            updateBadgeUI();
        });
    }

    const originalOpen = window.XMLHttpRequest.prototype.open;
    const originalSend = window.XMLHttpRequest.prototype.send;

    window.XMLHttpRequest.prototype.open = function(method, url) {
        this._url = url;
        this.addEventListener('load', function() {
            if (this._url && this._url.includes('batchexecute')) {
                const text = this.responseText;
                if (this._url.includes('jSf9Qc') || text.includes('jSf9Qc')) {
                    processQuotaResponse(text, 'Passive Intercept');
                }
            }
        });
        originalOpen.apply(this, arguments);
    };

    window.XMLHttpRequest.prototype.send = function(body) {
        if (this._url && this._url.includes('batchexecute') && typeof body === 'string') {
            if (!wizAt && body.includes('at=')) {
                const match = body.match(/(?:^|&)at=([^&]+)/);
                if (match) {
                    wizAt = match[1];
                    wizUrl = this._url;
                    setTimeout(fetchQuota, 1000);
                    if (!syncInterval) syncInterval = setInterval(fetchQuota, 3 * 60 * 1000);
                }
            }
        }
        originalSend.apply(this, arguments);
    };

    updateBadgeUI();
})();
