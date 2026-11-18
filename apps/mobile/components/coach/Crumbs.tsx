import { Text, View } from "react-native";
import { useRouter } from "expo-router";
import { FONT, useCoachTheme } from "./ui";

export interface Crumb {
  /** What kind of thing it leads to: "Project", "Request", "Texts". */
  kind: string;
  /** Its own name. */
  label: string;
  path: string;
}

/**
 * Where a thing belongs and what it came from, as links: the project it is
 * in, the request behind it, the person's texts. So nothing has to be looked
 * for from the top.
 */
export function Crumbs({ items }: { items: Crumb[] }) {
  const t = useCoachTheme();
  const router = useRouter();
  if (items.length === 0) return null;
  return (
    <View
      style={{ flexDirection: "row", flexWrap: "wrap", columnGap: 16, rowGap: 6, marginTop: 12 }}
    >
      {items.map((item) => (
        <Text
          key={item.path}
          onPress={() => router.push(item.path as never)}
          accessibilityRole="link"
          accessibilityLabel={`${item.kind}: ${item.label}`}
          style={{ fontFamily: FONT, fontSize: 12, color: t.muted }}
        >
          {`${item.kind} `}
          <Text style={{ fontWeight: "700", color: t.accent }}>{`${item.label} ›`}</Text>
        </Text>
      ))}
    </View>
  );
}
