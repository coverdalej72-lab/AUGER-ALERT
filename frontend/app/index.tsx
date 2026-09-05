import { Redirect } from "expo-router";
import { Platform } from "react-native";

import { isPhoneWeb } from "@/src/utils/platform";

// Entry:
//  - Computer browser -> the control-centre PROGRAM (/dashboard).
//  - Phone/tablet browser -> the companion app (/(tabs)/home).
//  - Native devices -> the companion app.
// The shareable landing page is still available at /landing.
export default function Index() {
  if (Platform.OS === "web") {
    return <Redirect href={isPhoneWeb() ? "/(tabs)/home" : "/dashboard"} />;
  }
  return <Redirect href="/(tabs)/home" />;
}
