// Service Worker for Local Image Gallery
const DB_NAME = 'ImageGallery';
const STORE_NAME = 'images';
const TARGET_DOMAIN = 'localhost';

self.addEventListener('install', () => {
    self.skipWaiting();
});

self.addEventListener('activate', () => {
    self.clients.claim();
});

self.addEventListener('fetch', (event) => {
    const url = new URL(event.request.url);

    // Only intercept our special URLs
    if (url.hostname === TARGET_DOMAIN && url.hash) {
        event.respondWith(handleImageRequest(url.hash.substring(1)));
    }
});

async function handleImageRequest(filename) {
    // Open IndexedDB
    const db = await new Promise((resolve, reject) => {
        const request = indexedDB.open(DB_NAME, 1);
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
    });

    // Get image from database
    const imageData = await new Promise((resolve, reject) => {
        const transaction = db.transaction([STORE_NAME], 'readonly');
        const store = transaction.objectStore(STORE_NAME);
        const request = store.get(filename);

        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
    });

    // Return 404 if image not found
    if (!imageData) {
        return new Response('Image not found', {
            status: 404,
            statusText: 'Not Found'
        });
    }

    // Determine content type
    const contentType = getContentType(filename);

    // Return the image
    return new Response(imageData.blob, {
        status: 200,
        headers: {
            'Content-Type': contentType,
            'Cache-Control': 'public, max-age=31536000',
            'Access-Control-Allow-Origin': '*'
        }
    });
}

function getContentType(filename) {
    const ext = filename.toLowerCase().split('.').pop();
    const types = {
        jpg: 'image/jpeg',
        jpeg: 'image/jpeg',
        png: 'image/png',
        gif: 'image/gif',
        webp: 'image/webp',
        svg: 'image/svg+xml',
        bmp: 'image/bmp'
    };
    return types[ext] || 'image/jpeg';
}