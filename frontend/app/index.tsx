import { Redirect } from "expo-router";
import { Platform } from "react-native";

// Entry: the web link shows the landing page (to show people); native devices
// go straight into the phone companion.
export default function Index() {
  if (Platform.OS === "web") return <Redirect href="/landing" />;
  return <Redirect href="/(tabs)/home" />;
}
