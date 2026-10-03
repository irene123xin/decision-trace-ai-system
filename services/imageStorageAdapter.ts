const DATABASE_NAME = "decision-trace-image-store-v1";
const STORE_NAME = "generated-images";

function openDatabase(): Promise<IDBDatabase> {
  if (typeof indexedDB === "undefined") return Promise.reject(new Error("Image storage is unavailable"));
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE_NAME, 1);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE_NAME)) request.result.createObjectStore(STORE_NAME);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(new Error("Image storage could not be opened"));
  });
}

export async function saveGeneratedImageBlobs(items: { storageReference: string; blob: Blob }[]): Promise<void> {
  const database = await openDatabase();
  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = database.transaction(STORE_NAME, "readwrite");
      const store = transaction.objectStore(STORE_NAME);
      items.forEach((item) => store.put(item.blob, item.storageReference));
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(new Error("Image storage failed"));
      transaction.onabort = () => reject(new Error("Image storage was interrupted"));
    });
  } finally {
    database.close();
  }
}

export async function readGeneratedImageBlob(storageReference: string): Promise<Blob | null> {
  const database = await openDatabase();
  try {
    return await new Promise((resolve, reject) => {
      const request = database.transaction(STORE_NAME, "readonly").objectStore(STORE_NAME).get(storageReference);
      request.onsuccess = () => resolve(request.result instanceof Blob ? request.result : null);
      request.onerror = () => reject(new Error("Image could not be read"));
    });
  } finally {
    database.close();
  }
}

export async function clearGeneratedImageBlobs(): Promise<void> {
  if (typeof indexedDB === "undefined") return;
  const database = await openDatabase();
  try {
    await new Promise<void>((resolve, reject) => {
      const request = database.transaction(STORE_NAME, "readwrite").objectStore(STORE_NAME).clear();
      request.onsuccess = () => resolve();
      request.onerror = () => reject(new Error("Image storage could not be cleared"));
    });
  } finally {
    database.close();
  }
}
