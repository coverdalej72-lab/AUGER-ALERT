import { Redirect } from "expo-router";
import { Platform, useWindowDimensions } from "react-native";

// Entry:
//  - Computer (wide browser) -> the control-centre PROGRAM (/dashboard).
//  - Phone browser -> the companion app (/(tabs)/home).
//  - Native devices -> the companion app.
// The shareable landing page is still available at /landing.
export default function Index() {
  const { width } = useWindowDimensions();
  if (Platform.OS === "web") {
    return <Redirect href={width >= 900 ? "/dashboard" : "/(tabs)/home"} />;
  }
  return <Redirect href="/(tabs)/home" />;
}
