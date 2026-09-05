import { QueryClientProvider } from "@tanstack/react-query";
import { Stack } from "expo-router";
import { useFonts } from "expo-font";
import { StatusBar } from "expo-status-bar";
import { useEffect } from "react";
import { LogBox, Platform, View } from "react-native";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { KeyboardProvider } from "react-native-keyboard-controller";
import { SafeAreaProvider } from "react-native-safe-area-context";

import { ErrorBoundary } from "@/src/components/error-boundary";
import { AlarmOverlay } from "@/src/components/AlarmOverlay";
import { queryClient } from "@/src/query-client";
import { useTheme } from "@/src/theme";

LogBox.ignoreAllLogs(true);

// Best-effort local-notification handler (native only).
if (Platform.OS !== "web") {
  import("expo-notifications")
    .then((N) => {
      N.setNotificationHandler({
        handleNotification: async () => ({
          shouldShowBanner: true,
          shouldShowList: true,
          shouldPlaySound: true,
          shouldSetBadge: false,
        }),
      });
    })
    .catch(() => {});
}

export default function RootLayout() {
  const { colors } = useTheme();
  const [loaded, error] = useFonts({
    "BarlowCondensed-Medium": require("../assets/fonts/BarlowCondensed-Medium.ttf"),
    "BarlowCondensed-SemiBold": require("../assets/fonts/BarlowCondensed-SemiBold.ttf"),
    "BarlowCondensed-Bold": require("../assets/fonts/BarlowCondensed-Bold.ttf"),
    "IBMPlexSans-Regular": require("../assets/fonts/IBMPlexSans-Regular.ttf"),
    "IBMPlexSans-Medium": require("../assets/fonts/IBMPlexSans-Medium.ttf"),
    "IBMPlexSans-SemiBold": require("../assets/fonts/IBMPlexSans-SemiBold.ttf"),
    "IBMPlexSans-Bold": require("../assets/fonts/IBMPlexSans-Bold.ttf"),
  });

  useEffect(() => {
    if (Platform.OS === "web") {
      import("@/src/utils/push").then((m) => {
        m.injectPwaMeta();
        m.registerSW();
      });
      // Browsers block audio until the user interacts — resume the alarm engine
      // on the first gesture so alarms can sound loudly later.
      const unlock = () => {
        import("@/src/utils/sound").then((m) => m.unlockAudio());
      };
      window.addEventListener("pointerdown", unlock);
      window.addEventListener("keydown", unlock);
      window.addEventListener("touchstart", unlock);
      return () => {
        window.removeEventListener("pointerdown", unlock);
        window.removeEventListener("keydown", unlock);
        window.removeEventListener("touchstart", unlock);
      };
    }
    import("expo-notifications")
      .then((N) => N.requestPermissionsAsync())
      .catch(() => {});
  }, []);

  if (!loaded && !error) {
    return <View style={{ flex: 1, backgroundColor: colors.surface }} />;
  }

  return (
    <ErrorBoundary>
      <GestureHandlerRootView style={{ flex: 1 }}>
        <SafeAreaProvider>
          <KeyboardProvider>
            <QueryClientProvider client={queryClient}>
              <StatusBar style="light" />
              <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.surface } }} />
              <AlarmOverlay />
            </QueryClientProvider>
          </KeyboardProvider>
        </SafeAreaProvider>
      </GestureHandlerRootView>
    </ErrorBoundary>
  );
}
