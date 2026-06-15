import { ScrollView } from 'tamagui'
import { Screen } from '@perduraflow/ui'
import { BoardContent } from '@perduraflow/app/features/scheduling/board/board-screen'

/**
 * Native schedule board route (iPad first-class, FS9). The Expo Stack is the
 * chrome here, so it renders the shell-agnostic BoardContent directly (no web
 * AdminShell). The ScheduleGantt is react-native-svg, so it renders natively.
 */
export default function BoardRoute() {
  return (
    <Screen>
      <ScrollView contentContainerStyle={{ padding: 16, gap: 16 }}>
        <BoardContent />
      </ScrollView>
    </Screen>
  )
}
