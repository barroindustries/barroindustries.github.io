// v13 Phase 8 — client-side error logging (ROADMAP item 16).
// Loads immediately after firebase-config.js so it can catch boot-time errors
// (before config.js/app.js exist). Must NEVER throw itself — every path is
// wrapped in try/catch, and Firestore writes always end in a silent .catch().
(function () {
  'use strict';

  var MAX_WRITES   = 5;
  var writeCount    = 0;
  var seenHashes    = {};   // dedup by message hash, once per session
  var buffered      = [];   // errors caught before `db` exists (boot errors)
  var BUFFER_CAP    = 5;

  function hashMessage(msg) {
    // Cheap, deterministic string hash — good enough for session-scoped dedup.
    var str = String(msg || '');
    var h = 0;
    for (var i = 0; i < str.length; i++) {
      h = ((h << 5) - h + str.charCodeAt(i)) | 0;
    }
    return h;
  }

  function trunc(str, max) {
    str = String(str == null ? '' : str);
    return str.length > max ? str.slice(0, max) : str;
  }

  function buildPayload(message, stack) {
    return {
      message: trunc(message, 500),
      stack: trunc(stack, 2000),
      page: (window.currentPage || 'boot'),
      version: (window.APP_VERSION || ''),
      uid: (window.currentUser && window.currentUser.uid) || null,
      ua: (navigator.userAgent || '').slice(0, 200),
      ts: window.firebase && window.firebase.firestore && window.firebase.firestore.FieldValue
        ? window.firebase.firestore.FieldValue.serverTimestamp()
        : null
    };
  }

  function writeToFirestore(payload) {
    try {
      if (!window.db || !payload.ts) return false;
      window.db.collection('error_log').add(payload).catch(function () {
        // silent — logging must never surface a secondary error
      });
      return true;
    } catch (e) {
      return false;
    }
  }

  function tryFlushBuffer() {
    if (!buffered.length) return;
    if (!window.db) return;
    try {
      var toFlush = buffered.splice(0, buffered.length);
      for (var i = 0; i < toFlush.length; i++) {
        if (writeCount >= MAX_WRITES) break;
        var ok = writeToFirestore(buildPayload(toFlush[i].message, toFlush[i].stack));
        if (ok) writeCount++;
      }
    } catch (e) {
      // never throw
    }
  }

  function record(message, stack) {
    try {
      if (writeCount >= MAX_WRITES) return;

      var key = hashMessage(message);
      if (seenHashes[key]) return;
      seenHashes[key] = true;

      if (!window.db) {
        // Too early — buffer it (capped) and try again once db shows up.
        if (buffered.length < BUFFER_CAP) {
          buffered.push({ message: message, stack: stack });
        }
        return;
      }

      var payload = buildPayload(message, stack);
      var ok = writeToFirestore(payload);
      if (ok) writeCount++;
    } catch (e) {
      // logging can never throw
    }
  }

  window.onerror = function (message, source, lineno, colno, error) {
    try {
      var stack = error && error.stack ? error.stack : (message + ' @ ' + source + ':' + lineno + ':' + colno);
      record(message, stack);
    } catch (e) { /* never throw */ }
    return false; // don't suppress default browser handling
  };

  window.onunhandledrejection = function (event) {
    try {
      var reason = event && event.reason;
      var message = (reason && reason.message) ? reason.message : String(reason);
      var stack = (reason && reason.stack) ? reason.stack : message;
      record(message, stack);
    } catch (e) { /* never throw */ }
  };

  // Manual logging hook for try/catch blocks elsewhere in the app.
  window.logClientError = function (err, context) {
    try {
      var message = (err && err.message) ? err.message : String(err);
      if (context) message = trunc(context, 100) + ': ' + message;
      var stack = (err && err.stack) ? err.stack : message;
      record(message, stack);
    } catch (e) { /* never throw */ }
  };

  // Poll briefly for `db` to appear (firebase-config.js has already loaded by
  // the time this script runs, but init is not necessarily synchronous with
  // script execution in every code path) and flush any buffered boot errors.
  var pollTries = 0;
  var pollId = setInterval(function () {
    pollTries++;
    if (window.db) {
      tryFlushBuffer();
      clearInterval(pollId);
    } else if (pollTries > 40) { // ~20s cap
      clearInterval(pollId);
    }
  }, 500);
})();
