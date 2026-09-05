import { Platform } from "react-native";

/**
 * True only for actual phone/tablet browsers. A laptop/desktop with a small
 * window is still a computer and should see the full Control Centre program,
 * so we detect by device (user agent) rather than by window width.
 */
export function isPhoneWeb(): boolean {
  if (Platform.OS !== "web" || typeof navigator === "undefined") return false;
  return /Android|iPhone|iPad|iPod|Mobile|Windows Phone|BlackBerry|Opera Mini|IEMobile/i.test(
    navigator.userAgent || "",
  );
}
