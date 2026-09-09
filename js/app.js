/* KM Logbook - bootstrap */
window.KMS = window.KMS || {};
KMS.APP_VERSION = '1.0.0';

document.addEventListener('DOMContentLoaded', function () {
  try {
    KMS.ui.init();
  } catch (e) {
    console.error(e);
    document.body.insertAdjacentHTML('afterbegin',
      '<pre style="color:#b91c1c;padding:12px;white-space:pre-wrap">Startup error: ' + (e && e.message) + '</pre>');
  }
});

if ('serviceWorker' in navigator) {
  window.addEventListener('load', function () {
    navigator.serviceWorker.register('sw.js').catch(function (e) {
      console.warn('SW registration failed', e);
    });
  });
}
