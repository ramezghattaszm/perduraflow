'use client'

import { useEffect, useRef, useState } from 'react'
import { X } from '@tamagui/lucide-icons'
import type { ConversationTurnDto } from '@perduraflow/contracts'
import {
  AppButton,
  AppInput,
  ChatRichText,
  H,
  IconButton,
  P,
  ScrollView,
  Spinner,
  WhatIfComparison,
  XStack,
  YStack,
} from '@perduraflow/ui'
import { resolveKey, useTranslation } from '../../i18n'
import { usePlants } from '../../hooks/useOrg'
import { usePlantSelection } from '../../hooks/usePlantSelection'
import {
  useAddTurn,
  useConversation,
  useConversations,
  useCreateConversation,
} from '../../hooks/useConversation'
import { useWhatIfResult } from '../../hooks/useWhatIf'
import {
  useConsumeCopilotDraft,
  useCopilotConversationId,
  useCopilotDraft,
  useSetCopilotConversation,
} from '../../stores/copilot.store'
import { getScreenContext } from '../../stores/screenContext.store'
import { WhatIfOptionSet } from '../whatif/whatif-option-set'

/**
 * Copilot panel content (phase 6) — the slide-over conversation. Context-aware
 * (scoped to the current plant), it loads the most recent thread on open and keeps
 * it across navigation (state in the copilot store). Assistant prose renders as
 * **markdown** (`ChatRichText`, web+native); a Type-2 answer's option-set renders
 * **inline, attached to the turn that generated it** (not a permanent panel). The
 * conversation constructs + explains — Apply on a result goes through the existing
 * board guardrail (D26).
 */
