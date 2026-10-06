import React, { useEffect, useRef } from "react";
import { View, Text, StyleSheet, Animated, Easing, Dimensions } from "react-native";

export type FloatingReaction = {
  id: string;
  emoji: string;
  fromName?: string;
};

type Props = {
  reactions: FloatingReaction[];
  onDone: (id: string) => void;
};

const { height: WIN_H } = Dimensions.get("window");

function ReactionItem({ item, onDone }: { item: FloatingReaction; onDone: (id: string) => void }) {
  const translateY = useRef(new Animated.Value(0)).current;
  const opacity = useRef(new Animated.Value(0)).current;
  const scale = useRef(new Animated.Value(0.4)).current;
  // Random horizontal drift so multiple reactions fan out instead of stacking
  const driftX = useRef(new Animated.Value(0)).current;
  const startX = useRef((Math.random() - 0.5) * 80).current;
  const endDrift = useRef((Math.random() - 0.5) * 60).current;

  useEffect(() => {
    Animated.parallel([
      Animated.sequence([
        Animated.timing(opacity, { toValue: 1, duration: 180, useNativeDriver: true }),
        Animated.delay(1300),
        Animated.timing(opacity, { toValue: 0, duration: 500, useNativeDriver: true }),
      ]),
      Animated.spring(scale, { toValue: 1, friction: 5, tension: 120, useNativeDriver: true }),
      Animated.timing(translateY, {
        toValue: -WIN_H * 0.45,
        duration: 1900,
        easing: Easing.out(Easing.quad),
        useNativeDriver: true,
      }),
      Animated.timing(driftX, {
        toValue: endDrift,
        duration: 1900,
        easing: Easing.inOut(Easing.sin),
        useNativeDriver: true,
      }),
    ]).start(() => onDone(item.id));
  }, []);

  return (
    <Animated.View
      pointerEvents="none"
      style={[
        styles.item,
        {
          opacity,
          transform: [
            { translateX: Animated.add(driftX, new Animated.Value(startX)) },
            { translateY },
            { scale },
          ],
        },
      ]}
    >
      <Text style={styles.emoji}>{item.emoji}</Text>
      {item.fromName ? <Text style={styles.from} numberOfLines={1}>{item.fromName}</Text> : null}
    </Animated.View>
  );
}

export default function FloatingReactions({ reactions, onDone }: Props) {
  return (
    <View style={styles.container} pointerEvents="none">
      {reactions.map((r) => (
        <ReactionItem key={r.id} item={r} onDone={onDone} />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 200,
    alignItems: "center",
    justifyContent: "flex-end",
    zIndex: 60,
  },
  item: {
    position: "absolute",
    alignItems: "center",
    gap: 4,
  },
  emoji: {
    fontSize: 56,
    textShadowColor: "rgba(0,0,0,0.6)",
    textShadowOffset: { width: 0, height: 4 },
    textShadowRadius: 10,
  },
  from: {
    color: "rgba(255,255,255,0.85)",
    fontSize: 11,
    fontWeight: "800",
    letterSpacing: 0.6,
    backgroundColor: "rgba(10,10,18,0.7)",
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 999,
    overflow: "hidden",
  },
});
