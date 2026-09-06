import { View } from "react-native";
import type { Summary } from "@cliphy/shared";
import { splitColumns } from "@cliphy/shared";
import { ClipCard } from "./ClipCard";

export function MasonryFeed({ items }: { items: Summary[] }) {
  const [colA, colB] = splitColumns(items);
  return (
    <View className="flex-row gap-3 px-4 py-4">
      <View className="flex-1 gap-3">
        {colA.map((c) => (
          <ClipCard key={c.id} item={c} />
        ))}
      </View>
      <View className="flex-1 gap-3">
        {colB.map((c) => (
          <ClipCard key={c.id} item={c} />
        ))}
      </View>
    </View>
  );
}
