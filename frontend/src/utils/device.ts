import { storage } from "@/src/utils/storage";

const KEY = "device_id";
const NAME_KEY = "device_name";

function rand(): string {
  return "xxxxxxxxxxxx4xxxyxxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === "x" ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

// Cache the in-flight/resolved device_id so concurrent callers share the
// same id (fixes race where two components each generated a new id).
let deviceIdPromise: Promise<string> | null = null;

export async function getDeviceId(): Promise<string> {
  if (deviceIdPromise) return deviceIdPromise;
  deviceIdPromise = (async () => {
    const existing = await storage.getItem<string>(KEY, "");
    if (existing) return existing;
    const id = `dev_${rand()}`;
    await storage.setItem(KEY, id);
    return id;
  })();
  return deviceIdPromise;
}

export async function getDeviceName(): Promise<string> {
  return (await storage.getItem<string>(NAME_KEY, "")) || "My Phone";
}

export async function setDeviceName(name: string): Promise<void> {
  await storage.setItem(NAME_KEY, name);
}
