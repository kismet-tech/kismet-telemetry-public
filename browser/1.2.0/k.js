/** Kismet browser telemetry 1.2.0. Explicit external consent. Fixed release. */
;
(function () {
    'use strict';
    if (!window.KismetConsent || typeof window.KismetConsent.getState !== 'function')
        return;
    function analyticsAllowed() { return window.KismetConsent.getState().analytics === true; }
    function advertisingAllowed() { return window.KismetConsent.getState().advertising === true; }
    function consentedPayload(payload) {
        if (advertisingAllowed())
            return payload;
        var clean = {};
        Object.keys(payload || {}).forEach(function (key) { if (['fbc', 'fbp', 'metaEventId'].indexOf(key) === -1)
            clean[key] = payload[key]; });
        return clean;
    }
    var consentDefaultsSent = false;
    if (!window.Kismet || window.Kismet._sidSuppressed || !window.Kismet._kidSid)
        return;
    if (window.__kismetKjsEval)
        return;
    window.__kismetKjsEval = 1;
    var ORIGIN = 'https://kismet.travel';
    var CONFIG_PATH = '/api/k/config';
    var PING_PATH = '/api/k/ping';
    var TRACK_PATH = '/api/track';
    var BRIDGE_PATH = '/api/k/booking-bridge';
    var REVENUE_ATTR_PATH = '/api/tracking/revenue-attribution/convert';
    var COOKIE_MAX_AGE = 13 * 30 * 24 * 60 * 60;
    var SESSION_MAX_AGE = 90 * 24 * 60 * 60;
    var ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    var EU = { "AT": 1, "BE": 1, "BG": 1, "HR": 1, "CY": 1, "CZ": 1, "DK": 1, "EE": 1, "FI": 1, "FR": 1, "DE": 1, "GR": 1, "HU": 1, "IE": 1, "IT": 1, "LV": 1, "LT": 1, "LU": 1, "MT": 1, "NL": 1, "PL": 1, "PT": 1, "RO": 1, "SK": 1, "SI": 1, "ES": 1, "SE": 1, "GB": 1, "IS": 1, "LI": 1, "NO": 1, "CH": 1 };
    var script = document.currentScript || (function () {
        var s = document.getElementsByTagName('script');
        for (var i = s.length - 1; i >= 0; i--) {
            if (s[i].src && s[i].src.indexOf('/k.js') !== -1)
                return s[i];
        }
        return null;
    })();
    var collection = (function () {
        if (script && script.src) {
            try {
                var u = new URL(script.src);
                var c = u.searchParams.get('c');
                if (c)
                    return c;
            }
            catch (e) { }
        }
        if (script) {
            var attr = script.getAttribute('data-collection');
            if (attr)
                return attr;
        }
        return null;
    })();
    if (!collection)
        return;
    var vrSlug = script ? script.getAttribute('data-vr-slug') : null;
    function getParam(name) {
        try {
            var m = location.search.match(new RegExp('[?&]' + name + '=([^&]*)'));
            return m ? decodeURIComponent(m[1]) : null;
        }
        catch (e) {
            return null;
        }
    }
    function getCookie(name) {
        var m = document.cookie.match(new RegExp('(?:^|; )' + name + '=([^;]*)'));
        return m ? decodeURIComponent(m[1]) : null;
    }
    function setCookie(name, value, maxAge) {
        if (!analyticsAllowed())
            return;
        if ((name === "_fbc" || name === "_fbp") && !advertisingAllowed())
            return;
        document.cookie = name + '=' + encodeURIComponent(value) +
            ';path=/;max-age=' + maxAge + ';SameSite=Lax;Secure';
    }
    function generateKidSid() {
        var r = 'kid_';
        if (typeof crypto !== 'undefined' && crypto.getRandomValues) {
            var b = new Uint8Array(8);
            crypto.getRandomValues(b);
            for (var i = 0; i < 8; i++)
                r += ALPHABET[b[i] % ALPHABET.length];
        }
        else {
            for (var j = 0; j < 8; j++)
                r += ALPHABET[Math.floor(Math.random() * ALPHABET.length)];
        }
        return r;
    }
    function whenBody(fn) {
        if (document.body)
            return fn();
        var iv = setInterval(function () {
            if (document.body) {
                clearInterval(iv);
                fn();
            }
        }, 50);
    }
    var AI_PATTERNS = [
        { src: 'chatgpt', re: /chatgpt\.com|chat\.openai\.com|openai\.com/ },
        { src: 'gemini', re: /gemini\.google\.com|bard\.google\.com/ },
        { src: 'perplexity', re: /perplexity\.ai/ },
        { src: 'grok', re: /grok\.com|grok\.x\.ai/ },
        { src: 'claude', re: /claude\.ai|anthropic\.com/ },
        { src: 'copilot', re: /copilot\.microsoft\.com/ },
        { src: 'deepseek', re: /deepseek\.ai|chat\.deepseek\.com/ },
        { src: 'meta_ai', re: /meta\.ai/ },
        { src: 'mistral', re: /mistral\.ai|chat\.mistral\.ai/ },
        { src: 'you', re: /you\.com/ },
        { src: 'poe', re: /poe\.com/ },
        { src: 'pi', re: /pi\.ai|heypi\.com/ },
        { src: 'character', re: /character\.ai/ },
        { src: 'brave', re: /search\.brave\.com/ }
    ];
    var SEARCH_PATTERNS = [
        { src: 'google', re: /google\.\w+/ },
        { src: 'bing', re: /bing\.com/ },
        { src: 'duckduckgo', re: /duckduckgo\.com/ },
        { src: 'yahoo', re: /yahoo\.com/ }
    ];
    function classifySource() {
        if (getParam('gclid'))
            return 'google_paid';
        if (getParam('fbclid'))
            return 'meta';
        var utm = getParam('utm_source');
        if (utm) {
            var l = utm.toLowerCase();
            if (l === 'kismet_ai')
                return 'kismet_storefront';
            if (l.indexOf('chatgpt') !== -1)
                return 'chatgpt';
            if (l.indexOf('perplexity') !== -1)
                return 'perplexity';
        }
        var ref = document.referrer;
        if (ref) {
            try {
                var h = new URL(ref).hostname;
                var hh = h.replace(/^www\./, '');
                var here = location.hostname.replace(/^www\./, '');
                if (hh === here || hh.slice(-(here.length + 1)) === '.' + here || here.slice(-(hh.length + 1)) === '.' + hh)
                    return 'direct';
                if (/^(staging\.)?kismet\.travel$/.test(h))
                    return 'kismet_storefront';
                for (var i = 0; i < AI_PATTERNS.length; i++) {
                    if (AI_PATTERNS[i].re.test(h))
                        return AI_PATTERNS[i].src;
                }
                for (var j = 0; j < SEARCH_PATTERNS.length; j++) {
                    if (SEARCH_PATTERNS[j].re.test(h))
                        return SEARCH_PATTERNS[j].src;
                }
                return 'organic';
            }
            catch (e) { }
        }
        return 'direct';
    }
    var _config = null;
    function edgeSeed() {
        return (typeof window !== 'undefined' && window.Kismet) || null;
    }
    var _kidSid = (function () { var s = edgeSeed(); return (s && s._kidSid) || getCookie('_kid_sid') || null; })();
    var _kidSrc = getCookie('_kid_src');
    var _cookiesSet = false;
    function shouldSetCookies(cc) {
        return analyticsAllowed();
    }
    function resolveSession(cc) {
        if (!analyticsAllowed())
            return;
        var canSet = shouldSetCookies(cc);
        var seed = edgeSeed();
        if (seed && seed._kidSid)
            _kidSid = seed._kidSid;
        if (!_kidSid && seed && seed._sidSuppressed)
            return;
        var urlKidSid = getParam('kid_sid');
        if (urlKidSid && !_kidSid) {
            _kidSid = urlKidSid;
            _kidSrc = getParam('kid_src') || classifySource();
            if (canSet) {
                setCookie('_kid_sid', _kidSid, SESSION_MAX_AGE);
                setCookie('_kid_src', _kidSrc, COOKIE_MAX_AGE);
                _cookiesSet = true;
            }
        }
        else if (!_kidSid) {
            _kidSid = generateKidSid();
            _kidSrc = classifySource();
            if (canSet) {
                setCookie('_kid_sid', _kidSid, SESSION_MAX_AGE);
                setCookie('_kid_src', _kidSrc, COOKIE_MAX_AGE);
                _cookiesSet = true;
            }
        }
        else if (!_kidSrc) {
            _kidSrc = classifySource();
            if (canSet) {
                setCookie('_kid_src', _kidSrc, COOKIE_MAX_AGE);
                _cookiesSet = true;
            }
        }
        else {
            _cookiesSet = true;
        }
        var fbclid = getParam('fbclid');
        if (fbclid && canSet && !getCookie('_fbc')) {
            setCookie('_fbc', 'fb.1.' + Date.now() + '.' + fbclid, COOKIE_MAX_AGE);
        }
    }
    function setConsentDefaults(cc) {
        var a = analyticsAllowed() ? "granted" : "denied";
        var d = advertisingAllowed() ? "granted" : "denied";
        window.dataLayer = window.dataLayer || [];
        (function () { window.dataLayer.push(arguments); })("consent", consentDefaultsSent ? "update" : "default", { analytics_storage: a, ad_storage: d, ad_user_data: d, ad_personalization: d });
        consentDefaultsSent = true;
    }
    function loadGtag(tagId) {
        if (!advertisingAllowed())
            return;
        if (!tagId)
            return;
        var s = document.createElement('script');
        s.async = true;
        s.src = 'https://www.googletagmanager.com/gtag/js?id=' + tagId;
        document.head.appendChild(s);
        window.dataLayer = window.dataLayer || [];
        function gtag() { window.dataLayer.push(arguments); }
        gtag('js', new Date());
        gtag('config', tagId);
    }
    function loadGa4(ga4Id) {
        if (!analyticsAllowed())
            return;
        if (!ga4Id)
            return;
        var s = document.createElement('script');
        s.async = true;
        s.src = 'https://www.googletagmanager.com/gtag/js?id=' + ga4Id;
        document.head.appendChild(s);
        window.dataLayer = window.dataLayer || [];
        function gtag() { window.dataLayer.push(arguments); }
        gtag('js', new Date());
        gtag('config', ga4Id, { send_page_view: false });
    }
    function fireGa4(eventName, params) {
        if (!analyticsAllowed())
            return;
        if (!_config || !_config.ga4MeasurementId)
            return;
        window.dataLayer = window.dataLayer || [];
        function gtag() { window.dataLayer.push(arguments); }
        try {
            var p = { send_to: _config.ga4MeasurementId };
            for (var k in params) {
                if (params.hasOwnProperty(k))
                    p[k] = params[k];
            }
            gtag('event', eventName, p);
        }
        catch (e) { }
    }
    function loadMetaPixel(pixelId) {
        if (!advertisingAllowed())
            return;
        if (!pixelId || window.fbq)
            return;
        !function (f, b, e, v, n, t, s) {
            if (f.fbq)
                return;
            n = f.fbq = function () { n.callMethod ? n.callMethod.apply(n, arguments) : n.queue.push(arguments); };
            if (!f._fbq)
                f._fbq = n;
            n.push = n;
            n.loaded = !0;
            n.version = '2.0';
            n.queue = [];
            t = b.createElement(e);
            t.async = !0;
            t.src = v;
            s = b.getElementsByTagName(e)[0];
            s.parentNode.insertBefore(t, s);
        }(window, document, 'script', 'https://connect.facebook.net/en_US/fbevents.js');
        fbq('init', pixelId);
        fbq('track', 'PageView');
    }
    function loadOpenAiPixel(pixelId) {
        if (!advertisingAllowed())
            return;
        if (!pixelId || window.oaiq)
            return;
        var q = function () { q.q.push(arguments); };
        q.q = [];
        window.oaiq = q;
        var s = document.createElement('script');
        s.async = true;
        s.src = 'https://bzrcdn.openai.com/sdk/oaiq.min.js';
        document.head.appendChild(s);
        window.oaiq('init', { pixelId: pixelId });
        window.oaiq('measure', 'page_viewed');
    }
    function injectVerificationMeta(token) {
        if (!token)
            return;
        var existing = document.querySelector('meta[name="google-site-verification"]');
        if (existing)
            return;
        var meta = document.createElement('meta');
        meta.name = 'google-site-verification';
        meta.content = token;
        document.head.appendChild(meta);
    }
    function sendInstallPing(entityId) {
        if (!analyticsAllowed())
            return;
        var key = '_kismet_ping_sent';
        try {
            if (sessionStorage.getItem(key))
                return;
            sessionStorage.setItem(key, '1');
        }
        catch (e) { }
        try {
            var data = JSON.stringify({ entityId: entityId, domain: location.hostname });
            if (navigator.sendBeacon) {
                navigator.sendBeacon(ORIGIN + PING_PATH, new Blob([data], { type: 'text/plain' }));
            }
            else {
                var xhr = new XMLHttpRequest();
                xhr.open('POST', ORIGIN + PING_PATH, true);
                xhr.setRequestHeader('Content-Type', 'text/plain');
                xhr.send(data);
            }
        }
        catch (e) { }
    }
    function sendPageView() {
        if (!analyticsAllowed())
            return;
        var seed = edgeSeed();
        if (!_kidSid && seed && seed._sidSuppressed)
            return;
        var payload = {
            trackingMode: 'client',
            pageUrl: location.href,
            resourceClass: vrSlug ? 'content_vr' : 'content_vrm',
            actionType: 'view',
            collectionSlug: collection,
            vacationRentalSlug: vrSlug,
            servingDomain: location.hostname,
            referrer: document.referrer || null,
            referrerSource: _kidSrc,
            utmSource: getParam('utm_source'),
            utmMedium: getParam('utm_medium'),
            screenWidth: typeof window.innerWidth === 'number' ? window.innerWidth : null,
            clientSessionId: _kidSid,
            cookiesSet: _cookiesSet
        };
        try {
            if (navigator.sendBeacon) {
                navigator.sendBeacon(ORIGIN + TRACK_PATH, new Blob([JSON.stringify(consentedPayload(payload))], { type: 'text/plain' }));
            }
            else {
                var xhr = new XMLHttpRequest();
                xhr.open('POST', ORIGIN + TRACK_PATH, true);
                xhr.setRequestHeader('Content-Type', 'text/plain');
                xhr.send(JSON.stringify(consentedPayload(payload)));
            }
        }
        catch (e) { }
    }
    function looksLikeBookingRef(s) {
        return typeof s === 'string' && s.length >= 6 && s.length <= 64 && /[0-9]/.test(s);
    }
    function sendBookingBridge(reservationId) {
        if (!analyticsAllowed())
            return;
        if (!_kidSid || !reservationId || !looksLikeBookingRef(reservationId))
            return;
        try {
            var payload = {
                kidSid: _kidSid,
                domain: location.hostname
            };
            if (/^[0-9a-f]{24}$/i.test(reservationId))
                payload.reservationId = reservationId;
            else
                payload.confirmationCode = reservationId;
            if (_config && _config.bookingEngine)
                payload.bookingEngine = _config.bookingEngine;
            if (_config && _config.bridgeToken)
                payload.bridgeToken = _config.bridgeToken;
            if (_config && _config.entityId)
                payload.entityId = _config.entityId;
            var data = JSON.stringify(consentedPayload(payload));
            if (navigator.sendBeacon) {
                navigator.sendBeacon(ORIGIN + BRIDGE_PATH, new Blob([data], { type: 'text/plain' }));
            }
            else {
                var xhr = new XMLHttpRequest();
                xhr.open('POST', ORIGIN + BRIDGE_PATH, true);
                xhr.setRequestHeader('Content-Type', 'text/plain');
                xhr.send(data);
            }
        }
        catch (e) { }
        convertRevenueAttribution(reservationId);
    }
    function convertRevenueAttribution(reservationId) {
        if (!analyticsAllowed())
            return;
        if (!_kidSid || !reservationId)
            return;
        try {
            var slug = '';
            var pathMatch = (document.referrer || location.pathname).match(/\/vr\/([^/?#]+)/);
            if (pathMatch)
                slug = pathMatch[1];
            if (!slug)
                return;
            var payload = {
                sessionId: _kidSid,
                vacationRentalSlug: slug,
                bookingId: reservationId,
                finalTotalCents: 0,
                finalNights: 0,
                checkIn: '',
                checkOut: ''
            };
            var data = JSON.stringify(consentedPayload(payload));
            if (navigator.sendBeacon) {
                navigator.sendBeacon(ORIGIN + REVENUE_ATTR_PATH, new Blob([data], { type: 'text/plain' }));
            }
            else {
                var xhr = new XMLHttpRequest();
                xhr.open('POST', ORIGIN + REVENUE_ATTR_PATH, true);
                xhr.setRequestHeader('Content-Type', 'text/plain');
                xhr.send(data);
            }
        }
        catch (e) { }
    }
    function startGuestyInlineDetector() {
        if (typeof MutationObserver === 'undefined')
            return;
        var found = false;
        var observer = new MutationObserver(function (mutations) {
            if (found)
                return;
            for (var i = 0; i < mutations.length; i++) {
                var nodes = mutations[i].addedNodes;
                for (var j = 0; j < nodes.length; j++) {
                    var el = nodes[j];
                    if (el.nodeType !== 1)
                        continue;
                    var text = el.textContent || '';
                    var match = text.match(/(?:confirmation|booking)\s*(?:#|number|:)?\s*([A-Z0-9-]{6,})/i);
                    if (match) {
                        found = true;
                        sendBookingBridge(match[1]);
                        observer.disconnect();
                        return;
                    }
                }
            }
        });
        observer.observe(document.body, { childList: true, subtree: true });
    }
    function startGuestyRedirectDetector() {
        var lastUrl = location.href;
        var check = function () {
            if (location.href !== lastUrl) {
                lastUrl = location.href;
                if (/confirm|success|thank/i.test(location.pathname)) {
                    var urlMatch = location.search.match(/(?:reservation|booking|conf)[_=-]?(?:id)?=([A-Za-z0-9-]+)/i);
                    if (urlMatch)
                        sendBookingBridge(urlMatch[1]);
                }
            }
        };
        setInterval(check, 1000);
    }
    function captureConfirmationFromUrl() {
        try {
            if (!/confirm|success|thank/i.test(location.pathname))
                return;
            var m = location.search.match(/(?:reservation|booking|conf)[_=-]?(?:id)?=([A-Za-z0-9-]+)/i);
            if (m)
                sendBookingBridge(m[1]);
        }
        catch (e) { }
    }
    var _confScanned = false;
    function scanConfirmationInDom() {
        if (_confScanned)
            return;
        try {
            if (!/confirm|success|thank/i.test(location.pathname))
                return;
            var txt = (document.body && (document.body.innerText || document.body.textContent)) || '';
            if (!txt)
                return;
            var m = txt.match(/\bGY-[A-Za-z0-9]{6,}\b/) ||
                txt.match(/(?:confirmation|booking)\s*(?:code|number|#|:)?\s*([A-Z0-9][A-Z0-9-]{5,})/i);
            var code = m ? (m[1] || m[0]) : null;
            if (code && looksLikeBookingRef(code)) {
                _confScanned = true;
                sendBookingBridge(code);
            }
        }
        catch (e) { }
    }
    var ELEMENT_EVENT_MAP = {
        'property-detail:view': { actionType: 'property_view', resourceClass: 'content_vr', metaEvent: 'ViewContent', ga4Event: 'view_item' },
        'property-detail:book': { actionType: 'cta_click', resourceClass: 'content_vr', metaEvent: 'InitiateCheckout', ga4Event: 'begin_checkout' },
        'property-detail:share': { actionType: 'click', resourceClass: 'content_vr' },
        'property:save': { actionType: 'add_to_wishlist', resourceClass: 'content_vr', metaEvent: 'AddToWishlist', ga4Event: 'add_to_wishlist' },
        'property:cta': { actionType: 'click', resourceClass: 'content_vr' },
        'property:share': { actionType: 'click', resourceClass: 'content_vr' },
        'external:click': { actionType: 'click', resourceClass: 'content_vr' },
        'search:view': { actionType: 'view', resourceClass: 'content_vrm', metaEvent: 'Search', ga4Event: 'view_item_list' },
        'lead-form:view': { actionType: 'form_view', resourceClass: 'content_marketing' },
        'lead-form:start': { actionType: 'form_start', resourceClass: 'content_marketing' },
        'lead-form:submit': { actionType: 'form_submit', resourceClass: 'content_marketing', metaEvent: 'Lead', ga4Event: 'generate_lead', spineSource: 'server' },
        'meeting:booked': { actionType: 'meeting_booked', resourceClass: 'content_marketing' }
    };
    function postTrack(payload) {
        if (!analyticsAllowed())
            return;
        try {
            var data = JSON.stringify(consentedPayload(payload));
            if (navigator.sendBeacon) {
                navigator.sendBeacon(ORIGIN + TRACK_PATH, new Blob([data], { type: 'text/plain' }));
            }
            else {
                var xhr = new XMLHttpRequest();
                xhr.open('POST', ORIGIN + TRACK_PATH, true);
                xhr.setRequestHeader('Content-Type', 'text/plain');
                xhr.send(data);
            }
        }
        catch (e) { }
    }
    var STAMP_FIELD = 'kismet_kid_sid';
    function stampLeadForm(form) {
        if (!analyticsAllowed())
            return;
        try {
            if (!_kidSid || !form || form.nodeName !== 'FORM')
                return;
            if (String(form.method).toLowerCase() !== 'post')
                return;
            var host = form.querySelector('input[name="' + STAMP_FIELD + '"],input[data-kismet-sid],.kismet-kid-sid input');
            if (!host) {
                host = document.createElement('input');
                host.type = 'hidden';
                host.name = STAMP_FIELD;
                form.appendChild(host);
            }
            if (host.value !== _kidSid)
                host.value = _kidSid;
        }
        catch (e) { }
    }
    function stampAllLeadForms() {
        try {
            var forms = document.forms;
            for (var i = 0; i < forms.length; i++)
                stampLeadForm(forms[i]);
        }
        catch (e) { }
    }
    var _stampingStarted = false;
    function startLeadFormStamping() {
        if (_stampingStarted)
            return;
        _stampingStarted = true;
        try {
            document.addEventListener('submit', function (e) { if (!analyticsAllowed())
                return; stampLeadForm(e.target); }, true);
        }
        catch (e) { }
        whenBody(stampAllLeadForms);
    }
    var _hrCfg = null;
    function hrConfig() {
        if (_hrCfg)
            return _hrCfg;
        _hrCfg = { propertyId: null, currency: 'USD' };
        try {
            var s = document.getElementsByTagName('script');
            for (var i = 0; i < s.length; i++) {
                var t = s[i].textContent || '';
                if (t.indexOf('property_id') === -1)
                    continue;
                var mp = t.match(/"property_id":\s*"?([0-9]{2,})/);
                if (mp && !_hrCfg.propertyId)
                    _hrCfg.propertyId = mp[1];
                var mc = t.match(/"currency":\s*"([A-Za-z]{3})"/);
                if (mc)
                    _hrCfg.currency = mc[1].toUpperCase();
                if (_hrCfg.propertyId)
                    break;
            }
        }
        catch (e) { }
        return _hrCfg;
    }
    function hrDates() {
        var qs = location.search || '';
        var ci = (qs.match(/[?&]checkin=([0-9]{4}-[0-9]{2}-[0-9]{2})/) || [])[1] || null;
        var co = (qs.match(/[?&]checkout=([0-9]{4}-[0-9]{2}-[0-9]{2})/) || [])[1] || null;
        if ((!ci || !co) && document.getElementById) {
            var a = document.getElementById('checkin');
            var b = document.getElementById('checkout');
            if (a && a.value)
                ci = ci || a.value;
            if (b && b.value)
                co = co || b.value;
        }
        return { checkin: ci, checkout: co };
    }
    var _hrLastKey = null;
    function captureHomerunnerQuote() {
        if (!analyticsAllowed())
            return;
        try {
            if (!_kidSid || !_config || _config.bookingEngine !== 'homerunner')
                return;
            if (typeof fetch !== 'function')
                return;
            var d = hrDates();
            if (!d.checkin || !d.checkout)
                return;
            var cfg = hrConfig();
            if (!cfg.propertyId)
                return;
            var ge = document.getElementById && document.getElementById('guests');
            var guests = (ge && ge.value) || '1';
            var key = cfg.propertyId + '|' + d.checkin + '|' + d.checkout + '|' + guests;
            if (key === _hrLastKey)
                return;
            _hrLastKey = key;
            var body = 'checkin=' + encodeURIComponent(d.checkin) + '&checkout=' + encodeURIComponent(d.checkout) + '&guests=' + encodeURIComponent(guests) + '&property_id=' + encodeURIComponent(cfg.propertyId);
            fetch(location.origin + '/wp-json/homelocal/v1/quotes', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: body, credentials: 'omit' }).then(function (r) {
                if (!analyticsAllowed())
                    return;
                return (r && r.ok) ? r.json() : null;
            }).then(function (q) {
                if (!analyticsAllowed())
                    return;
                if (!q || !q.rateplans || !q.rateplans.length)
                    return;
                var rp = q.rateplans[0];
                var total = (rp && typeof rp.total === 'number') ? rp.total : null;
                if (total == null)
                    return;
                postTrack({
                    trackingMode: 'client',
                    pageUrl: location.href,
                    resourceClass: 'content_vr',
                    actionType: 'property_view',
                    collectionSlug: collection,
                    vacationRentalSlug: vrSlug || null,
                    servingDomain: location.hostname,
                    referrer: document.referrer || null,
                    clientSessionId: _kidSid,
                    stayCheckIn: q.checkin || d.checkin,
                    stayCheckOut: q.checkout || d.checkout,
                    stayNights: q.nights || null,
                    guestCount: parseInt(guests, 10) || null,
                    stayTotalCents: Math.round(total * 100),
                    currency: q.currency || cfg.currency || 'USD'
                });
            }).catch(function () { });
        }
        catch (e) { }
    }
    var _hrStarted = false;
    function startHomerunnerQuoteCapture() {
        if (_hrStarted || !_config || _config.bookingEngine !== 'homerunner')
            return;
        _hrStarted = true;
        captureHomerunnerQuote();
        var last = location.search;
        setInterval(function () {
            if (location.search !== last) {
                last = location.search;
                captureHomerunnerQuote();
            }
        }, 1000);
    }
    var _hrIdentLast = '';
    function hrField(name) {
        try {
            var el = document.querySelector('input[name="' + name + '"]');
            return (el && el.value && ('' + el.value).trim()) || '';
        }
        catch (e) {
            return '';
        }
    }
    function sendHomerunnerIdentify() {
        if (!analyticsAllowed())
            return;
        if (!_kidSid)
            return;
        var email = hrField('email');
        var phone = hrField('phone');
        var hasEmail = email.indexOf('@') > 0;
        var hasPhone = phone.replace(/[^0-9]/g, '').length >= 10;
        if (!hasEmail && !hasPhone)
            return;
        var sig = (hasEmail ? email : '') + '|' + (hasPhone ? phone : '');
        if (sig === _hrIdentLast)
            return;
        _hrIdentLast = sig;
        var d = hrDates();
        var payload = {
            kidSid: _kidSid,
            source: 'homerunner_checkout',
            email: hasEmail ? email : null,
            phone: hasPhone ? phone : null,
            firstName: hrField('first_name') || null,
            lastName: hrField('last_name') || null,
            collectionSlug: collection || null,
            vrSlug: vrSlug || null,
            checkIn: d.checkin || null,
            checkOut: d.checkout || null
        };
        if (_config && _config.bridgeToken)
            payload.bridgeToken = _config.bridgeToken;
        if (_config && _config.entityId)
            payload.entityId = _config.entityId;
        var data = JSON.stringify(consentedPayload(payload));
        try {
            if (navigator.sendBeacon) {
                navigator.sendBeacon(ORIGIN + '/api/k/identify', new Blob([data], { type: 'text/plain' }));
            }
            else {
                var xhr = new XMLHttpRequest();
                xhr.open('POST', ORIGIN + '/api/k/identify', true);
                xhr.setRequestHeader('Content-Type', 'text/plain');
                xhr.send(data);
            }
        }
        catch (e) { }
    }
    var _hrIdentStarted = false;
    function startHomerunnerIdentifyCapture() {
        if (_hrIdentStarted || !_config || _config.bookingEngine !== 'homerunner')
            return;
        _hrIdentStarted = true;
        try {
            var _open = XMLHttpRequest.prototype.open;
            XMLHttpRequest.prototype.open = function (method, url) {
                try {
                    if (typeof url === 'string' && /\/wp-json\/homelocal\/v1\/quotes\/[^/]+\/reservation/.test(url))
                        sendHomerunnerIdentify();
                }
                catch (e) { }
                return _open.apply(this, arguments);
            };
        }
        catch (e) { }
        try {
            document.addEventListener('blur', function (e) {
                if (!analyticsAllowed())
                    return;
                var t = e && e.target;
                if (t && (t.name === 'email' || t.name === 'phone'))
                    sendHomerunnerIdentify();
            }, true);
        }
        catch (e) { }
    }
    var _bridgeStarted = false;
    function startElementEventBridge() {
        if (_bridgeStarted)
            return;
        _bridgeStarted = true;
        for (var name in ELEMENT_EVENT_MAP) {
            if (!ELEMENT_EVENT_MAP.hasOwnProperty(name))
                continue;
            (function (evtName, map) {
                window.addEventListener('kismet:visitor:' + evtName, function (e) {
                    if (!analyticsAllowed())
                        return;
                    try {
                        var d = (e && e.detail) || {};
                        var sid = _kidSid || d.kidSid || null;
                        if (!sid)
                            return;
                        var vrs = d.vrSlug || d.slug || d.vacationRentalSlug || vrSlug || null;
                        var eid = sid + '|' + (d.collectionSlug || collection) + '|' + (vrs || '') + '|' + map.actionType + '|' + new Date().toISOString().slice(0, 10);
                        var capiConsent = _config && advertisingAllowed();
                        if (map.spineSource !== 'server')
                            postTrack({
                                trackingMode: 'client',
                                pageUrl: location.href,
                                resourceClass: map.resourceClass,
                                actionType: map.actionType,
                                collectionSlug: d.collectionSlug || collection,
                                vacationRentalSlug: vrs,
                                servingDomain: d.servingDomain || location.hostname,
                                referrer: document.referrer || null,
                                clientSessionId: sid,
                                metaEventId: eid,
                                fbc: capiConsent ? getCookie('_fbc') : null,
                                fbp: capiConsent ? getCookie('_fbp') : null,
                                cookiesSet: _cookiesSet,
                                exposureDepth: d.exposureDepth || null,
                                stayCheckIn: d.checkIn || d.stayCheckIn || null,
                                stayCheckOut: d.checkOut || d.stayCheckOut || null,
                                guestCount: d.guests || d.guestCount || null,
                                stayNights: d.nightCount || d.stayNights || null,
                                stayTotalCents: d.stayTotalCents || null,
                                currency: d.currency || null
                            });
                        if (window.fbq && map.metaEvent) {
                            var md = { content_type: 'hotel' };
                            md.collection_id = d.collectionSlug || collection;
                            if (d.propertyId)
                                md.hotel_ids = [d.propertyId];
                            if (d.checkIn || d.stayCheckIn)
                                md.checkin_date = d.checkIn || d.stayCheckIn;
                            if (d.checkOut || d.stayCheckOut)
                                md.checkout_date = d.checkOut || d.stayCheckOut;
                            var na = d.guests || d.guestCount;
                            if (na)
                                md.num_adults = parseInt(na, 10);
                            var nn = d.nightCount || d.stayNights;
                            if (nn)
                                md.num_nights = parseInt(nn, 10);
                            if (d.stayTotalCents) {
                                md.value = d.stayTotalCents / 100;
                                md.currency = d.currency || 'USD';
                            }
                            advertisingAllowed() && window.fbq('track', map.metaEvent, md, { eventID: eid });
                        }
                        if (map.ga4Event) {
                            var gi = {
                                item_id: d.propertyId || vrs || 'vacation_rental',
                                item_name: d.propertyName || d.vrName || vrs || 'Vacation Rental',
                                item_category: 'vacation_rental'
                            };
                            var gp = { items: [gi] };
                            var gv = d.stayTotalCents ? d.stayTotalCents / 100 : null;
                            if (gv != null) {
                                gp.value = gv;
                                gi.price = gv;
                            }
                            gp.currency = d.currency || 'USD';
                            if (d.checkIn || d.stayCheckIn)
                                gi.start_date = d.checkIn || d.stayCheckIn;
                            if (d.checkOut || d.stayCheckOut)
                                gi.end_date = d.checkOut || d.stayCheckOut;
                            var gng = parseInt(d.guests || d.guestCount, 10);
                            if (gng)
                                gp.guests = gng;
                            fireGa4(map.ga4Event, gp);
                        }
                    }
                    catch (err) { }
                });
            })(name, ELEMENT_EVENT_MAP[name]);
        }
        var CHECKOUT_GA4_MAP = {
            'checkout:add-shipping': 'add_shipping_info',
            'checkout:add-payment': 'add_payment_info',
            'checkout:purchase': 'purchase'
        };
        for (var cn in CHECKOUT_GA4_MAP) {
            if (!CHECKOUT_GA4_MAP.hasOwnProperty(cn))
                continue;
            (function (evtName, ga4Event) {
                window.addEventListener('kismet:visitor:' + evtName, function (e) {
                    if (!analyticsAllowed())
                        return;
                    try {
                        if (!_config)
                            return;
                        var d = (e && e.detail) || {};
                        var vrs = d.vrSlug || d.slug || vrSlug || null;
                        var gi = {
                            item_id: d.propertyId || vrs || 'vacation_rental',
                            item_name: d.propertyName || d.vrName || vrs || 'Vacation Rental',
                            item_category: 'vacation_rental'
                        };
                        var gp = { items: [gi] };
                        var gv = d.stayTotalCents ? d.stayTotalCents / 100 : null;
                        if (gv != null) {
                            gp.value = gv;
                            gi.price = gv;
                        }
                        gp.currency = d.currency || 'USD';
                        if (d.checkIn || d.stayCheckIn)
                            gi.start_date = d.checkIn || d.stayCheckIn;
                        if (d.checkOut || d.stayCheckOut)
                            gi.end_date = d.checkOut || d.stayCheckOut;
                        var gng = parseInt(d.guests || d.guestCount, 10);
                        if (gng)
                            gp.guests = gng;
                        if (ga4Event === 'purchase' && d.transactionId)
                            gp.transaction_id = d.transactionId;
                        fireGa4(ga4Event, gp);
                        if (evtName === 'checkout:add-payment' && window.fbq) {
                            var sid = _kidSid || d.kidSid || null;
                            var md = { content_type: 'hotel' };
                            md.collection_id = d.collectionSlug || collection;
                            if (d.propertyId)
                                md.hotel_ids = [d.propertyId];
                            if (d.checkIn || d.stayCheckIn)
                                md.checkin_date = d.checkIn || d.stayCheckIn;
                            if (d.checkOut || d.stayCheckOut)
                                md.checkout_date = d.checkOut || d.stayCheckOut;
                            var na = parseInt(d.guests || d.guestCount, 10);
                            if (na)
                                md.num_adults = na;
                            if (gv != null) {
                                md.value = gv;
                                md.currency = d.currency || 'USD';
                            }
                            var eid = sid ? sid + '|' + (d.collectionSlug || collection) + '|' + (vrs || '') + '|add_payment|' + new Date().toISOString().slice(0, 10) : null;
                            if (eid) {
                                advertisingAllowed() && window.fbq('track', 'AddPaymentInfo', md, { eventID: eid });
                            }
                            else {
                                advertisingAllowed() && window.fbq('track', 'AddPaymentInfo', md);
                            }
                        }
                        if (evtName === 'checkout:purchase' && window.fbq && d.metaEventId) {
                            var pmd = { content_type: 'hotel' };
                            pmd.collection_id = d.collectionSlug || collection;
                            if (d.propertyId)
                                pmd.hotel_ids = [d.propertyId];
                            if (d.checkIn || d.stayCheckIn)
                                pmd.checkin_date = d.checkIn || d.stayCheckIn;
                            if (d.checkOut || d.stayCheckOut)
                                pmd.checkout_date = d.checkOut || d.stayCheckOut;
                            var pna = parseInt(d.guests || d.guestCount, 10);
                            if (pna)
                                pmd.num_adults = pna;
                            var pnn = parseInt(d.nightCount || d.stayNights, 10);
                            if (pnn)
                                pmd.num_nights = pnn;
                            if (gv != null) {
                                pmd.value = gv;
                                pmd.currency = d.currency || 'USD';
                            }
                            advertisingAllowed() && window.fbq('track', 'Purchase', pmd, { eventID: d.metaEventId });
                        }
                    }
                    catch (err) { }
                });
            })(cn, CHECKOUT_GA4_MAP[cn]);
        }
    }
    window.Kismet = window.Kismet || {};
    var _kismetApi = {
        _config: null,
        _kidSid: null,
        track: function (event, data) {
            if (!analyticsAllowed())
                return;
            try {
                var payload = Object.assign({}, {
                    trackingMode: 'client',
                    pageUrl: location.href,
                    collectionSlug: collection,
                    servingDomain: location.hostname,
                    clientSessionId: (window.Kismet && window.Kismet._kidSid) || _kidSid,
                    actionType: event
                }, data || {});
                if (navigator.sendBeacon) {
                    navigator.sendBeacon(ORIGIN + TRACK_PATH, new Blob([JSON.stringify(consentedPayload(payload))], { type: 'text/plain' }));
                }
            }
            catch (e) { }
        },
        identify: function (data) {
        }
    };
    for (var _k in _kismetApi) {
        if (!Object.prototype.hasOwnProperty.call(window.Kismet, _k) || window.Kismet[_k] == null) {
            window.Kismet[_k] = _kismetApi[_k];
        }
    }
    function bootstrap() {
        if (!analyticsAllowed())
            return;
        try {
            _configAttempts++;
            var xhr = new XMLHttpRequest();
            xhr.open('GET', ORIGIN + CONFIG_PATH + '?c=' + encodeURIComponent(collection), true);
            xhr.timeout = 5000;
            xhr.onload = function () {
                if (!analyticsAllowed())
                    return;
                if (xhr.status !== 200)
                    return retryOrFallback();
                try {
                    _config = JSON.parse(xhr.responseText);
                }
                catch (e) {
                    return fallback();
                }
                window.Kismet._config = _config;
                setConsentDefaults(_config.countryCode || '');
                resolveSession(_config.countryCode || '');
                window.Kismet._kidSid = _kidSid;
                injectVerificationMeta(_config.verificationToken);
                loadGtag(_config.googleTagId);
                loadGa4(_config.ga4MeasurementId);
                if (shouldSetCookies(_config.countryCode || ''))
                    loadMetaPixel(_config.metaPixelId);
                if (shouldSetCookies(_config.countryCode || ''))
                    loadOpenAiPixel(_config.openaiPixelId);
                if (_config.entityId)
                    sendInstallPing(_config.entityId);
                sendPageView();
                startElementEventBridge();
                startLeadFormStamping();
                whenBody(function () {
                    captureConfirmationFromUrl();
                    scanConfirmationInDom();
                    startGuestyInlineDetector();
                    startGuestyRedirectDetector();
                    startHomerunnerQuoteCapture();
                    startHomerunnerIdentifyCapture();
                    setTimeout(scanConfirmationInDom, 800);
                    setTimeout(scanConfirmationInDom, 2500);
                });
            };
            xhr.onerror = retryOrFallback;
            xhr.ontimeout = retryOrFallback;
            xhr.send();
        }
        catch (e) {
            retryOrFallback();
        }
    }
    var _configAttempts = 0;
    function retryOrFallback() {
        if (!analyticsAllowed())
            return;
        if (_configAttempts < 2) {
            setTimeout(bootstrap, 4000);
        }
        else {
            fallback();
        }
    }
    var _lastSpaPath = location.pathname;
    function onSpaRouteChange() {
        if (!analyticsAllowed())
            return;
        if (location.pathname === _lastSpaPath)
            return;
        _lastSpaPath = location.pathname;
        sendPageView();
    }
    try {
        var _origPush = history.pushState;
        history.pushState = function () {
            var r = _origPush.apply(this, arguments);
            try {
                onSpaRouteChange();
            }
            catch (e) { }
            return r;
        };
        var _origReplace = history.replaceState;
        history.replaceState = function () {
            var r = _origReplace.apply(this, arguments);
            try {
                onSpaRouteChange();
            }
            catch (e) { }
            return r;
        };
        window.addEventListener('popstate', function () {
            if (!analyticsAllowed())
                return;
            try {
                onSpaRouteChange();
            }
            catch (e) { }
        });
    }
    catch (e) { }
    function fallback() {
        if (!analyticsAllowed())
            return;
        resolveSession('');
        window.Kismet._kidSid = _kidSid;
        sendPageView();
        startElementEventBridge();
        startLeadFormStamping();
    }
    var consentStarted = false;
function startWithConsent() {
  setConsentDefaults();
  if (!consentStarted && analyticsAllowed()) { consentStarted = true; bootstrap(); }
}
window.KismetConsent.subscribe(startWithConsent);
startWithConsent();
})();
