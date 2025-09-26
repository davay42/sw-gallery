const DB_NAME = 'ImageGallery';
const STORE_NAME = 'images';

const getApiBase = () => {
    const scope = self.registration.scope;
    return new URL('.', scope).href.slice(0, -1);
};


self.addEventListener('install', () => {
    self.skipWaiting();
});

self.addEventListener('activate', () => {
    self.clients.claim();
});

self.addEventListener('fetch', (event) => {
    const url = new URL(event.request.url);

    const scope = new URL(self.registration.scope);
    // Check if the request URL is under our scope
    if (url.origin === scope.origin && url.pathname.startsWith(scope.pathname)) {
        const relativePath = url.pathname.slice(scope.pathname.length);

        // Only handle our specific API routes and image serving
        if (relativePath === 'list.json' ||
            relativePath === 'upload' ||
            relativePath === 'upload-url' ||
            relativePath === 'api' ||
            relativePath.startsWith('delete/') ||
            relativePath.startsWith('get/')) {
            event.respondWith(handleRequest(event.request, url, relativePath));
        }
    }
});

async function handleRequest(request, url, relativePath) {
    const method = request.method;

    // Route: GET list.json - Get all images metadata
    if (method === 'GET' && relativePath === 'list.json') {
        return handleListImages();
    }

    // Route: POST upload - Store new image
    if (method === 'POST' && relativePath === 'upload') {
        return handleUploadImage(request);
    }

    // Route: POST upload-url - Download and store image from URL
    if (method === 'POST' && relativePath === 'upload-url') {
        return handleUploadFromUrl(request);
    }

    // Route: DELETE delete/{filename} - Delete image
    if (method === 'DELETE' && relativePath.startsWith('delete/')) {
        const filename = decodeURIComponent(relativePath.substring(7));
        return handleDeleteImage(filename);
    }

    if (method === 'GET' && relativePath.startsWith('get/')) {
        const filename = decodeURIComponent(relativePath.substring(4));
        return handleServeImage(filename);
    }

    // Route: GET /api - Basic info
    if (method === 'GET' && path === '/api') {
        return new Response(JSON.stringify({
            service: 'Local Image Gallery API',
            endpoints: [
                'GET /list.json - List all images',
                'POST /upload - Upload image (multipart/form-data)',
                'POST /upload-url - Upload from URL (JSON: {url, filename?})',
                'DELETE /delete/{filename} - Delete image',
                'GET /get/{filename} - Serve image file'
            ]
        }), {
            headers: { 'Content-Type': 'application/json' }
        });
    }

    return new Response('Not Found', { status: 404 });
}

// Handle GET /list.json
async function handleListImages() {
    try {
        const db = await openDB();
        const images = await getAllImages(db);

        const imageList = images.map(img => ({
            filename: img.filename,
            timestamp: img.timestamp,
            size: img.size || 0,
            type: img.type || 'image/jpeg',
            url: `${getApiBase()}/get/${img.filename}`
        }));

        return new Response(JSON.stringify(imageList), {
            headers: {
                'Content-Type': 'application/json',
                'Access-Control-Allow-Origin': '*'
            }
        });
    } catch (error) {
        return new Response(JSON.stringify({ error: error.message }), {
            status: 500,
            headers: { 'Content-Type': 'application/json' }
        });
    }
}

// Handle POST /upload
async function handleUploadImage(request) {
    try {
        const formData = await request.formData();
        const files = formData.getAll('images');
        const results = [];

        const db = await openDB();

        for (const file of files) {
            if (file instanceof File) {
                const filename = generateUniqueFilename(file.name);
                await storeImage(db, filename, file);
                results.push({
                    filename,
                    size: file.size,
                    type: file.type,
                    url: `${API_BASE}/get/${filename}`
                });
            }
        }

        return new Response(JSON.stringify({
            success: true,
            uploaded: results
        }), {
            headers: {
                'Content-Type': 'application/json',
                'Access-Control-Allow-Origin': '*'
            }
        });
    } catch (error) {
        return new Response(JSON.stringify({
            success: false,
            error: error.message
        }), {
            status: 500,
            headers: { 'Content-Type': 'application/json' }
        });
    }
}

