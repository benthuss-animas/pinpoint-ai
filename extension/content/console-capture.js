// Runs in the page's MAIN world (declared in manifest with "world": "MAIN").
// Captures console errors into window.__ppErrors for Pinpoint to read at pick time.
(function () {
  if (window.__ppErrors) return;
  window.__ppErrors = [];
  var MAX = 50;

  function serialize(a) {
    try { return typeof a === 'object' && a !== null ? JSON.stringify(a) : String(a); }
    catch (e) { return '[unserializable]'; }
  }

  function push(level, args) {
    var arr = [].slice.call(args);
    var msg;
    // Resolve printf-style format strings (%s, %d, %o) so stored text is readable
    if (arr.length > 1 && typeof arr[0] === 'string' && /%(s|d|i|o|O|f)/.test(arr[0])) {
      var i = 1;
      msg = arr[0].replace(/%(s|d|i|o|O|f)/g, function (_, spec) {
        if (i >= arr.length) return '%' + spec;
        var val = arr[i++];
        return (spec === 'd' || spec === 'i') ? parseInt(val, 10)
             : (spec === 'f') ? parseFloat(val)
             : serialize(val);
      });
      // Append any remaining args
      while (i < arr.length) msg += ' ' + serialize(arr[i++]);
    } else {
      msg = arr.map(serialize).join(' ');
    }
    window.__ppErrors.push({ level: level, msg: msg, ts: Date.now() });
    if (window.__ppErrors.length > MAX) window.__ppErrors.shift();
  }

  var _error = console.error.bind(console);
  console.error = function () { push('error', arguments); _error.apply(console, arguments); };
  var _warn = console.warn.bind(console);
  console.warn = function () { push('warn', arguments); _warn.apply(console, arguments); };

  window.addEventListener('error', function (e) {
    push('uncaught', [e.message, e.filename ? '(' + e.filename + ':' + e.lineno + ')' : '']);
  });
  window.addEventListener('unhandledrejection', function (e) {
    push('unhandledrejection', [String(e.reason)]);
  });

  // Respond to read requests from the isolated-world content script
  window.addEventListener('pp-read-errors', function () {
    window.dispatchEvent(new CustomEvent('pp-errors-data', {
      detail: JSON.stringify(window.__ppErrors),
    }));
  });
})();
