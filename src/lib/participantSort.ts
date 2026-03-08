type ParticipantLike = {
  id: string;
  name: string;
};

export function compareParticipantDisplayName(
  left: ParticipantLike,
  right: ParticipantLike
) {
  const byName = left.name.localeCompare(right.name, "zh-Hant", {
    numeric: true,
    sensitivity: "base",
  });
  if (byName !== 0) return byName;
  return left.id.localeCompare(right.id);
}
