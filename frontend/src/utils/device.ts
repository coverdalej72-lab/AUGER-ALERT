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

export async function getDeviceId(): Promise<string> {
  const existing = await storage.getItem<string>(KEY, "");
  if (existing) return existing;
  const id = `dev_${rand()}`;
  await storage.setItem(KEY, id);
  return id;
}

export async function getDeviceName(): Promise<string> {
  return (await storage.getItem<string>(NAME_KEY, "")) || "My Phone";
}

export async function setDeviceName(name: string): Promise<void> {
  await storage.setItem(NAME_KEY, name);
}
