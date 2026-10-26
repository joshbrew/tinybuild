document.body.innerHTML =
  "<h1>Offline-capable HTML</h1><p>Load this page once, then try offline mode.</p>";
if ("serviceWorker" in navigator && location.protocol !== "file:")
  navigator.serviceWorker
    .register("/service-worker.js", { scope: "/" })
    .catch(console.error);
