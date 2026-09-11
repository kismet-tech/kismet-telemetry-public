/* Kismet consent bridge. Load before the telemetry adapter's browser script. */
;(function () {
  'use strict'
  if (window.KismetConsent) return
  var state = { analytics: false, advertising: false }
  var ready = false,
    configured = false,
    generation = 0,
    unsubscribe = null
  var listeners = []
  function snapshot() {
    return {
      analytics: ready && state.analytics,
      advertising: ready && state.advertising,
      ready: ready,
    }
  }
  function notify() {
    listeners.slice().forEach(function (fn) {
      try {
        fn(snapshot())
      } catch (_) {}
    })
  }
  function erase(name) {
    var parts = location.hostname.split('.')
    var suffix = ';path=/;max-age=0;SameSite=Lax;Secure'
    document.cookie = name + '=' + suffix
    for (var i = 0; i < parts.length - 1; i++) {
      document.cookie =
        name + '=' + suffix + ';domain=.' + parts.slice(i).join('.')
    }
  }
  function apply(value, initial) {
    var previous = state
    state = {
      analytics: !!value && value.analytics === true,
      advertising:
        !!value && value.analytics === true && value.advertising === true,
    }
    ready = true
    if (!state.analytics) {
      ;['_kid_sid', '_kid_vid', '_kid_ft', '_kid_src'].forEach(erase)
      if (window.Kismet) {
        window.Kismet._sidSuppressed = 1
        delete window.Kismet._kidSid
      }
      document
        .querySelectorAll(
          'input[name="kismet_kid_sid"],input[data-kismet-sid],.kismet-kid-sid input'
        )
        .forEach(function (input) {
          input.value = ''
        })
      try {
        sessionStorage.removeItem('_kismet_ping_sent')
      } catch (_) {}
    }
    if (!state.advertising) {
      ;['_fbc', '_fbp'].forEach(erase)
      if (typeof window.fbq === 'function') {
        try {
          window.fbq('consent', 'revoke')
        } catch (_) {}
      }
    }
    notify()
    // Persist the banner choice BEFORE calling update/refresh. A navigation lets
    // server adapters re-read it and unloads vendor SDKs that cannot be unloaded.
    if (
      !initial &&
      (previous.analytics !== state.analytics ||
        previous.advertising !== state.advertising)
    ) {
      window.location.reload()
    }
    return snapshot()
  }
  var read = function () {
    return null
  }
  function refresh(initial) {
    var ticket = ++generation
    ready = false
    notify()
    var result
    try {
      result = read()
    } catch (_) {
      result = null
    }
    var timer
    var bounded = Promise.race([
      Promise.resolve(result),
      new Promise(function (resolve) {
        timer = setTimeout(function () {
          resolve(null)
        }, 1500)
      }),
    ])
    return bounded.then(
      function (value) {
        clearTimeout(timer)
        if (ticket !== generation) return snapshot()
        return apply(value, initial === true)
      },
      function () {
        clearTimeout(timer)
        if (ticket !== generation) return snapshot()
        return apply(null, initial === true)
      }
    )
  }
  window.KismetConsent = {
    version: '1.0.0',
    getState: snapshot,
    subscribe: function (fn) {
      if (typeof fn !== 'function')
        throw new TypeError('Consent listener must be a function')
      listeners.push(fn)
      return function () {
        listeners = listeners.filter(function (item) {
          return item !== fn
        })
      }
    },
    configure: function (options) {
      var initial = !configured
      configured = true
      if (unsubscribe) {
        try {
          unsubscribe()
        } catch (_) {}
      }
      unsubscribe = null
      read =
        options && typeof options.getConsent === 'function'
          ? options.getConsent
          : function () {
              return null
            }
      var pending = refresh(initial)
      if (options && typeof options.subscribe === 'function') {
        try {
          unsubscribe = options.subscribe(function () {
            refresh(false)
          })
        } catch (_) {
          ++generation
          apply(null, initial)
        }
      }
      return pending
    },
    refresh: function () {
      return refresh(false)
    },
    update: function (value) {
      ++generation
      return apply(value, false)
    },
  }
})()
