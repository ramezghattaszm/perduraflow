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
  useConsumeSeededResultId,
  useCopilotConversationId,
  useCopilotDraft,
  useCopilotDraftNonce,
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
  const draftNonce = useCopilotDraftNonce()
  const consumeDraft = useConsumeCopilotDraft()
  const consumeSeededResultId = useConsumeSeededResultId()
  const [input, setInput] = useState('')

  const { data: conversations = [] } = useConversations()
  const { data: detail } = useConversation(conversationId ?? undefined)
  const create = useCreateConversation()
  const addTurn = useAddTurn(conversationId ?? undefined)
  // Local in-flight flag for the ONE active turn — set on send, cleared in onSettled (success OR error).
  // Deriving "Thinking" from the raw mutation `isPending` was fragile: `addTurn` is RE-BOUND whenever the
  // active conversationId changes (create → setConversation), so a settled/orphaned observer could leave
  // `isPending` wedged true and the spinner stuck FOREVER — even though the request returned 201 and no
  // request is pending (the exact reported bug). A single local flag always reflects reality.
  const [sending, setSending] = useState(false)
  // Survives the StrictMode (dev) mount→unmount→mount: state updates only on the live instance.
  const mountedRef = useRef(true)
  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
    }
  }, [])

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

  // Core send — used by the composer AND by the auto-run of a seeded "Evaluate options" prompt.
  // Reads screen context imperatively at send time (no stale-selection race) and anchors the first turn
  // to a pre-computed what-if result when one was seeded (the deterministic root-matched set).
  //
  // Uses `mutateAsync` (not `mutate` + per-call callbacks) ON PURPOSE: the auto-run fires during the
  // panel's initial mount, exactly when React StrictMode (dev) does its mount→unmount→remount. React
  // Query DROPS the per-call onSuccess/onSettled when the observer is torn down between mutate() and the
  // response — which orphaned setConversation + the spinner-clear and wedged "Thinking" forever. The
  // awaited promise survives the teardown; a mounted-ref keeps the state writes on the live instance.
  const sendMessage = async (raw: string) => {
    const message = raw.trim()
    if (!message || !plantId || sending) return
    const seeded = consumeSeededResultId()
    const base = getScreenContext()
    const screenContext = seeded ? { ...(base ?? { screen: 'copilot' }), activeResultId: seeded } : (base ?? undefined)
    setSending(true)
    try {
      if (conversationId) {
        await addTurn.mutateAsync({ message, screenContext })
      } else {
        const d = await create.mutateAsync({ plantId, message, screenContext })
        if (mountedRef.current) setConversation(d.conversation.id)
      }
    } catch {
      // Error state is surfaced via the mutation/query layer; nothing to recover here.
    } finally {
      if (mountedRef.current) setSending(false)
    }
  }

  const send = () => {
    if (!input.trim() || !plantId || sending) return
    const message = input
    setInput('') // clear the composer immediately on a typed send
    sendMessage(message)
  }

  // A screen opened the Copilot with a pre-seeded remediation question ("Evaluate options") — RUN it
  // immediately rather than parking it in the composer, so the answer streams in and the field stays
  // clear. Waits for plantId; sets didInit so the seeded turn isn't lost to recent-thread auto-load.
  // Keyed on `draftNonce` (bumped once per openCopilotWith) so each open sends EXACTLY ONCE — the old
  // draft-STRING guard double-fired (the same order's prompt is identical, and clearing the draft reset
  // the guard, so the seeded turn re-sent as a second turn → the "Thinking that never settles" bug).
  // If a turn is in flight (`sending`), we wait and send once it clears — never two turns for one open.
  const sentNonce = useRef(0)
  useEffect(() => {
    if (!draft || !plantId || sending) return
    if (sentNonce.current === draftNonce) return
    sentNonce.current = draftNonce
    consumeDraft()
    didInit.current = true
    sendMessage(draft)
    // sendMessage uses the current render's closure; deps cover the values it reads.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draft, draftNonce, plantId, sending, conversationId, consumeDraft])

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
        {turns.length === 0 && !sending ? (
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
        {sending ? (
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
            loading={sending}
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