export function CopilotPanel({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation(['conversation'])
  const { data: plants = [] } = usePlants()
  const { plantId } = usePlantSelection(plants)
  const conversationId = useCopilotConversationId()
  const setConversation = useSetCopilotConversation()
  const draft = useCopilotDraft()
  const consumeDraft = useConsumeCopilotDraft()
  const [input, setInput] = useState('')

  // A screen opened the Copilot with a pre-seeded question (e.g. "Evaluate options" on an at-risk
  // row) — load it into the composer once so the planner can review and send (we never auto-send).
  useEffect(() => {
    if (draft) {
      setInput(draft)
      consumeDraft()
    }
  }, [draft, consumeDraft])

  const { data: conversations = [] } = useConversations()
  const { data: detail } = useConversation(conversationId ?? undefined)
  const create = useCreateConversation()
  const addTurn = useAddTurn(conversationId ?? undefined)
  const pending = create.isPending || addTurn.isPending

  // Load the most recent thread once per open (persistence is built — don't start
  // fresh). The guard makes it fire only on open, so "New conversation" (which clears
  // the active id) isn't immediately snapped back to the recent thread.
  const didInit = useRef(false)
  useEffect(() => {
    if (didInit.current) return
    if (conversationId) {
      didInit.current = true // a persisted thread is already active — keep it
      return
    }
    if (conversations.length > 0) {
      didInit.current = true
      setConversation(conversations[0]!.id)
    }
  }, [conversationId, conversations, setConversation])

  const startNew = () => {
    didInit.current = true // opt out of auto-load so the cleared thread stays cleared
    setConversation(null)
    setInput('')
  }

  const turns = detail?.turns ?? []

  const send = () => {
    const message = input.trim()
    if (!message || !plantId || pending) return
    setInput('')
    // Read the screen context imperatively HERE (send time) so the turn carries the current
    // selection — not a value closed over at render (no stale-selection race).
    const screenContext = getScreenContext() ?? undefined
    if (conversationId) addTurn.mutate({ message, screenContext })
    else
      create.mutate(
        { plantId, message, screenContext },
        { onSuccess: (d) => setConversation(d.conversation.id) }
      )
  }

  return (
    <YStack
      flex={1}
      backgroundColor="$surface"
    >
      <XStack
        alignItems="center"
        justifyContent="space-between"
        padding="$3"
        borderBottomWidth={1}
        borderBottomColor="$borderColor"
        gap="$2"
      >
        <YStack
          flex={1}
          gap="$0.5"
        >
          <H
            level={4}
            color="$textPrimary"
            numberOfLines={1}
          >
            {detail?.conversation.name ?? t('title')}
          </H>
          <P
            size={5}
            color="$textTertiary"
          >
            {t('subtitle')}
          </P>
        </YStack>
        <XStack
          gap="$1"
          alignItems="center"
        >
          <AppButton
            variant="light"
            size="$3"
            onPress={startNew}
          >
            {t('newConversation')}
          </AppButton>
          <IconButton
            icon={X}
            label={t('common:close', { defaultValue: 'Close' })}
            onPress={onClose}
          />
        </XStack>
      </XStack>

      <ScrollView
        flex={1}
        contentContainerStyle={{ padding: 12, gap: 12 }}
      >
        {turns.length === 0 && !pending ? (
          <P
            size={4}
            color="$textTertiary"
          >
            {t('empty')}
          </P>
        ) : null}
        {turns.map((turn) => (
          <Turn
            key={turn.id}
            turn={turn}
            you={t('you')}
            assistant={t('assistant')}
            degradedLabel={t('degraded')}
          />
        ))}
        {pending ? (
          <XStack
            gap="$2"
            alignItems="center"
            alignSelf="flex-start"
            backgroundColor="$surfaceRaised"
            borderRadius="$4"
            paddingHorizontal="$3"
            paddingVertical="$2.5"
          >
            <Spinner
              size="small"
              color="$primary"
            />
            <P
              size={4}
              color="$textSecondary"
            >
              {t('thinking')}
            </P>
          </XStack>
        ) : null}
      </ScrollView>

      <YStack
        padding="$3"
        borderTopWidth={1}
        borderTopColor="$borderColor"
        gap="$2"
      >
        <XStack
          gap="$2"
          alignItems="center"
        >
          <YStack flex={1}>
            <AppInput
              value={input}
              onChangeText={setInput}
              placeholder={t('placeholder')}
              onSubmitEditing={send}
            />
          </YStack>
          <AppButton
            variant="primary"
            size="$3"
            loading={pending}
            onPress={send}
          >
            {t('send')}
          </AppButton>
        </XStack>
        {!plantId ? (
          <P
            size={5}
            color="$danger"
          >
            {t('needPlant')}
          </P>
        ) : null}
      </YStack>
    </YStack>
  )
}

/** One turn — user or markdown assistant reply, with a Type-2 result's option-set inline. */
function Turn({
  turn,
  you,
  assistant,
  degradedLabel,
}: { turn: ConversationTurnDto; you: string; assistant: string; degradedLabel: string }) {
  const isUser = turn.role === 'user'
  const degraded = turn.status === 'degraded'
  // A Type-2 evaluate OR a goal-seek both produce an appliable result → render its option-set inline.
  const generated =
    turn.resultId &&
    turn.toolCalls.some((c) => c.name === 'evaluate_what_if' || c.name === 'goal_seek')
  // A compare turn renders the structured side-by-side table (decide-support #2) for the active
  // result — figures rendered from the artifact, never the LLM's prose (render-don't-retype).
  const compared = turn.resultId && turn.toolCalls.some((c) => c.name === 'compare_options')
  return (
    <YStack
      gap="$2"
      alignSelf={isUser ? 'flex-end' : 'flex-start'}
      maxWidth="94%"
    >
      <YStack
        gap="$1"
        backgroundColor={isUser ? '$primarySoft' : degraded ? '$warningSoft' : '$surfaceRaised'}
        borderRadius="$4"
        paddingHorizontal="$3"
        paddingVertical="$2.5"
      >
        <P
          size={5}
          weight="b"
          caps
          color="$textTertiary"
        >
          {isUser ? you : assistant}
        </P>
        {isUser ? (
          <P
            size={3}
            color="$textPrimary"
          >
            {turn.content}
          </P>
        ) : (
          <ChatRichText
            content={turn.content}
            size={3}
          />
        )}
        {degraded ? (
          <P
            size={5}
            color="$warning"
          >
            {degradedLabel}
          </P>
        ) : null}
      </YStack>
      {generated ? <TurnOptionSet resultId={turn.resultId!} /> : null}
      {compared && !generated ? <TurnComparison resultId={turn.resultId!} /> : null}
    </YStack>
  )
}

/** The side-by-side comparison a compare turn renders (figures from the artifact, not the LLM). */
function TurnComparison({ resultId }: { resultId: string }) {
  const { data } = useWhatIfResult(resultId)
  if (!data) return null
  return (
    <YStack
      borderWidth={1}
      borderColor="$borderColor"
      borderRadius="$5"
      padding="$2"
    >
      <WhatIfComparison
        result={data}
        optionLabel={(o) => resolveKey(o.labelKey)}
      />
    </YStack>
  )
}

/** The option-set a Type-2 turn produced, rendered inline (Apply → board guardrail). */
function TurnOptionSet({ resultId }: { resultId: string }) {
  const { data } = useWhatIfResult(resultId)
  if (!data) return null
  return (
    <YStack
      borderWidth={1}
      borderColor="$borderColor"
      borderRadius="$5"
      padding="$2"
    >
      <WhatIfOptionSet result={data} />
    </YStack>
  )
}
