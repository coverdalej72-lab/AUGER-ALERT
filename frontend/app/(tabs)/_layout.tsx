import { Tabs } from "expo-router";
import { Platform } from "react-native";

import { Icon } from "@/src/components/Icon";
import { fonts, useTheme } from "@/src/theme";

export default function TabsLayout() {
  const { colors } = useTheme();
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: colors.brandPrimary,
        tabBarInactiveTintColor: colors.muted,
        tabBarStyle: {
          backgroundColor: colors.surfaceSecondary,
          borderTopColor: colors.border,
          borderTopWidth: 1,
          ...(Platform.OS === "web" ? { height: 64 } : {}),
        },
        tabBarItemStyle: { alignSelf: "center" },
        tabBarLabelStyle: { fontFamily: fonts.textSemiBold, fontSize: 11 },
      }}
    >
      <Tabs.Screen
        name="home"
        options={{
          title: "Schedule",
          tabBarIcon: ({ color, size }) => <Icon name="clock-outline" size={size} color={color} />,
        }}
      />
      <Tabs.Screen
        name="log"
        options={{
          title: "Log",
          tabBarIcon: ({ color, size }) => <Icon name="history" size={size} color={color} />,
        }}
      />
      <Tabs.Screen
        name="settings"
        options={{
          title: "Settings",
          tabBarIcon: ({ color, size }) => <Icon name="cog-outline" size={size} color={color} />,
        }}
      />
    </Tabs>
  );
}
