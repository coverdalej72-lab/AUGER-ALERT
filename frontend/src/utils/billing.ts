import { storage } from "@/src/utils/storage";

const KEY = "billing_email";

export async function getBillingEmail(): Promise<string> {
  return (await storage.getItem<string>(KEY, "")) || "";
}

export async function setBillingEmail(email: string): Promise<void> {
  await storage.setItem(KEY, email.trim().toLowerCase());
}
