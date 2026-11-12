const CACHE_NAME = "scorekeeper-v9";
const CHARACTER_MODELS = [
  "male-a", "male-b", "male-c", "male-d", "male-e", "male-f",
  "female-b", "female-c", "female-d", "female-e", "female-f"
].map((name) => `./assets/characters/character-${name}.glb`);
const APP_SHELL = [
  "./",
  "./index.html",
  "./style.css",
  "./app.js",
  "./cafe-scene.js",
  "./vendor/three.module.min.js",
  "./vendor/jsm/loaders/GLTFLoader.js",
  "./vendor/jsm/utils/BufferGeometryUtils.js",
  "./vendor/jsm/utils/SkeletonUtils.js",
  "./assets/characters/Textures/colormap.png",
  ...CHARACTER_MODELS,
  "./manifest.json",
  "./icons/logo.png"
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL))
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((key) => key !== CACHE_NAME)
          .map((key) => caches.delete(key))
      )
    )
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);

  // Only handle same-origin GET requests; let Google Fonts and any other
  // cross-origin traffic go straight to the network untouched.
  if (event.request.method !== "GET" || url.origin !== self.location.origin) {
    return;
  }

  event.respondWith(
    caches.match(event.request).then((cached) => {
      if (cached) return cached;
      return fetch(event.request).then((response) => {
        if (response.ok) {
          const clone = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
        }
        return response;
      });
    })
  );
});
