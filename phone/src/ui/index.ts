// Phone design system. Import from "@phone/ui" in every area; don't build one-off buttons, sheets or bars.
export { Button, LinkButton, IconButton, buttonClass } from "./Button";
export type { ButtonProps, ButtonVariant } from "./Button";
export { Card, LinkCard, ActionCard, Section } from "./Card";
export { Chip, ChipGroup } from "./Chip";
export { ProgressBar } from "./ProgressBar";
export { ToastProvider, useToast, StatusMessage, LoadingState } from "./Toast";
export { BottomSheet, useBackToClose } from "./BottomSheet";
export { ActionBar } from "./ActionBar";
export { AnswerButton, AnswerList } from "./AnswerButton";
export type { AnswerState } from "./AnswerButton";
export { TextField } from "./TextField";
export { AreaPlaceholder } from "./AreaPlaceholder";
export { useViewportHeight, useViewportCssVars } from "./useViewportHeight";
export type { ViewportState } from "./useViewportHeight";
export { useHaptics } from "./useHaptics";
export type { Haptics } from "./useHaptics";
// Game feel: haptics + sound, motion, chunky game components.
export { feel, useFeel, feelPattern, feelPatterns, feelNotes, streakPattern, isStreakMilestone, resetFeelCooldowns } from "./feel";
export type { Feel, FeelKind, FeelOptions } from "./feel";
export { useReducedMotion, useCountUp, useReplayKey, Burst } from "./motion";
export { GameButton, LinkGameButton, gameButtonClass } from "./GameButton";
export type { GameButtonProps, GameButtonVariant } from "./GameButton";
export {
  ResultHero,
  ScoreReveal,
  XpBar,
  StreakMeter,
  ComboToast,
  TimerBar,
  RetryMissedCard,
  StatGrid,
  StatTile,
  GoalCard,
  SegmentedControl,
  ModeHero,
  MoreLink,
  medalTier,
  tierStars,
  formatDuration,
  XP_PER_LEVEL,
} from "./game";
export type { MedalTier, ResultHeroProps, SegmentOption } from "./game";
