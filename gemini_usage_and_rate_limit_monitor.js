// ==UserScript==
// @name         Gemini Usage & Rate Limit Monitor
// @namespace    https://gemini.google.com/
// @version      8.0
// @description  Active API polling, passive listening + XHR dumper + ID mapping + reset times (i18n ready).
// @author       Christian Schmitt
// @match        https://gemini.google.com/*
// @grant        none
// @inject-into  page
// @run-at       document-idle
// ==/UserScript==

(function () {
    'use strict';

    // --- i18n Configuration ---
    const I18N = {
        en: {
            tooltipSync: "Click to sync manually",
            limitInit: "Limit: Initializing...",
            limitSync: "Limit: {current}% (Sync...)",
            limitValue: "Limit: {current}%",
            weeklyLimit: "Weekly limit: {weekly}%",
            limitWait: "Limit: Waiting for API..."
        },
        de: {
            tooltipSync: "Klicken zum manuellen Synchronisieren",
            limitInit: "Limit: Initialisiere...",
            limitSync: "Limit: {current}% (Sync...)",
            limitValue: "Limit: {current}%",
            weeklyLimit: "Wochenlimit: {weekly}%",
            limitWait: "Limit: Warte auf API..."
        },
        es: {
            tooltipSync: "Haz clic para sincronizar manualmente",
            limitInit: "Límite: Inicializando...",
            limitSync: "Límite: {current}% (Sincronizando...)",
            limitValue: "Límite: {current}%",
            weeklyLimit: "Límite semanal: {weekly}%",
            limitWait: "Límite: Esperando a la API..."
        },
        it: {
            tooltipSync: "Fai clic per sincronizzare manualmente",
            limitInit: "Limite: Inizializzazione...",
            limitSync: "Limite: {current}% (Sincronizzazione...)",
            limitValue: "Limite: {current}%",
            weeklyLimit: "Limite settimanale: {weekly}%",
            limitWait: "Limite: In attesa dell'API..."
        },
        pl: {
            tooltipSync: "Kliknij, aby zsynchronizować ręcznie",
            limitInit: "Limit: Inicjowanie...",
            limitSync: "Limit: {current}% (Synchronizacja...)",
            limitValue: "Limit: {current}%",
            weeklyLimit: "Limit tygodniowy: {weekly}%",
            limitWait: "Limit: Oczekiwanie na API..."
        },
        ru: {
            tooltipSync: "Нажмите для ручной синхронизации",
            limitInit: "Лимит: Инициализация...",
            limitSync: "Лимит: {current}% (Синхронизация...)",
            limitValue: "Лимит: {current}%",
            weeklyLimit: "Недельный лимит: {weekly}%",
            limitWait: "Лимит: Ожидание API..."
        },
        zh: {
            tooltipSync: "点击手动同步",
            limitInit: "额度：初始化中...",
            limitSync: "额度：{current}% (同步中...)",
            limitValue: "额度：{current}%",
            weeklyLimit: "每周额度：{weekly}%",
            limitWait: "额度：等待 API..."
        },
        ko: {
            tooltipSync: "수동으로 동기화하려면 클릭하세요",
            limitInit: "제한: 초기화 중...",
            limitSync: "제한: {current}% (동기화 중...)",
            limitValue: "제한: {current}%",
            weeklyLimit: "주간 제한: {weekly}%",
            limitWait: "제한: API 대기 중..."
        },
        ja: {
            tooltipSync: "クリックして手動で同期",
            limitInit: "制限: 初期化中...",
            limitSync: "制限: {current}% (同期中...)",
            limitValue: "制限: {current}%",
            weeklyLimit: "週間制限: {weekly}%",
            limitWait: "制限: API待機中..."
        }
    };

    const DEFAULT_LANG = 'en';

    function getBrowserLanguage() {
        const hostLang = document.documentElement.lang || '';
        const navLang = (navigator.languages && navigator.languages[0]) || navigator.language || DEFAULT_LANG;
        const shortLang = (hostLang || navLang).toLowerCase().split('-')[0];
        
        return I18N[shortLang] ? shortLang : DEFAULT_LANG;
    }

    const currentLang = getBrowserLanguage();

    function t(key, params = {}) {
        let template = I18N[currentLang]?.[key] || I18N[DEFAULT_LANG]?.[key] || key;
        return Object.entries(params).reduce((acc, [placeholder, value]) => {
            return acc.replaceAll(`{${placeholder}}`, value);
        }, template);
    }
    // --------------------------

    // Using createElement for CSP compliance in Violentmonkey
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
            badge.title = t('tooltipSync');
            badge.addEventListener('click', () => {
                if (!isSyncing && wizUrl && wizAt) fetchQuota();
                else console.info('[Gemini Dumper] Manual sync blocked. Status:', {isSyncing, hasWizUrl: !!wizUrl, hasWizAt: !!wizAt});
            });
            document.body.appendChild(badge);
        }

        if (isSyncing) {
            badge.classList.add('syncing');
            badge.textContent = lastCurrentPercent !== null 
                ? t('limitSync', { current: lastCurrentPercent }) 
                : t('limitInit');
        } else {
            badge.classList.remove('syncing');
            if (lastCurrentPercent !== null) {
                let text = t('limitValue', { current: lastCurrentPercent });
                if (resetTimeCurrent) text += ` (${resetTimeCurrent})`;
                if (lastWeeklyPercent !== null) text += `\n${t('weeklyLimit', { weekly: lastWeeklyPercent })}`;

                badge.textContent = text;
                if (lastCurrentPercent >= 80) badge.classList.add('warning');
                else badge.classList.remove('warning');
            } else {
                badge.textContent = t('limitWait');
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
                                // Using standard Intl API formatting dynamically based on detected browser language
                                timeStr = date.toLocaleTimeString(currentLang, { hour: '2-digit', minute: '2-digit' });
                            }

                            if (q[2] === 1) {
                                lastCurrentPercent = val;
                                resetTimeCurrent = timeStr;
                            } else if (q[2] === 2) {
                                lastWeeklyPercent = val;
                            }
                        }
                    });

                    // Fallback heuristics if indexes 1 and 2 are missing
                    if (lastCurrentPercent === null && quotas.length >= 2) {
                        lastWeeklyPercent = Math.round(quotas[0][1] * 100);
                        lastCurrentPercent = Math.round(quotas[1][1] * 100);
                    } else if (lastCurrentPercent === null && quotas.length === 1) {
                        lastCurrentPercent = Math.round(quotas[0][1] * 100);
                    }

                    console.info(`[Gemini Dumper] Quota processed via ${source}. Current: ${lastCurrentPercent}%, Weekly: ${lastWeeklyPercent}%, Reset: ${resetTimeCurrent}`);
                    updateBadgeUI();
                }
            }
        } catch (e) {
            console.error('[Gemini Dumper] Error parsing quota response:', e);
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
        .catch(err => console.error('[Gemini Dumper] API Fetch error:', err))
        .finally(() => {
            isSyncing = false;
            updateBadgeUI();
        });
    }

    // Intercept native XHR methods to extract IDs and payloads
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
                    
                    // Trigger active fetch when initial credentials are found
                    setTimeout(fetchQuota, 1000);
                    if (!syncInterval) syncInterval = setInterval(fetchQuota, 3 * 60 * 1000);
                }
            }
        }
        originalSend.apply(this, arguments);
    };

    // Initialize UI on load
    updateBadgeUI();
})();