// Handle POST /upload-url
async function handleUploadFromUrl(request) {
    try {
        const { url, filename } = await request.json();

        if (!url) {
            return new Response(JSON.stringify({
                success: false,
                error: 'URL is required'
            }), {
                status: 400,
                headers: { 'Content-Type': 'application/json' }
            });
        }

        // Fetch the image
        const response = await fetch(url);
        if (!response.ok) {
            throw new Error(`Failed to fetch: ${response.status}`);
        }

        const blob = await response.blob();
        const finalFilename = filename || extractFilenameFromUrl(url) || `image-${Date.now()}.jpg`;
        const uniqueFilename = generateUniqueFilename(finalFilename);

        // Store in database
        const db = await openDB();
        await storeImage(db, uniqueFilename, blob);

        return new Response(JSON.stringify({
            success: true,
            filename: uniqueFilename,
            size: blob.size,
            type: blob.type,
            url: `${API_BASE}/get/${uniqueFilename}`
        }), {
            headers: {
                'Content-Type': 'application/json',
                'Access-Control-Allow-Origin': '*'
            }
        });
    } catch (error) {
        return new Response(JSON.stringify({
            success: false,
            error: error.message
        }), {
            status: 500,
            headers: { 'Content-Type': 'application/json' }
        });
    }
}

// Handle DELETE /delete/{filename}
async function handleDeleteImage(filename) {
    try {
        const db = await openDB();
        await deleteImage(db, filename);

        return new Response(JSON.stringify({
            success: true,
            message: `Image ${filename} deleted`
        }), {
            headers: {
                'Content-Type': 'application/json',
                'Access-Control-Allow-Origin': '*'
            }
        });
    } catch (error) {
        return new Response(JSON.stringify({
            success: false,
            error: error.message
        }), {
            status: 500,
            headers: { 'Content-Type': 'application/json' }
        });
    }
}

// Handle GET /{filename} - Serve image
async function handleServeImage(filename) {
    try {
        const db = await openDB();
        const imageData = await getImage(db, filename);

        if (!imageData) {
            return new Response('Image not found', {
                status: 404,
                statusText: 'Not Found'
            });
        }

        const contentType = getContentType(filename);

        return new Response(imageData.blob, {
            status: 200,
            headers: {
                'Content-Type': contentType,
                'Cache-Control': 'public, max-age=31536000',
                'Access-Control-Allow-Origin': '*'
            }
        });
    } catch (error) {
        return new Response('Server Error', {
            status: 500,
            statusText: 'Internal Server Error'
        });
    }
}

// Database operations
function openDB() {
    return new Promise((resolve, reject) => {
        const request = indexedDB.open(DB_NAME, 1);
        request.onerror = () => reject(request.error);
        request.onsuccess = () => resolve(request.result);
        request.onupgradeneeded = (e) => {
            const db = e.target.result;
            if (!db.objectStoreNames.contains(STORE_NAME)) {
                db.createObjectStore(STORE_NAME, { keyPath: 'filename' });
            }
        };
    });
}

function storeImage(db, filename, blob) {
    return new Promise((resolve, reject) => {
        const transaction = db.transaction([STORE_NAME], 'readwrite');
        const store = transaction.objectStore(STORE_NAME);

        const imageData = {
            filename,
            blob,
            timestamp: Date.now(),
            size: blob.size,
            type: blob.type || 'image/jpeg'
        };

        const request = store.put(imageData);
        request.onsuccess = () => resolve();
        request.onerror = () => reject(request.error);
    });
}

function getImage(db, filename) {
    return new Promise((resolve, reject) => {
        const transaction = db.transaction([STORE_NAME], 'readonly');
        const store = transaction.objectStore(STORE_NAME);
        const request = store.get(filename);

        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
    });
}

function getAllImages(db) {
    return new Promise((resolve, reject) => {
        const transaction = db.transaction([STORE_NAME], 'readonly');
        const store = transaction.objectStore(STORE_NAME);
        const request = store.getAll();

        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
    });
}

function deleteImage(db, filename) {
    return new Promise((resolve, reject) => {
        const transaction = db.transaction([STORE_NAME], 'readwrite');
        const store = transaction.objectStore(STORE_NAME);
        const request = store.delete(filename);

        request.onsuccess = () => resolve();
        request.onerror = () => reject(request.error);
    });
}

function generateUniqueFilename(originalName) {
    const timestamp = Date.now();
    const random = Math.random().toString(36).substring(2, 8);
    const ext = originalName.split('.').pop();
    const nameWithoutExt = originalName.replace(/\.[^/.]+$/, "");
    return `${timestamp}-${random}-${nameWithoutExt}.${ext}`;
}

function extractFilenameFromUrl(url) {
    try {
        const urlObj = new URL(url);
        const pathname = urlObj.pathname;
        return pathname.split('/').pop();
    } catch {
        return null;
    }
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
        bmp: 'image/bmp',
        avif: 'image/avif',
        tiff: 'image/tiff'
    };
    return types[ext] || 'image/jpeg';
}