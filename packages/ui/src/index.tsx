export * from 'tamagui'
export * from '@tamagui/toast'

// Theme config, tokens, and toast config (re-exported so screens import one place).
export * from '@perduraflow/config'

// Typography system (permanent template fixtures).
export * from './typography'
export * from './TextLink'

// Shared components — variant-driven, library-ready (UI-ARCHITECTURE.md §0.2).
export * from './Screen'
export * from './AppButton'
export * from './IconButton'
export * from './AppInput'
export * from './AppSelect'
export * from './AppAvatar'
export * from './OrgAvatar'
export * from './UserAvatar'
export * from './Tooltip'
export * from './NotificationBell'
export * from './AppSwitch'
export * from './OtpInput'
export * from './EmptyState'
export * from './GradientScreen'
export * from './AppToast'
export * from './AppToastViewport'

// Admin / data components (PerduraFlow phase 0) — variant-driven, library-safe.
export * from './PageHeader'
export * from './StatusPill'
export * from './FormField'
export * from './SelectField'
export * from './DataTable'
export * from './ConfirmDialog'
export * from './Popup'
export * from './SidebarNav'
export * from './OperationsEditor'
export * from './QualificationMatrix'
export * from './ScheduleGantt'
export * from './SegmentedControl'
export * from './DatePicker'
export * from './DateRangeNav'
export * from './WeekdayPicker'
export * from './KpiTile'
export * from './MetricBars'
export * from './VarianceStrip'
export * from './LearnedParamPanel'
export * from './ResourceWearPanel'
export * from './ConfidenceRing'
export * from './CoverageProposal'
export * from './BarDetailSheet'
export * from './ExceptionRow'
export * from './Panel'
export * from './ContextSelectors'
export * from './FactorBar'
export * from './RationaleView'
export * from './NarrationBlock'
export * from './OptionCard'
export * from './BaselineDeltaStrip'
export * from './ChatRichText'

// type augmentation for tamagui custom config
import type { Conf } from '@perduraflow/config'
declare module 'tamagui' {
  interface TamaguiCustomConfig extends Conf {}
}
