import { Redirect } from "expo-router";
import { Platform, useWindowDimensions } from "react-native";

// Responsive entry: a wide screen (a PC browser) opens the desktop control
// centre; a phone-sized screen (or any native device) opens the mobile
// companion.
export default function Index() {
  const { width } = useWindowDimensions();
  const isDesktop = Platform.OS === "web" && width >= 900;
  return <Redirect href={isDesktop ? "/dashboard" : "/(tabs)/home"} />;
}
