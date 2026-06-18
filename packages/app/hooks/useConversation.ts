import { useMutation, useQuery } from '@tanstack/react-query'
import type {
  ConversationDetailDto,
  ConversationDto,
  ConversationTurnDto,
} from '@perduraflow/contracts'
import { apiClient } from '../lib/axios'
import { queryClient } from '../lib/query-client'
import { QUERY_KEYS } from '../lib/query-keys'

const get = <T>(url: string) => apiClient.get<T>(url).then((r) => r.data)
const post = <T, B>(url: string, body: B) => apiClient.post<T>(url, body).then((r) => r.data)
const patch = <T, B>(url: string, body: B) => apiClient.patch<T>(url, body).then((r) => r.data)

/** The tenant's conversations (newest first). */
export function useConversations() {
  return useQuery({
    queryKey: QUERY_KEYS.scheduling.conversations(),
    queryFn: () => get<ConversationDto[]>('/scheduling/conversations'),
  })
}

/** A conversation + its ordered turns. */
export function useConversation(id: string | undefined) {
  return useQuery({
    queryKey: QUERY_KEYS.scheduling.conversation(id ?? ''),
    queryFn: () => get<ConversationDetailDto>(`/scheduling/conversations/${id}`),
    enabled: Boolean(id),
  })
}

/** Start a conversation with a first message (processes the first grounded turn). */
export function useCreateConversation() {
  return useMutation({
    mutationFn: (vars: { plantId: string; message: string }) =>
      post<ConversationDetailDto, typeof vars>('/scheduling/conversations', vars),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: QUERY_KEYS.scheduling.conversations() }),
  })
}

/** Add a user turn → grounded assistant reply; refreshes the conversation thread. */
export function useAddTurn(conversationId: string | undefined) {
  return useMutation({
    mutationFn: (message: string) =>
      post<ConversationTurnDto, { message: string }>(`/scheduling/conversations/${conversationId}/turns`, { message }),
    onSuccess: () => {
      if (conversationId) void queryClient.invalidateQueries({ queryKey: QUERY_KEYS.scheduling.conversation(conversationId) })
    },
  })
}

/** Rename a conversation. */
export function useRenameConversation() {
  return useMutation({
    mutationFn: (vars: { id: string; name: string }) =>
      patch<ConversationDto, { name: string }>(`/scheduling/conversations/${vars.id}`, { name: vars.name }),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: QUERY_KEYS.scheduling.conversations() }),
  })
}
