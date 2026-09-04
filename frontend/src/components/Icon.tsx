import MDI from "@react-native-vector-icons/material-design-icons";

type Props = {
  name: string;
  size?: number;
  color: string;
  style?: any;
};

// Thin wrapper so screens don't fight the strict icon-name union.
export function Icon({ name, size = 20, color, style }: Props) {
  const Comp = MDI as any;
  return <Comp name={name} size={size} color={color} style={style} />;
}
