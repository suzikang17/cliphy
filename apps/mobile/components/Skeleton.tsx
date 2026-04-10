import { useEffect, useRef } from "react";
import { Animated, View } from "react-native";

export function Skeleton({ className = "" }: { className?: string }) {
  const opacity = useRef(new Animated.Value(0.3)).current;

  useEffect(() => {
    const animation = Animated.loop(
      Animated.sequence([
        Animated.timing(opacity, {
          toValue: 1,
          duration: 800,
          useNativeDriver: true,
        }),
        Animated.timing(opacity, {
          toValue: 0.3,
          duration: 800,
          useNativeDriver: true,
        }),
      ]),
    );
    animation.start();
    return () => animation.stop();
  }, [opacity]);

  return (
    <Animated.View
      className={`bg-[#e5e7eb] dark:bg-[#383838] rounded ${className}`}
      style={{ opacity }}
    />
  );
}

export function QueueCardSkeleton() {
  return (
    <View className="border-2 border-black dark:border-[#505050] rounded-lg p-3 gap-2 bg-[#f9fafb] dark:bg-[#282828]">
      <Skeleton className="h-4 w-3/4" />
      <Skeleton className="h-3 w-1/2" />
      <Skeleton className="h-3 w-1/4" />
    </View>
  );
}
